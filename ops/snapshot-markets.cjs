// Captures, once, a display-only snapshot for EVERY listed asset: its deepest Arc mainnet pool
// (7 days of hourly price + volume, liquidity, 24h volume) and its token logo. The landing page ships
// these as static files, so it paints instantly and never calls the market API on load.
//
//   node ops/snapshot-markets.cjs
//
// Writes  app/src/data/market-snapshots.json   (data; dated, labelled "snapshot" in the UI)
//         app/public/tokens/<SYMBOL>.<ext>    (logos, self-hosted)
// Needs ARC_PRIVATE_KEY only because lib.cjs builds a wallet on import; nothing is sent.
// The public API is rate limited, so requests are spaced and 429s back off. Expect ~2 minutes.
const fs = require("fs");
const path = require("path");
const { pub, A, abiOf } = require("./lib.cjs");

const APP = path.join(__dirname, "..", "app");
const DATA = path.join(APP, "src", "data", "market-snapshots.json");
const ICONS = path.join(APP, "public", "tokens");
const BASE = "https://api.geckoterminal.com/api/v2/networks/arc";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const display = (sym) => sym.replace(/\.m$/, "");

// Logos the market API lacks. EURC is Circle's Euro Coin.
const LOGO_FALLBACK = { EURC: "https://coin-images.coingecko.com/coins/images/26045/large/EURC.png?1769615705" };

let last = 0;
async function get(p, { optional = false } = {}) {
  for (let i = 0; i < 6; i++) {
    const wait = Math.max(0, 2600 - (Date.now() - last));
    if (wait) await sleep(wait);
    last = Date.now();
    const r = await fetch(p.startsWith("http") ? p : BASE + p, { headers: { accept: "application/json" } }).catch(() => null);
    if (r && r.ok) return r.json();
    if (r && r.status === 404) return null;
    const back = r && r.status === 429 ? 15000 * (i + 1) : 3000 * (i + 1);
    console.log(`    ${r ? r.status : "network"} on ${p.slice(0, 60)}; waiting ${back / 1000}s`);
    await sleep(back);
  }
  if (optional) return null;
  throw new Error("request failed: " + p);
}

async function download(url, symbol) {
  if (!url || /missing/i.test(url)) return null;
  const r = await fetch(url).catch(() => null);
  if (!r || !r.ok) return null;
  const type = r.headers.get("content-type") || "";
  const ext = type.includes("svg") ? "svg" : type.includes("webp") ? "webp" : type.includes("jpeg") ? "jpg" : "png";
  fs.mkdirSync(ICONS, { recursive: true });
  fs.writeFileSync(path.join(ICONS, `${symbol}.${ext}`), Buffer.from(await r.arrayBuffer()));
  return `/tokens/${symbol}.${ext}`;
}

// Token address on Arc mainnet for assets that have no mainnetRef (the real testnet tokens).
async function resolveRef(symbol) {
  const j = await get(`/search/pools?query=${encodeURIComponent(symbol)}&page=1`, { optional: true });
  const data = j?.data ?? [];
  const asBase = data.find((p) => new RegExp(`^${symbol}\\b`, "i").test(p.attributes.name));
  const asQuote = data.find((p) => new RegExp(`/\\s*${symbol}\\b`, "i").test(p.attributes.name));
  const id = asBase?.relationships?.base_token?.data?.id ?? asQuote?.relationships?.quote_token?.data?.id; // "arc_0x..."
  return id ? id.replace(/^arc_/, "") : null;
}

(async () => {
  const abi = abiOf("AssetRegistry");
  const tokens = await pub.readContract({ address: A.registry, abi, functionName: "assets" });
  // --only=A,B refreshes just those symbols and keeps the rest of the existing file.
  const only = (process.argv.find((x) => x.startsWith("--only=")) || "").slice(7).split(",").filter(Boolean);
  const prev = only.length && fs.existsSync(DATA) ? JSON.parse(fs.readFileSync(DATA, "utf8")) : null;
  const out = prev ?? { capturedAt: new Date().toISOString(), source: "GeckoTerminal, Arc mainnet", markets: {} };

  for (const t of tokens) {
    const a = await pub.readContract({ address: A.registry, abi, functionName: "assetOf", args: [t] });
    const sym = display(a.symbol);
    if (only.length && !only.includes(sym)) continue;
    console.log(`${sym}`);
    const ref = a.mainnetRef || ({ USDC: A.USDC, EURC: A.EURC }[sym]) || (await resolveRef(sym));
    const entry = { icon: null, pair: null, dex: null, priceUsd: null, liquidityUsd: null, volume24hUsd: null, change24hPct: null, candles: [] };
    if (!ref) {
      console.log("    no mainnet reference found; icon/snapshot left empty");
      out.markets[sym] = entry;
      continue;
    }
    const info = await get(`/tokens/${ref}`, { optional: true });
    entry.icon = await download(info?.data?.attributes?.image_url, sym);
    // The market API has no logo for some tokens; fall back to a known public one (display only).
    entry.icon ??= await download(LOGO_FALLBACK[sym], sym);
    entry.priceUsd = Number(info?.data?.attributes?.price_usd) || null;

    // USDC is the quote currency of every pool, so a "USDC / USDC" snapshot would mean nothing: logo only.
    const pools = sym === "USDC" ? [] : ((await get(`/tokens/${ref}/pools?page=1`, { optional: true }))?.data ?? []);
    // Prefer the USDC-quoted pool (what people actually trade against); fall back to the deepest pool.
    const byLiq = pools.slice().sort((x, y) => Number(y.attributes.reserve_in_usd) - Number(x.attributes.reserve_in_usd));
    const top = byLiq.find((p) => /\/\s*USDC\b/i.test(p.attributes.name) && !/^USDC\b/i.test(p.attributes.name)) ?? byLiq[0];
    if (top) {
      const pa = top.attributes;
      entry.pair = pa.name.replace(/\s+[\d.]+%$/, "").replace(/cirbtc/i, "cirBTC");
      entry.dex = top.relationships?.dex?.data?.id ?? null;
      entry.liquidityUsd = Number(pa.reserve_in_usd) || null;
      entry.volume24hUsd = Number(pa.volume_usd?.h24) || null;
      entry.change24hPct = Number(pa.price_change_percentage?.h24);
      if (!Number.isFinite(entry.change24hPct)) entry.change24hPct = null;
      // USD-denominated candles for THIS token, whichever side of the pool it is on.
      const o =
        (await get(`/pools/${pa.address}/ohlcv/hour?limit=168&currency=usd&token=${ref}`, { optional: true })) ??
        (await get(`/pools/${pa.address}/ohlcv/hour?limit=168`, { optional: true }));
      const list = o?.data?.attributes?.ohlcv_list ?? [];
      entry.candles = list.map(([ts, , , , c, v]) => [ts, c, Math.round(v)]).sort((x, y) => x[0] - y[0]);
    }
    out.markets[sym] = entry;
    console.log(`    icon=${entry.icon ?? "none"} pool=${entry.pair ?? "none"} liquidity=${entry.liquidityUsd ? Math.round(entry.liquidityUsd).toLocaleString("en-US") : "-"} candles=${entry.candles.length}`);
  }

  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  fs.writeFileSync(DATA, JSON.stringify(out));
  console.log(`\nwrote ${path.relative(process.cwd(), DATA)} (${Object.keys(out.markets).length} markets)`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
