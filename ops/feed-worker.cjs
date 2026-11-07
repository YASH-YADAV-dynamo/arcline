// Arcline feed worker: the one always-on backend process. Runs next to Caddy on the server.
//
//   node ops/feed-worker.cjs            # FEED_DIR defaults to ./feed
//
// Why it exists (root causes it removes):
//  1. Trades revert with StalePrice when nobody writes oracle prices for an hour. A best-effort cron
//     (GitHub Actions) is not a liveness guarantee. This loop reports every PRICE_EVERY seconds, so
//     the registry is always fresh and EURC tracks the Uniswap v4 pool closely (fewer MinOut reverts).
//  2. Charts were rebuilt in every visitor's browser: ~14+ serial eth_getLogs calls against a
//     rate-limited public RPC, plus per-visitor GeckoTerminal calls that all share this server's IP
//     (30 req/min) through the /gt proxy. Here they are fetched ONCE, on a budget, and written as
//     static JSON that Caddy serves at /feed/*. The browser makes one request per file.
//
// Liveness backstop for the Chainlink CRE workflow (cre/price-guard), which is not on a DON yet.
// Never logs the private key (lib.cjs only exposes the derived address).
const fs = require("fs"), path = require("path");
const { viem, pub, A, account, withRetry } = require("./lib.cjs");
const { run: reportPrices } = require("./report-prices.cjs");

