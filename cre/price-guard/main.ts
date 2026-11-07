// Arcline CRE workflow: price-guard (Arc Testnet, chain selector "arc-testnet").
//
// Every 5 minutes:
//   1. Mirror assets: fetch the live Arc MAINNET USD price from GeckoTerminal over HTTP, with median
//      consensus across DON nodes.
//   2. EURC: read the Arc testnet Uniswap v4 USDC/EURC pool mid price on-chain (StateView.getSlot0).
//   3. Pump / dump guard: compare each new price with the last price stored in the AssetRegistry.
//      If it moved by >= watchPct / noBuyPct / exitPct since the last report, raise the asset's risk
//      level (1 watch, 2 no buys, 3 exit to USDC). Buckets enforce this on-chain.
//   4. Write signed reports to AssetRegistry.onReport through the forwarder:
//        kind 1: abi.encode(address[] tokens, uint256[] pricesE8, uint64 observedAt)
//        kind 2: abi.encode(address token, uint8 level, bytes32 evidenceHash)   (only when a level changes)
// A price that can't be fetched is never invented: the asset is skipped and goes stale, which blocks trading.
import {
	bytesToHex,
	ConsensusAggregationByFields,
	CronCapability,
	type CronPayload,
	EVMClient,
	encodeCallMsg,
	getNetwork,
	HTTPClient,
	type HTTPSendRequester,
	handler,
	LATEST_BLOCK_NUMBER,
	median,
	ok,
	prepareReportRequest,
	protoBigIntToBigint,
	Runner,
	type Runtime,
	text,
	TxStatus,
} from "@chainlink/cre-sdk"
import { type Address, decodeFunctionResult, encodeAbiParameters, encodeFunctionData, type Hex, keccak256, parseAbi, toBytes, zeroAddress } from "viem"
import { z } from "zod"

const addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/)
const configSchema = z.object({
	schedule: z.string(),
	chainSelectorName: z.string(),
	registry: addr,
	receiver: addr, // CreReceiver (ERC-165 adapter) that relays into AssetRegistry.onReport
	gasLimit: z.string(),
	geckoBase: z.string().regex(/^https:\/\/\S+$/, "must be an https URL"),
	mirrors: z.array(z.object({ symbol: z.string(), token: addr, mainnetRef: addr })).max(12),
	eurc: z.object({ token: addr, stateView: addr, poolId: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }),
	guard: z.object({ watchPct: z.number(), noBuyPct: z.number(), exitPct: z.number() }),
})
type Config = z.infer<typeof configSchema>

const REG = parseAbi([
	"function priceE8(address) view returns (uint256 price, uint64 observedAt)",
	"function riskOf(address) view returns (uint8)",
])
const SV = parseAbi(["function getSlot0(bytes32) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)"])

const arc = (c: Config) => {
	const n = getNetwork({ chainFamily: "evm", chainSelectorName: c.chainSelectorName, isTestnet: true })
	if (!n) throw new Error(`unknown chain ${c.chainSelectorName}`)
	return new EVMClient(n.chainSelector.selector)
}

const read = <T,>(runtime: Runtime<Config>, evm: EVMClient, to: string, abi: ReturnType<typeof parseAbi>, functionName: string, args: unknown[]): T | null => {
	try {
		const r = evm
			.callContract(runtime, { call: encodeCallMsg({ from: zeroAddress, to: to as Address, data: encodeFunctionData({ abi, functionName, args } as never) }), blockNumber: LATEST_BLOCK_NUMBER })
			.result()
		return decodeFunctionResult({ abi, functionName, data: bytesToHex(r.data) } as never) as T
	} catch {
		return null // e.g. priceE8 reverts when stale/unset
	}
}

// HTTP: all mirror prices from Arc mainnet in ONE request (GeckoTerminal /tokens/multi), so a run isn't
// rate-limited per token. Returns { p0..pN } in config order; 0 = no price. Each field is medianed across nodes.
type Prices = Record<string, number>
const fetchPrices = (send: HTTPSendRequester, url: string, refs: string[]): Prices => {
	const r = send.sendRequest({ url, method: "GET", multiHeaders: { accept: { values: ["application/json"] } }, cacheSettings: { store: true, maxAge: "60s" } }).result()
	if (!ok(r)) throw new Error(`gecko HTTP ${r.statusCode}`)
	const j = JSON.parse(text(r)) as { data?: { attributes?: { address?: string; price_usd?: string | null } }[] }
	const by = new Map((j.data ?? []).map((d) => [String(d.attributes?.address ?? "").toLowerCase(), Number(d.attributes?.price_usd)]))
	const out: Prices = {}
	refs.forEach((ref, i) => {
		const usd = by.get(ref.toLowerCase())
		out[`p${i}`] = usd !== undefined && Number.isFinite(usd) && usd > 0 ? usd : 0
	})
	return out
}

const levelFor = (movePct: number, g: Config["guard"]) => (movePct >= g.exitPct ? 3 : movePct >= g.noBuyPct ? 2 : movePct >= g.watchPct ? 1 : 0)

