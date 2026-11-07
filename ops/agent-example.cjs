// Example agent for Arcline (Arc Testnet). Small on purpose: read markets, watch for new listings,
// and optionally rebalance one basket when the contract says it is allowed.
//
//   export ARC_AGENT_PRIVATE_KEY=0x...          # from the Download .env file on the Agents page
//   node ops/agent-example.cjs                  # list markets, poll every 30s for new ones
//   node ops/agent-example.cjs 60               # poll every 60s
//   node ops/agent-example.cjs --basket 0x...   # also try to rebalance that basket each poll
//   node ops/agent-example.cjs --once           # list markets (and try the basket once), then exit
//
// The key is read from the environment only and is never printed; only the derived address is. The agent
// wallet needs a little USDC (it is the gas token on Arc). Basket limits are enforced on-chain, so a
// rebalance either happens inside them or reverts; this script simulates first and prints the reason.
const agentKey = (process.env.ARC_AGENT_PRIVATE_KEY || "").trim();
if (!/^0x[0-9a-fA-F]{64}$/.test(agentKey)) {
  console.error("ARC_AGENT_PRIVATE_KEY is not set (expected a 0x-prefixed 32-byte hex key). Create an agent wallet on the Agents page.");
  process.exit(1);
}
// lib.cjs builds its wallet from ARC_PRIVATE_KEY, so point that at the agent key for this process only.
process.env.ARC_PRIVATE_KEY = agentKey;
const { viem, pub, wal, account, A, abiOf, withRetry, FEES } = require("./lib.cjs");

// ---- args ----
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const pollSec = Math.max(5, Number(opt("--interval") ?? argv.find((a) => /^\d+$/.test(a)) ?? 30));
const basket = opt("--basket");
const once = flag("--once");
if (basket && !viem.isAddress(basket)) { console.error("--basket must be an address (0x...)"); process.exit(1); }

const registry = abiOf("AssetRegistry");
const basketAbi = viem.parseAbi([
  "function rebalance() returns (uint16)",
  "error Cooldown(uint64 readyAt)",
  "error NotNeeded(uint16 maxDriftBps)",
  "error Paused_()",
  "error StalePrice(address token)",
  "error MinOut(uint256 got, uint256 minOut)",
  "error SlippageExceeded(uint256 got, uint256 min)",
  "error RiskBlocked(address token, uint8 level)",
]);
const CATEGORIES = ["Cash", "FX", "Crypto", "Yield", "RWA"];
const RISK = ["ok", "watch", "no buys", "exit"];
const rd = (functionName, args) => withRetry(() => pub.readContract({ address: A.registry, abi: registry, functionName, args }), { label: functionName });

/** One asset: metadata + price/age/risk. priceE8 reverts when stale, so a missing price means trading is disabled. */
async function readAsset(token) {
  const a = await rd("assetOf", [token]);
  let price = null, observedAt = null;
  try { const [p, at] = await rd("priceE8", [token]); price = Number(p) / 1e8; observedAt = Number(at); } catch { /* stale or unset */ }
  const risk = Number(await rd("riskOf", [token]));
  return { token, symbol: a.symbol, category: CATEGORIES[Number(a.category)] ?? "?", price, observedAt, risk };
}

const fmt = (x) => (x.price === null ? "stale" : `$${x.price.toLocaleString("en-US", { maximumFractionDigits: x.price < 10 ? 4 : 2 })}`);
const age = (x) => {
  if (x.observedAt === null) return "-";
  const s = Math.max(0, Math.floor(Date.now() / 1000) - x.observedAt);
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${(s / 3600).toFixed(1)}h`;
};
const line = (x) => `  ${x.symbol.padEnd(12)} ${x.category.padEnd(7)} ${fmt(x).padStart(12)}  age ${age(x).padStart(5)}  risk ${RISK[x.risk] ?? x.risk}`;

/** Custom-error name + args from a viem revert. */
function revertOf(e) {
  const d = e?.cause?.data ?? e?.data;
  return { name: d?.errorName ?? null, args: (d?.args ?? []).map(String), msg: e?.shortMessage || e?.message || "revert" };
}

function reason({ name, args, msg }) {
  if (name === "Cooldown") {
    const left = Number(args[0]) - Math.floor(Date.now() / 1000);
    return `Cooldown: next rebalance in ${left > 0 ? `${Math.ceil(left / 60)} min` : "moments"}`;
  }
  if (name === "NotNeeded") return `NotNeeded: drift ${(Number(args[0]) / 100).toFixed(2)}% is inside the basket's band`;
  if (name === "MinOut" || name === "SlippageExceeded") return `${name}: price moved past the slippage limit`;
  if (name === "StalePrice") return "StalePrice: an asset has no fresh oracle price";
  if (name === "RiskBlocked") return "RiskBlocked: buys are paused for an asset by its risk level";
  return name ? `${name} ${args.join(",")}`.trim() : msg;
}

/** Simulate first; only send when the contract would accept the call. */
async function tryRebalance() {
  const req = { address: basket, abi: basketAbi, functionName: "rebalance", account: account.address };
  try {
    await withRetry(() => pub.simulateContract(req), { label: "simulate rebalance" });
  } catch (e) {
    console.log(`  basket ${basket}: not rebalancing - ${reason(revertOf(e))}`);
    return;
  }
  try {
    const hash = await withRetry(() => wal.writeContract({ ...FEES, ...req, account }), { label: "rebalance" });
    const r = await pub.waitForTransactionReceipt({ hash });
    console.log(`  basket ${basket}: rebalance ${r.status} https://explorer.testnet.arc.io/tx/${hash}`);
  } catch (e) {
    console.log(`  basket ${basket}: rebalance failed - ${reason(revertOf(e))}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log(`agent ${account.address} on Arc Testnet`);
  const usdc = await withRetry(() => pub.readContract({ address: A.USDC, abi: viem.erc20Abi, functionName: "balanceOf", args: [account.address] }), { label: "balance" });
  console.log(`USDC balance ${viem.formatUnits(usdc, 6)}${usdc < 100_000n ? "  (low: USDC is the gas token, fund this address before sending transactions)" : ""}\n`);

  const tokens = await rd("assets");
  const seen = new Set(tokens.map((t) => t.toLowerCase()));
  console.log(`${tokens.length} markets in the registry`);
  for (const t of tokens) console.log(line(await readAsset(t)));
  if (basket) { console.log(""); await tryRebalance(); }
  if (once) return;

  console.log(`\nwatching for new listings every ${pollSec}s (Ctrl+C to stop)`);
  for (;;) {
    await sleep(pollSec * 1000);
    try {
      for (const t of await rd("assets")) {
        if (seen.has(t.toLowerCase())) continue;
        seen.add(t.toLowerCase());
        const x = await readAsset(t);
        console.log(`TICKET ${x.symbol} detected`);
        console.log(line(x));
        console.log(`  trade page: #/trade/${x.symbol.replace(/\.m$/, "")}`);
      }
      if (basket) await tryRebalance();
    } catch (e) {
      console.log(`poll failed: ${e.shortMessage || e.message}`);
    }
  }
})().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
