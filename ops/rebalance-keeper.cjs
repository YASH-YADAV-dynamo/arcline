// Basket rebalance keeper: makes rebalancing AUTOMATIC.
//
//   node ops/rebalance-keeper.cjs [intervalSeconds]   # loop (default 120s, min 30s)
//   node ops/rebalance-keeper.cjs --once              # one pass, then exit (cron / CI)
//   node ops/rebalance-keeper.cjs --dry               # simulate only, never send
//
// BucketAccount.rebalance() and executeSip() are permissionless by design: anyone may call them, the
// contract enforces every gate (drift band, cooldown, max trade size, slippage, risk exits) and pays the
// caller a capped tip. So automation needs no privileged role. Each pass reads every basket from the
// factory, SIMULATES the call first, and only sends when the contract says it would succeed. That keeps
// the normal "not needed / cooldown" cases free of gas and noise.
//
// Needs ARC_PRIVATE_KEY (env or .env) for a wallet with a little USDC for gas. Never logs the key.
const { viem, pub, wal, account, A, abiOf, FEES, withRetry } = require("./lib.cjs");

const args = process.argv.slice(2);
const ONCE = args.includes("--once");
const DRY = args.includes("--dry");
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
  "error RiskBlocked()",
  "error TradeTooLarge()",
  "error InsufficientReserve()",
  "error Unsupported()",
]);

// Outcomes that just mean "nothing to do right now". Everything else is surfaced.
const QUIET = new Set(["NotNeeded", "Cooldown", "Paused_", "SipInactive", "SipNotDue"]);

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
  const tally = { baskets: 0, sent: 0, would: 0, quiet: 0, blocked: 0, failed: 0 };
  const count = Number(await withRetry(() => pub.readContract({ address: A.factory, abi: factoryAbi, functionName: "bucketCount" }), { label: "bucketCount" }));
  for (let i = 0; i < count; i++) {
    const basket = await withRetry(() => pub.readContract({ address: A.factory, abi: factoryAbi, functionName: "bucketAt", args: [BigInt(i)] }), { label: "bucketAt" });
    tally.baskets++;
    await attempt(basket, "rebalance", tally);
    await attempt(basket, "executeSip", tally);
  }
  log(`pass done: ${tally.baskets} baskets, ${tally.sent} sent, ${tally.would} would-send, ${tally.quiet} nothing-to-do, ${tally.blocked} blocked, ${tally.failed} failed`);
  return tally;
}

(async () => {
  const bal = await withRetry(() => pub.getBalance({ address: account.address }), { label: "balance" });
  log(`rebalance keeper ${ONCE ? "(once)" : `every ${INTERVAL / 1000}s`}${DRY ? " [dry-run]" : ""} as ${account.address}, gas balance ${viem.formatEther(bal)} USDC`);
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
