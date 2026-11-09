// Price reporter: the off-DON twin of the Chainlink CRE workflow (cre/price-guard), used by the keeper
// right before every rebalance and by keeper-loop as a liveness backstop.
//
// Sources, all fetched IN PARALLEL with tight timeouts so a full report is built in well under a second:
//   1. Chainlink Data Feeds on Ethereum mainnet (BTC, ETH, EUR, GBP, XAU / USD), one multicall.
//      Primary wherever a feed exists: decentralised, and each feed carries its own update time.
//      A feed older than its heartbeat (plus a margin) is treated as missing, never trusted.
//   2. GeckoTerminal Arc mainnet token prices, one batched request. Cross-check for the assets above,
//      and the only source for assets with no Chainlink feed (syrupUSDC, ASTOCK).
//   3. The Arc testnet Uniswap v4 USDC/EURC pool (StateView.getSlot0). Used for EURC only when it
//      agrees with Chainlink EUR/USD, so swaps in that pool still pass the slippage check.
// When two sources disagree by more than MAX_DEV the log says so and Chainlink wins. An asset with no
// trustworthy source is skipped and goes stale, which blocks trading. A price is never invented.
//
//   node ops/report-prices.cjs          # post one report
//   node ops/report-prices.cjs --dry    # fetch and print, send nothing
const { viem, pub, A, abiOf, send } = require("./lib.cjs");
const reg = abiOf("AssetRegistry");
const MULTICALL = "0xcA11bde05977b3631167028862bE2a173976CA11";
const STATE_VIEW = "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b";
const SV = viem.parseAbi(["function getSlot0(bytes32) view returns (uint160,int24,uint24,uint24)"]);
const POOL_ID = viem.keccak256(viem.encodeAbiParameters(
  [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
  [A.USDC, A.EURC, 500, 10, "0x0000000000000000000000000000000000000000"]));

// Chainlink proxies on Ethereum mainnet, from Chainlink's feed directory
// (reference-data-directory.vercel.app/feeds-mainnet.json), each checked live with description().
// heartbeat: the feed's maximum time between updates; it also updates on every move past its deviation.
const CHAINLINK = {
  "cirBTC.m": { pair: "BTC / USD", proxy: "0xf4030086522a5beea4988f8ca5b36dbc97bee88c", heartbeat: 3600 },
  "WETH.m": { pair: "ETH / USD", proxy: "0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419", heartbeat: 3600 },
  EURC: { pair: "EUR / USD", proxy: "0xb49f677943bc038e9857d61e7d053caa2c1734c1", heartbeat: 86400 },
  "GBPA.m": { pair: "GBP / USD", proxy: "0x5c0ab2d9b5a7ed9f470386e82bb36a3613cdd4b5", heartbeat: 86400 },
  "XAUM.m": { pair: "XAU / USD", proxy: "0x214ed9da11d2fbe465a6fc601a91e62ebec1a0d6", heartbeat: 86400 },
};
const HEARTBEAT_MARGIN = 600; // seconds of grace past a heartbeat before a feed counts as stale
const MAX_DEV = 0.015; // sources further apart than this are logged; Chainlink wins
const POOL_MAX_DEV = 0.01; // EURC pool price is used only within 1% of Chainlink EUR/USD
const TIMEOUT = 2500; // ms per source
// EURC on Arc mainnet, GeckoTerminal's cross-check for EUR (linked to CoinGecko's euro-coin).
const EURC_REF = "0xbef5f6d51cb62b58e6a8f77868681825c6fe21c1";

const eth = viem.createPublicClient({
  transport: viem.fallback(
    ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com", "https://1rpc.io/eth"].map((u) => viem.http(u, { timeout: TIMEOUT, retryCount: 0 })),
  ),
});
const AGG = viem.parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
]);

const timed = async (label, fn, ms) => {
  const t = Date.now();
  try {
    return await fn();
  } finally {
    ms[label] = Date.now() - t;
  }
};

/** symbol -> usd, for Chainlink feeds that are fresh by their own heartbeat. One multicall. */
async function chainlink(symbols) {
  const feeds = symbols.filter((s) => CHAINLINK[s]).map((s) => [s, CHAINLINK[s]]);
  const out = new Map();
  if (!feeds.length) return out;
  const res = await eth.multicall({
    multicallAddress: MULTICALL,
    allowFailure: true,
    contracts: feeds.flatMap(([, f]) => [
      { address: f.proxy, abi: AGG, functionName: "latestRoundData" },
      { address: f.proxy, abi: AGG, functionName: "decimals" },
    ]),
  });
  const now = Date.now() / 1000;
  feeds.forEach(([sym, f], i) => {
    const [round, dec] = [res[2 * i], res[2 * i + 1]];
    if (round.status !== "success" || dec.status !== "success") return;
    const [, answer, , updatedAt] = round.result;
    const age = now - Number(updatedAt);
    if (answer <= 0n || age > f.heartbeat + HEARTBEAT_MARGIN) {
      console.log(` ${sym}: Chainlink ${f.pair} is ${Math.round(age)}s old, past its heartbeat; ignored`);
      return;
    }
    out.set(sym, { usd: Number(answer) / 10 ** Number(dec.result), age: Math.round(age) });
  });
  return out;
}

