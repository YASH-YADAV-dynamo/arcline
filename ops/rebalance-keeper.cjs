// Basket rebalance keeper: makes rebalancing AUTOMATIC.
//
//   node ops/rebalance-keeper.cjs [intervalSeconds]   # loop (default 120s, min 30s)
//   node ops/rebalance-keeper.cjs --once              # one pass, then exit (cron / CI)
//   node ops/rebalance-keeper.cjs --dry               # simulate only, never send
//   node ops/rebalance-keeper.cjs --no-refresh        # never post a price report itself
//
// BucketAccount.rebalance() and executeSip() are permissionless by design: anyone may call them, the
// contract enforces every gate (drift band, cooldown, max trade size, slippage, risk exits) and pays the
// caller a capped tip. So automation needs no privileged role. Each pass reads every basket from the
// factory, SIMULATES the call first, and only sends when the contract says it would succeed. That keeps
// the normal "not needed / cooldown" cases free of gas and noise.
//
// Fresh prices, pulled at execution time (the pattern GMX and Pyth use): a push oracle that stops
// reporting freezes every basket (StalePrice), and even a price that is merely old makes a rebalance
// miss its MinOut. So each pass runs in two phases. First it simulates every basket. If any basket is
// due, or is blocked only by a stale price, and the registry's oldest price is older than REFRESH_AGE,
// it posts ONE price report (report-prices.cjs, a single onReport tx) and only then re-simulates and
// sends. Passes with nothing to do send nothing, so this costs one extra tx only when a trade follows.
// Pass --no-refresh to disable (for example when another reporter is known to be live).
//
// Needs ARC_PRIVATE_KEY (env or .env) for a wallet with a little USDC for gas. It must also be an
// authorised AssetRegistry reporter for the refresh step. Never logs the key.
const { viem, pub, wal, account, A, abiOf, FEES, withRetry } = require("./lib.cjs");
const { run: reportPrices } = require("./report-prices.cjs");

const args = process.argv.slice(2);
const ONCE = args.includes("--once");
const DRY = args.includes("--dry");
const REFRESH = !args.includes("--no-refresh");
const REFRESH_AGE = 90; // seconds: older than this, post a fresh report before trading
const secs = Number(args.find((a) => /^\d+$/.test(a)) || 120);
const INTERVAL = Math.max(30, secs) * 1000;
const stamp = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const log = (m) => console.log(`[${stamp()}] ${m}`);

const factoryAbi = viem.parseAbi([
  "function bucketCount() view returns (uint256)",
  "function bucketAt(uint256) view returns (address)",
]);
const basketAbi = viem.parseAbi([
  "function rebalance() returns (uint16)",
  "function executeSip()",
  "error NotNeeded(uint16 maxDriftBps)",
  "error Cooldown(uint64 readyAt)",
  "error Paused_()",
  "error SipInactive()",
  "error SipNotDue(uint64 nextAt)",
  "error MinOut(uint256 got, uint256 want)",
  "error SlippageExceeded()",
  "error StalePrice()",
  // Bubbled up from the AssetRegistry (BucketAccount re-throws venue and registry errors as is).
  "error StalePrice(address token)",
  "error UnknownAsset(address token)",
  "error RiskBlocked()",
  "error TradeTooLarge()",
  "error InsufficientReserve()",
  "error Unsupported()",
]);

// Outcomes that just mean "nothing to do right now". Everything else is surfaced.
const QUIET = new Set(["NotNeeded", "Cooldown", "Paused_", "SipInactive", "SipNotDue"]);
// Outcomes a fresh price report can cure: a stale price, or a price old enough to miss MinOut.
const PRICE_FIXABLE = new Set(["StalePrice", "MinOut", "SlippageExceeded"]);

const regAbi = viem.parseAbi([
  "function assets() view returns (address[])",
  "function priceE8(address) view returns (uint256 price, uint64 observedAt)",
]);

/** Age in seconds of the OLDEST listed price (USDC excluded: the registry pins it). Infinity when any
 *  price is already stale (priceE8 reverts) or unset. One multicall. */
async function oldestPriceAge() {
  const tokens = (await withRetry(() => pub.readContract({ address: A.registry, abi: regAbi, functionName: "assets" }), { label: "assets" }))
    .filter((t) => t.toLowerCase() !== A.USDC.toLowerCase());
  const res = await withRetry(
    () => pub.multicall({ contracts: tokens.map((t) => ({ address: A.registry, abi: regAbi, functionName: "priceE8", args: [t] })), allowFailure: true }),
    { label: "priceE8" },
  );
  const now = Number((await pub.getBlock()).timestamp);
  let oldest = 0;
  for (const r of res) {
    if (r.status !== "success") return Infinity;
    oldest = Math.max(oldest, now - Number(r.result[1]));
  }
  return oldest;
}

/** Simulate only: "ok", or the revert name. */
async function check(basket, functionName) {
  try {
    await withRetry(() => pub.simulateContract({ address: basket, abi: basketAbi, functionName, account: account.address }), { label: `simulate ${functionName}` });
    return "ok";
  } catch (e) {
    return revertName(e);
  }
}