const write = (runtime: Runtime<Config>, evm: EVMClient, kind: number, payload: Hex): string | null => {
	const c = runtime.config
	const report = runtime.report(prepareReportRequest(encodeAbiParameters([{ type: "uint8" }, { type: "bytes" }], [kind, payload]))).result()
	const w = evm.writeReport(runtime, { receiver: c.receiver, report, gasConfig: { gasLimit: c.gasLimit } }).result()
	if (w.txStatus !== TxStatus.SUCCESS) throw new Error(`writeReport kind ${kind} failed: ${w.errorMessage || w.txStatus}`)
	return w.txHash && w.txHash.length ? bytesToHex(w.txHash) : null
}

const onCron = (runtime: Runtime<Config>, _p: CronPayload): string => {
	const c = runtime.config
	const evm = arc(c)
	const http = new HTTPClient()
	const head = evm.headerByNumber(runtime, {}).result().header
	const now = head?.timestamp ? BigInt(head.timestamp) : 0n
	if (!head?.blockNumber || now === 0n) throw new Error("no Arc header")
	runtime.log(`[price-guard] Arc testnet block ${protoBigIntToBigint(head.blockNumber)} t=${now}`)

	const tokens: Address[] = []
	const prices: bigint[] = []
	const risks: { token: Address; symbol: string; level: number; movePct: number; prev: bigint; next: bigint }[] = []

	const consider = (symbol: string, token: string, usd: number) => {
		const next = BigInt(Math.round(usd * 1e8))
		tokens.push(token as Address)
		prices.push(next)
		const last = read<readonly [bigint, bigint]>(runtime, evm, c.registry, REG, "priceE8", [token])
		const prev = last ? last[0] : 0n
		const movePct = prev > 0n ? (Math.abs(Number(next - prev)) / Number(prev)) * 100 : 0
		const level = levelFor(movePct, c.guard)
		const cur = read<number>(runtime, evm, c.registry, REG, "riskOf", [token]) ?? 0
		runtime.log(`[price-guard] ${symbol.padEnd(12)} $${usd} (last ${prev > 0n ? Number(prev) / 1e8 : "none"}, move ${movePct.toFixed(2)}%) risk ${cur} -> ${level}`)
		if (level !== Number(cur)) risks.push({ token: token as Address, symbol, level, movePct, prev, next })
	}

	// 1. mirrors: Arc mainnet prices
	const refs = c.mirrors.map((m) => m.mainnetRef)
	try {
		const fields = Object.fromEntries(refs.map((_, i) => [`p${i}`, median])) as never
		const got = http.sendRequest(runtime, fetchPrices, ConsensusAggregationByFields<Prices>(fields))(`${c.geckoBase}/tokens/multi/${refs.join(",")}`, refs).result()
		c.mirrors.forEach((m, i) => {
			const usd = got[`p${i}`] ?? 0
			if (usd > 0) consider(m.symbol, m.token, usd)
			else runtime.log(`[price-guard] ${m.symbol}: no price; stays stale`)
		})
	} catch (e) {
		runtime.log(`[price-guard] mirrors skipped (${e instanceof Error ? e.message : "error"}); they stay stale`)
	}
	// 2. EURC: testnet pool mid price (USDC is currency0; both 6 decimals -> (sqrtP/2^96)^2 = EURC per USDC)
	const s0 = read<readonly [bigint, number, number, number]>(runtime, evm, c.eurc.stateView, SV, "getSlot0", [c.eurc.poolId])
	if (s0 && s0[0] > 0n) consider("EURC", c.eurc.token, 1 / (Number(s0[0]) / 2 ** 96) ** 2)
	else runtime.log("[price-guard] EURC: pool unreadable; skipped")

	if (!tokens.length) return "no prices"

	// 3+4. reports
	const priceTx = write(runtime, evm, 1, encodeAbiParameters([{ type: "address[]" }, { type: "uint256[]" }, { type: "uint64" }], [tokens, prices, now - 5n]))
	runtime.log(`[price-guard] AssetRegistry.onReport(prices x${tokens.length}) ok${priceTx ? ` tx ${priceTx}` : ""}`)
	for (const r of risks) {
		const evidence = keccak256(toBytes(`price-guard|${r.symbol}|${r.prev}|${r.next}|${now}`))
		const tx = write(runtime, evm, 2, encodeAbiParameters([{ type: "address" }, { type: "uint8" }, { type: "bytes32" }], [r.token, r.level, evidence]))
		runtime.log(`[price-guard] risk ${r.symbol} -> ${r.level} (${r.movePct.toFixed(2)}% move) ok${tx ? ` tx ${tx}` : ""}`)
	}
	return `prices ${tokens.length}, risk changes ${risks.length}`
}

const initWorkflow = (config: Config) => [handler(new CronCapability().trigger({ schedule: config.schedule }), onCron)]

export async function main() {
	const runner = await Runner.newRunner<Config>({ configSchema })
	await runner.run(initWorkflow)
}
main()
