// Price reporter (stand-in for the Chainlink CRE workflow until it's deployed).
// Mirrors use live Arc MAINNET prices from GeckoTerminal; EURC uses the Arc testnet Uniswap v4 pool
// (venue quote) so swaps pass the slippage check. Never invents a price: assets whose fetch fails are
// skipped and stay stale (untradable).
const { viem, pub, A, abiOf, send, withRetry } = require("./lib.cjs");
const reg = abiOf("AssetRegistry");
const STATE_VIEW = "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b";
const SV = viem.parseAbi(["function getSlot0(bytes32) view returns (uint160,int24,uint24,uint24)"]);
const POOL_ID = viem.keccak256(viem.encodeAbiParameters(
  [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
  [A.USDC, A.EURC, 500, 10, "0x0000000000000000000000000000000000000000"]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ALL mirror prices in ONE request (/tokens/multi), like the CRE workflow does. Fetching them
// one at a time burned the public rate limit and the last asset in the loop always lost.
// Returns a lowercase address -> usd map; absent/!>0 means no price (asset stays stale).
async function geckoMulti(refs) {
  const out = new Map();
  if (!refs.length) return out;
  const url = `https://api.geckoterminal.com/api/v2/networks/arc/tokens/multi/${refs.join(",")}`;
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { headers: { accept: "application/json" } }).catch(() => null);
    if (r && r.ok) {
      for (const d of (await r.json())?.data ?? []) {
        const addr = String(d?.attributes?.address ?? "").toLowerCase();
        const p = Number(d?.attributes?.price_usd);
        if (addr && Number.isFinite(p) && p > 0) out.set(addr, p);
      }
      if (out.size) return out;
    }
    await sleep(2000 * (i + 1));
  }
  return out;
}

async function run() {
  const list = await withRetry(() => pub.readContract({ address: A.registry, abi: reg, functionName: "assets" }), { label: "assets" });
  const tokens = [], prices = [];

  // one pass to collect metadata, so the HTTP fetch can be a single batched request
  const metas = [];
  for (const t of list) {
    if (t.toLowerCase() === A.USDC.toLowerCase()) continue; // registry pins USDC at 1e8
    const a = await withRetry(() => pub.readContract({ address: A.registry, abi: reg, functionName: "assetOf", args: [t] }), { label: "assetOf" });
    metas.push({ t, a });
  }
  const refs = metas.filter((m) => m.t.toLowerCase() !== A.EURC.toLowerCase() && m.a.mainnetRef).map((m) => m.a.mainnetRef);
  const byRef = await geckoMulti(refs);

  for (const { t, a } of metas) {
    let usd = null;
    if (t.toLowerCase() === A.EURC.toLowerCase()) {
      // Pool mid price from StateView.getSlot0 (venue.quote() can't be used: v4 Quoter reverts under staticcall).
      // currency0 = USDC, currency1 = EURC, both 6 decimals, so (sqrtP/2^96)^2 = EURC per USDC.
      const [sp] = await pub.readContract({ address: STATE_VIEW, abi: SV, functionName: "getSlot0", args: [POOL_ID] }).catch(() => [0n]);
      usd = sp > 0n ? 1 / (Number(sp) / 2 ** 96) ** 2 : null;
    } else if (a.mainnetRef) usd = byRef.get(a.mainnetRef.toLowerCase()) ?? null;
    if (usd === null) { console.log(` skip ${a.symbol}: no price source answered`); continue; }
    tokens.push(t);
    prices.push(BigInt(Math.round(usd * 1e8)));
    console.log(` ${a.symbol.padEnd(12)} $${usd}`);
  }
  if (!tokens.length) throw new Error("no prices fetched");
  const blk = await pub.getBlock();
  const payload = viem.encodeAbiParameters([{ type: "address[]" }, { type: "uint256[]" }, { type: "uint64" }], [tokens, prices, blk.timestamp - 5n]);
  const report = viem.encodeAbiParameters([{ type: "uint8" }, { type: "bytes" }], [1, payload]);
  await send({ address: A.registry, abi: reg, functionName: "onReport", args: ["0x", report] });
}

module.exports = { run };
if (require.main === module) run().catch((e) => { console.error("ERR", e.shortMessage || e.message); process.exit(1); });