/** lowercase address -> usd from GeckoTerminal, one batched request, one retry. */
async function gecko(refs) {
  const out = new Map();
  if (!refs.length) return out;
  const url = `https://api.geckoterminal.com/api/v2/networks/arc/tokens/multi/${refs.join(",")}`;
  for (let i = 0; i < 2 && !out.size; i++) {
    const r = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT) }).catch(() => null);
    if (!r?.ok) continue;
    for (const d of (await r.json().catch(() => null))?.data ?? []) {
      const addr = String(d?.attributes?.address ?? "").toLowerCase();
      const p = Number(d?.attributes?.price_usd);
      if (addr && Number.isFinite(p) && p > 0) out.set(addr, p);
    }
  }
  return out;
}

async function eurcPool() {
  const [sp] = await pub.readContract({ address: STATE_VIEW, abi: SV, functionName: "getSlot0", args: [POOL_ID] });
  // currency0 = USDC, currency1 = EURC, both 6 decimals, so (sqrtP/2^96)^2 = EURC per USDC.
  return sp > 0n ? 1 / (Number(sp) / 2 ** 96) ** 2 : null;
}

const dev = (a, b) => Math.abs(a - b) / b;
const pct = (x) => `${(x * 100).toFixed(2)}%`;

// Registry metadata (which assets, their symbols and mainnet refs) changes only when an asset is
// listed, so a long-running keeper reads it once per META_TTL instead of before every report.
const META_TTL = 10 * 60_000;
let metaCache = null;
async function registryAssets() {
  if (metaCache && Date.now() - metaCache.at < META_TTL) return metaCache.assets;
  const list = await pub.readContract({ address: A.registry, abi: reg, functionName: "assets" });
  const toks = list.filter((t) => t.toLowerCase() !== A.USDC.toLowerCase()); // registry pins USDC at 1e8
  const metas = await pub.multicall({
    multicallAddress: MULTICALL,
    allowFailure: false,
    contracts: toks.map((t) => ({ address: A.registry, abi: reg, functionName: "assetOf", args: [t] })),
  });
  const assets = toks.map((t, i) => ({ t, sym: metas[i].symbol, ref: metas[i].mainnetRef }));
  metaCache = { at: Date.now(), assets };
  return assets;
}

/** Build the price set from every source. Exported so callers can inspect without sending. */
async function collect() {
  const t0 = Date.now();
  const ms = {};
  // Chainlink and the pool need nothing from the registry, so they start at once, alongside it.
  const clP = timed("chainlink", () => chainlink(Object.keys(CHAINLINK)), ms).catch(() => new Map());
  const poolP = timed("eurcPool", eurcPool, ms).catch(() => null);
  const assets = await timed("registry", registryAssets, ms);
  const refs = [...new Set([...assets.filter((a) => a.ref && a.t.toLowerCase() !== A.EURC.toLowerCase()).map((a) => a.ref.toLowerCase()), EURC_REF])];

  const [cl, gt, pool] = await Promise.all([clP, timed("geckoterminal", () => gecko(refs), ms).catch(() => new Map()), poolP]);

  const tokens = [], prices = [], rows = [];
  for (const a of assets) {
    const isEurc = a.t.toLowerCase() === A.EURC.toLowerCase();
    const link = cl.get(a.sym);
    const geck = gt.get(isEurc ? EURC_REF : String(a.ref || "").toLowerCase()) ?? null;
    let usd = null, src = "";
    if (link) {
      usd = link.usd;
      src = `chainlink (${link.age}s)`;
      if (geck !== null && dev(geck, link.usd) > MAX_DEV) src += `, geckoterminal ${pct(geck / link.usd - 1)} off`;
      if (isEurc && pool !== null) {
        if (dev(pool, link.usd) <= POOL_MAX_DEV) {
          usd = pool;
          src = `pool, within ${pct(dev(pool, link.usd))} of chainlink`;
        } else src += `, pool ${pct(pool / link.usd - 1)} off so not used`;
      }
    } else if (geck !== null) {
      usd = geck;
      src = "geckoterminal";
    } // EURC is never priced from the thin pool alone: it read $9.71 on 2026-11-09
    if (usd === null) {
      console.log(` skip ${a.sym}: no trustworthy source answered`);
      continue;
    }
    tokens.push(a.t);
    prices.push(BigInt(Math.round(usd * 1e8)));
    rows.push(` ${a.sym.padEnd(12)} $${usd.toPrecision(8).padEnd(12)} ${src}`);
  }
  console.log(rows.join("\n"));
  console.log(` sources: ${Object.entries(ms).map(([k, v]) => `${k} ${v}ms`).join(", ")}; built in ${Date.now() - t0}ms`);
  return { tokens, prices };
}

async function run({ dry = false } = {}) {
  const { tokens, prices } = await collect();
  if (!tokens.length) throw new Error("no prices from any source");
  if (dry) return { tokens, prices };
  const blk = await pub.getBlock();
  const payload = viem.encodeAbiParameters([{ type: "address[]" }, { type: "uint256[]" }, { type: "uint64" }], [tokens, prices, blk.timestamp - 1n]);
  const report = viem.encodeAbiParameters([{ type: "uint8" }, { type: "bytes" }], [1, payload]);
  await send({ address: A.registry, abi: reg, functionName: "onReport", args: ["0x", report] });
  return { tokens, prices };
}

module.exports = { run, collect, CHAINLINK };
if (require.main === module) {
  run({ dry: process.argv.includes("--dry") }).catch((e) => {
    console.error("ERR", e.shortMessage || e.message);
    process.exit(1);
  });
}