function revertName(e) {
  let n;
  try {
    e.walk?.((x) => {
      if (!n && x?.data?.errorName) n = x.data.errorName;
    });
  } catch { /* fall through */ }
  if (n) return n;
  const m = /(NotNeeded|Cooldown|Paused_|SipInactive|SipNotDue|MinOut|SlippageExceeded|StalePrice|RiskBlocked|TradeTooLarge|InsufficientReserve|Unsupported)/.exec(
    `${e.shortMessage || ""} ${e.message || ""}`,
  );
  return m ? m[1] : (e.shortMessage || e.message || "unknown").split("\n")[0];
}

async function attempt(basket, functionName, tally) {
  const req = { address: basket, abi: basketAbi, functionName, account: account.address };
  try {
    await withRetry(() => pub.simulateContract(req), { label: `simulate ${functionName}` });
  } catch (e) {
    const name = revertName(e);
    if (QUIET.has(name)) {
      tally.quiet++;
    } else {
      tally.blocked++;
      log(`  ${basket} ${functionName} blocked: ${name}`);
    }
    return;
  }
  if (DRY) {
    tally.would++;
    log(`  ${basket} ${functionName} WOULD run (dry)`);
    return;
  }
  try {
    const hash = await withRetry(() => wal.writeContract({ ...FEES, ...req, account }), { label: functionName });
    const r = await pub.waitForTransactionReceipt({ hash });
    tally[r.status === "success" ? "sent" : "failed"]++;
    log(`  ${basket} ${functionName} ${r.status} https://explorer.testnet.arc.io/tx/${hash}`);
  } catch (e) {
    tally.failed++;
    log(`  ${basket} ${functionName} send failed: ${revertName(e)}`);
  }
}

async function pass() {
  const tally = { baskets: 0, sent: 0, would: 0, quiet: 0, blocked: 0, failed: 0, refreshed: 0 };
  const count = Number(await withRetry(() => pub.readContract({ address: A.factory, abi: factoryAbi, functionName: "bucketCount" }), { label: "bucketCount" }));

  // Phase 1: what would run, and what is only blocked by prices.
  const todo = [];
  let priceBlocked = 0;
  let staleBlocked = 0; // StalePrice: only a fresh report can cure it
  for (let i = 0; i < count; i++) {
    const basket = await withRetry(() => pub.readContract({ address: A.factory, abi: factoryAbi, functionName: "bucketAt", args: [BigInt(i)] }), { label: "bucketAt" });
    tally.baskets++;
    for (const fn of ["rebalance", "executeSip"]) {
      const r = await check(basket, fn);
      if (r === "ok") todo.push([basket, fn]);
      else if (PRICE_FIXABLE.has(r)) {
        priceBlocked++;
        if (r === "StalePrice") staleBlocked++;
        todo.push([basket, fn]);
      } else if (QUIET.has(r)) tally.quiet++;
      else {
        tally.blocked++;
        log(`  ${basket} ${fn} blocked: ${r}`);
      }
    }
  }

  // Phase 2: pull fresh prices right before trading, then trade.
  if (todo.length && REFRESH && !DRY) {
    const age = await oldestPriceAge().catch(() => Infinity);
    // A stale price always needs a report. MinOut with prices already fresh means the venue itself
    // is off (a skewed testnet pool), which a report cannot fix: refreshing again would only burn gas.
    if (staleBlocked || age > REFRESH_AGE) {
      try {
        await reportPrices();
        tally.refreshed = 1;
        log(`  prices refreshed (oldest was ${age === Infinity ? "stale" : `${age}s`}) before ${todo.length} call(s)`);
      } catch (e) {
        log(`  price refresh FAILED: ${(e.shortMessage || e.message || "").split("\n")[0]}; trading on current prices`);
      }
    }
  }
  if (todo.length && DRY && priceBlocked) log(`  would refresh prices first (${priceBlocked} call(s) blocked by price age)`)
  for (const [basket, fn] of todo) await attempt(basket, fn, tally);

  log(`pass done: ${tally.baskets} baskets, ${tally.sent} sent, ${tally.would} would-send, ${tally.quiet} nothing-to-do, ${tally.blocked} blocked, ${tally.failed} failed${tally.refreshed ? ", prices refreshed" : ""}`);
  return tally;
}

(async () => {
  const bal = await withRetry(() => pub.getBalance({ address: account.address }), { label: "balance" });
  log(`rebalance keeper ${ONCE ? "(once)" : `every ${INTERVAL / 1000}s`}${DRY ? " [dry-run]" : ""}${REFRESH ? ", refreshes prices before trading" : ""} as ${account.address}, gas balance ${viem.formatEther(bal)} USDC`);
  if (!DRY && bal < viem.parseEther("0.05")) log("WARNING: gas balance is low; sends may fail until the keeper wallet is topped up");
  for (;;) {
    try {
      await pass();
    } catch (e) {
      log(`pass failed: ${(e.shortMessage || e.message || "").split("\n")[0]}`);
      if (ONCE) process.exitCode = 1;
    }
    if (ONCE) break;
    await new Promise((r) => setTimeout(r, INTERVAL));
  }
})();