const OUT = path.resolve(process.env.FEED_DIR || path.join(__dirname, "..", "feed"));
const PRICE_EVERY = Math.max(30, Number(process.env.PRICE_EVERY || 60)) * 1000;
const POINTS_EVERY = 30_000;
const GT_EVERY = Math.max(120, Number(process.env.GT_EVERY || 180)) * 1000;
const GT_GAP = 2500; // ms between GeckoTerminal calls: ~24/min max, under the 30/min public limit
const DEPLOY_BLOCK = 70998886n;
const CHUNK = 10_000n;
const GT = "https://api.geckoterminal.com/api/v2";
// Must match app/src/lib/market.ts TIMEFRAMES so the snapshot keys equal the paths the UI requests.
const TIMEFRAMES = { "15m": ["minute", 15, 96], "1H": ["hour", 1, 120], "4H": ["hour", 4, 120], "1D": ["day", 1, 90] };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const log = (m) => console.log(`[${stamp()}] ${m}`);
fs.mkdirSync(OUT, { recursive: true });
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(OUT, f), "utf8")); } catch { return d; } };
function writeJson(f, v) { // atomic: Caddy never serves a half-written file
  const tmp = path.join(OUT, `.${f}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(v));
  fs.renameSync(tmp, path.join(OUT, f));
}

const regAbi = viem.parseAbi([
  "function assets() view returns (address[])",
  "function assetOf(address) view returns ((address token,string symbol,uint8 category,uint8 decimals,address venue,bool mirror,string mainnetRef))",
  "event PriceUpdated(address indexed token, uint256 priceE8, uint64 observedAt)",
]);

// ---------- 1. oracle prices ----------
async function priceLoop() {
  for (;;) {
    const t0 = Date.now();
    try { await reportPrices(); log("prices reported"); }
    catch (e) { log(`prices FAILED: ${(e.shortMessage || e.message || String(e)).split("\n")[0]}`); }
    await sleep(Math.max(5_000, PRICE_EVERY - (Date.now() - t0)));
  }
}

// ---------- 2. PriceUpdated history -> points.json ----------
// Thinned so the file stays small forever: full resolution (1/min) for 48h, 1 per 15 min for 30 days, then dropped.
function thin(series, nowSec) {
  const out = [];
  let lastBucket = null;
  for (const [t, p] of series) {
    const age = nowSec - t;
    if (age > 30 * 86400) continue;
    const b = age > 2 * 86400 ? Math.floor(t / 900) : Math.floor(t / 60);
    if (b === lastBucket) out[out.length - 1] = [t, p]; // keep the latest point in the bucket
    else { out.push([t, p]); lastBucket = b; }
  }
  return out;
}
async function pointsLoop() {
  const state = readJson("points.json", null);
  let to = state?.to ? BigInt(state.to) : DEPLOY_BLOCK - 1n;
  const series = state?.series ?? {};
  for (;;) {
    try {
      const latest = await withRetry(() => pub.getBlockNumber(), { label: "blockNumber" });
      let added = 0;
      while (to < latest) {
        const from = to + 1n, end = from + CHUNK - 1n < latest ? from + CHUNK - 1n : latest;
        const logs = await withRetry(() => pub.getContractEvents({ address: A.registry, abi: regAbi, eventName: "PriceUpdated", fromBlock: from, toBlock: end }), { label: "getLogs" });
        for (const l of logs) {
          const k = l.args.token.toLowerCase();
          (series[k] ||= []).push([Number(l.args.observedAt), Number(l.args.priceE8) / 1e8]);
          added++;
        }
        to = end;
      }
      const now = Math.floor(Date.now() / 1000);
      for (const k of Object.keys(series)) series[k] = thin(series[k].sort((a, b) => a[0] - b[0]), now);
      writeJson("points.json", { v: 1, at: now, to: to.toString(), series });
      if (added) log(`points +${added} (to block ${to})`);
    } catch (e) { log(`points FAILED: ${(e.shortMessage || e.message).split("\n")[0]}`); }
    await sleep(POINTS_EVERY);
  }
}

// ---------- 3. GeckoTerminal snapshot -> gt.json ----------
// Keys are the exact paths (relative to /gt/api/v2) that the frontend requests, so the UI can look
// a request up in the snapshot before going to the network. A failed fetch keeps the previous value.
async function gtFetch(p) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(GT + p, { headers: { accept: "application/json" } }).catch(() => null);
    if (r?.ok) return r.json();
    if (r && r.status !== 429 && r.status < 500) return null; // e.g. 404: no data, don't retry
    await sleep(10_000 * (i + 1));
  }
  return null;
}
// Same rule as findMainnetToken in app/src/lib/prices.ts (CoinGecko-listed base token, deepest total liquidity).
function pickMainnetToken(symbol, j) {
  const listed = new Set((j?.included ?? []).filter((t) => t.type === "token" && t.attributes?.coingecko_coin_id).map((t) => t.id));
  const depth = new Map();
  for (const p of j?.data ?? []) {
    const id = p.relationships?.base_token?.data?.id;
    if (!id || !listed.has(id) || !p.attributes.name.toUpperCase().startsWith(`${symbol.toUpperCase()} /`)) continue;
    depth.set(id, (depth.get(id) ?? 0) + (Number(p.attributes.reserve_in_usd) || 0));
  }
  const best = [...depth.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
  return best?.includes("_") ? best.split("_")[1] : null;
}
async function gtLoop() {
  const snap = readJson("gt.json", { v: 1, at: 0, r: {} });
  const r = snap.r;
  for (;;) {
    const t0 = Date.now();
    let ok = 0, miss = 0;
    const get = async (p) => {
      const j = await gtFetch(p);
      if (j) { // save as we go, so a first pass slowed by rate limits still serves what it has
        r[p] = { at: Math.floor(Date.now() / 1000), j };
        ok++;
        snap.at = r[p].at;
        writeJson("gt.json", snap);
      } else miss++;
      await sleep(GT_GAP);
      return j ?? r[p]?.j ?? null;
    };
    try {
      const tokens = await withRetry(() => pub.readContract({ address: A.registry, abi: regAbi, functionName: "assets" }), { label: "assets" });
      for (const t of tokens) {
        if (t.toLowerCase() === A.USDC.toLowerCase()) continue;
        const a = await withRetry(() => pub.readContract({ address: A.registry, abi: regAbi, functionName: "assetOf", args: [t] }), { label: "assetOf" });
        let ref = a.mainnetRef || null;
        if (!ref) { // real testnet asset (EURC): find its Arc mainnet twin by symbol, like the UI does
          const sym = a.symbol;
          const j = await get(`/search/pools?query=${encodeURIComponent(sym)}&network=arc&include=base_token`);
          ref = pickMainnetToken(sym, j);
        }
        if (!ref) continue;
        await get(`/networks/arc/tokens/${ref}`);
        const pools = await get(`/networks/arc/tokens/${ref}/pools?page=1`);
        const top = (pools?.data ?? []).slice().sort((x, y) => Number(y.attributes.reserve_in_usd) - Number(x.attributes.reserve_in_usd))[0];
        const pool = top?.attributes?.address;
        if (!pool) continue;
        await get(`/networks/arc/pools/${pool}/ohlcv/hour?limit=168`); // markets-table sparkline
        for (const [res, agg, limit] of Object.values(TIMEFRAMES)) {
          await get(`/networks/arc/pools/${pool}/ohlcv/${res}?aggregate=${agg}&limit=${limit}&currency=usd&token=${ref}`);
        }
      }
      snap.at = Math.floor(Date.now() / 1000);
      writeJson("gt.json", snap);
      log(`gt snapshot: ${ok} fresh, ${miss} kept/missing, ${Object.keys(r).length} keys`);
    } catch (e) { log(`gt FAILED: ${(e.shortMessage || e.message).split("\n")[0]}`); }
    await sleep(Math.max(10_000, GT_EVERY - (Date.now() - t0)));
  }
}

log(`feed worker up: reporter ${account.address}, out ${OUT}, prices every ${PRICE_EVERY / 1000}s`);
priceLoop();
pointsLoop();
gtLoop();
