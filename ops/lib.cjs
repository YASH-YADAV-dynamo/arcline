// Shared helpers for Arcline ops scripts (testnet). Never logs the private key.
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..");

// Resolve viem from this repo (app/node_modules) so these scripts run anywhere — CI, a container,
// another machine. Falls back to plain resolution, then to the original local checkout.
function load(mod) {
  const candidates = [
    path.join(ROOT, "app/node_modules", mod),
    mod,
    "D:/eth-global/openalpha/web/node_modules/" + mod,
  ];
  for (const c of candidates) {
    try { return require(c); } catch { /* try the next one */ }
  }
  throw new Error(`cannot resolve ${mod} — run "bun install" in app/`);
}
const viem = load("viem"), { privateKeyToAccount } = load("viem/accounts"), { arcTestnet } = load("viem/chains");

// Forge build output (app/contracts/out) is gitignored, so it is absent in CI and on a fresh
// clone. The keeper must still run there, so the few fragments it needs are inlined as a
// fallback. Scripts that need more of the ABI surface (smoke.cjs) require a local forge build.
const BUILTIN_ABI = {
  AssetRegistry: [
    { type: "function", name: "assets", inputs: [], outputs: [{ type: "address[]" }], stateMutability: "view" },
    {
      type: "function", name: "assetOf", stateMutability: "view",
      inputs: [{ name: "token", type: "address" }],
      outputs: [{
        type: "tuple", components: [
          { name: "token", type: "address" }, { name: "symbol", type: "string" },
          { name: "category", type: "uint8" }, { name: "decimals", type: "uint8" },
          { name: "venue", type: "address" }, { name: "mirror", type: "bool" },
          { name: "mainnetRef", type: "string" },
        ],
      }],
    },
    { type: "function", name: "priceE8", inputs: [{ type: "address" }], outputs: [{ name: "price", type: "uint256" }, { name: "observedAt", type: "uint64" }], stateMutability: "view" },
    { type: "function", name: "riskOf", inputs: [{ type: "address" }], outputs: [{ type: "uint8" }], stateMutability: "view" },
    { type: "function", name: "maxStaleness", inputs: [], outputs: [{ type: "uint64" }], stateMutability: "view" },
    { type: "function", name: "isReporter", inputs: [{ type: "address" }], outputs: [{ type: "bool" }], stateMutability: "view" },
    { type: "function", name: "owner", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
    { type: "function", name: "onReport", inputs: [{ type: "bytes" }, { type: "bytes" }], outputs: [], stateMutability: "nonpayable" },
    { type: "event", name: "PriceUpdated", inputs: [{ name: "token", type: "address", indexed: true }, { name: "priceE8", type: "uint256" }, { name: "observedAt", type: "uint64" }] },
  ],
};

const abiOf = (c) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "app/contracts/out", `${c}.sol`, `${c}.json`), "utf8")).abi;
  } catch {
    if (BUILTIN_ABI[c]) return BUILTIN_ABI[c];
    throw new Error(`no ABI for ${c}: run "bun run contracts:build" in app/ (forge required)`);
  }
};

// Prefer the environment (CI secrets, container env); fall back to a local .env for dev.
// Never logged, never echoed — only the derived public address is ever printed.
function readKey() {
  const fromEnv = (process.env.ARC_PRIVATE_KEY || "").trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(fromEnv)) return fromEnv;
  try {
    const f = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
    const m = f.match(/^ARC_PRIVATE_KEY=(0x[0-9a-fA-F]{64})/m);
    if (m) return m[1];
  } catch { /* no .env: env var is the only source */ }
  return null;
}
const pk = readKey();
if (!pk) throw new Error("ARC_PRIVATE_KEY not set (env var or arc-treasury/.env), or not a 0x-prefixed 32-byte hex key");
const account = privateKeyToAccount(pk);
// The public Arc testnet RPC rate-limits per IP and reports it as a JSON-RPC error
// ("rate limit exceeded"), not an HTTP 429 — so viem's built-in retry never fires.
// retryCount here covers transport-level failures; withRetry() below covers the JSON error.
const transport = viem.http("https://rpc.testnet.arc.io", { timeout: 30000, retryCount: 3, retryDelay: 1500 });
const pub = viem.createPublicClient({ chain: arcTestnet, transport });
const wal = viem.createWalletClient({ account, chain: arcTestnet, transport });
const FEES = { maxFeePerGas: viem.parseGwei("40"), maxPriorityFeePerGas: viem.parseGwei("2") };
const A = {
  registry: "0x79E37808c2187B949D36c0295C7947154CD85A47", templates: "0xb46DD5FA830b43031f3FF907634963F158D840a5",
  factory: "0x6677b355ca5c21c77198bfe62d223d3e8fc23875", uniVenue: "0x767f4a602d1944409482f57aad56fd5696586208",
  mirrorVenue: "0xBaF806f5a0020F97ACB16f9f7501495b1473B7a7",
  USDC: "0x3600000000000000000000000000000000000000", EURC: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
};
const ERC20 = viem.parseAbi(["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function allowance(address,address) view returns (uint256)", "function symbol() view returns (string)", "function decimals() view returns (uint8)"]);
const OWN = viem.parseAbi(["function owner() view returns (address)", "function pendingOwner() view returns (address)", "function acceptOwnership()"]);
/** Retry a call through the rate limit. The RPC surfaces throttling as a JSON-RPC error string,
 *  so it has to be matched on the message rather than a status code. Exponential, capped. */
async function withRetry(fn, { tries = 6, base = 2000, label = "" } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      const msg = `${e.shortMessage || ""} ${e.message || ""} ${(e.metaMessages || []).join(" ")}`.toLowerCase();
      const throttled = msg.includes("rate limit") || msg.includes("exceeds defined limit") || msg.includes("too many requests");
      if (!throttled || i === tries - 1) throw e;
      const wait = Math.min(20000, base * 2 ** i);
      console.log(`    rate limited${label ? ` (${label})` : ""}; retrying in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw last;
}

async function send(req) {
  const hash = await withRetry(() => wal.writeContract({ ...FEES, ...req }), { label: req.functionName });
  const r = await pub.waitForTransactionReceipt({ hash });
  console.log(`  tx ${r.status} ${req.functionName} https://explorer.testnet.arc.io/tx/${hash}`);
  if (r.status !== "success") throw new Error(`${req.functionName} reverted`);
  return r;
}
module.exports = { viem, pub, wal, account, A, abiOf, ERC20, OWN, send, FEES, withRetry };
