// Live rebalance test on Arc Testnet: open a real basket, keep changing it the way a user would, and
// check that every change is rebalanced back to target, exactly the way the keeper does it in production
// (fresh price report right before the trade when prices are older than 90s, then rebalance()).
//
//   node ops/live-rebalance-test.cjs [depositUsdc=6]
//
// Rounds (each rebalance waits out the basket's 10 minute cooldown, so a full run takes ~40 minutes):
//   1. create  40% WETH / 30% cirBTC / 30% XAUM (mirror venues), deposit USDC  -> rebalance buys all three
//   2. deposit more USDC (new cash is off target)                              -> rebalance buys again
//   3. owner shifts targets to 20 / 50 / 30                                    -> rebalance sells WETH, buys cirBTC
//   4. owner withdraws half the gold                                           -> rebalance buys gold back
// After every rebalance it checks the basket is back inside its band and prints each trade.
// Spends testnet USDC from the operator wallet. Never logs the private key.
const { viem, pub, account, A, abiOf, ERC20, send, withRetry } = require("./lib.cjs");
const { run: reportPrices } = require("./report-prices.cjs");

const reg = abiOf("AssetRegistry");
const fac = abiOf("BucketFactory");
const bkt = abiOf("BucketAccount");
const DEPOSIT = viem.parseUnits(process.argv[2] || "6", 6);
const PARAMS = { bandBps: 200, maxSlippageBps: 150, maxTradeBps: 5000, cooldown: 600 };
const REFRESH_AGE = 90;

const stamp = () => new Date().toISOString().slice(11, 19);
const log = (m) => console.log(`[${stamp()}] ${m}`);
const rd = (address, abi, functionName, args = []) => withRetry(() => pub.readContract({ address, abi, functionName, args }), { label: functionName });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const sym = new Map();
async function symbolOf(t) {
  const k = t.toLowerCase();
  if (k === A.USDC.toLowerCase()) return "USDC";
  if (!sym.has(k)) sym.set(k, (await rd(A.registry, reg, "assetOf", [t])).symbol);
  return sym.get(k);
}
const bySymbol = async (s) => {
  for (const t of await rd(A.registry, reg, "assets")) if ((await symbolOf(t)) === s) return t;
  throw new Error(`${s} not listed`);
};

async function oldestAge() {
  const toks = (await rd(A.registry, reg, "assets")).filter((t) => t.toLowerCase() !== A.USDC.toLowerCase());
  const now = Number((await pub.getBlock()).timestamp);
  let oldest = 0;
  for (const t of toks) {
    try {
      const [, at] = await pub.readContract({ address: A.registry, abi: reg, functionName: "priceE8", args: [t] });
      oldest = Math.max(oldest, now - Number(at));
    } catch {
      return Infinity;
    }
  }
  return oldest;
}

async function show(bucket, label) {
  const [tokens, amounts, values, total] = await rd(bucket, bkt, "holdings");
  const [tt, tw] = await rd(bucket, bkt, "targets");
  const target = new Map(tt.map((t, i) => [t.toLowerCase(), tw[i]]));
  let drift = null;
  try {
    drift = (await rd(bucket, bkt, "driftBps"))[0];
  } catch { /* stale */ }
  const rows = [];
  for (let i = 0; i < tokens.length; i++) {
    const share = total > 0n ? Number((values[i] * 10000n) / total) / 100 : 0;
    const tgt = (target.get(tokens[i].toLowerCase()) ?? 0) / 100;
    rows.push(`${(await symbolOf(tokens[i])).padEnd(9)} ${share.toFixed(2).padStart(6)}% (target ${tgt.toFixed(0).padStart(2)}%)  ${viem.formatUnits(amounts[i], tokens[i].toLowerCase() === A.USDC.toLowerCase() ? 6 : 18)}`);
  }
  log(`${label}: value $${(Number(total) / 1e18).toFixed(4)}, max drift ${drift === null ? "n/a (stale price)" : `${(drift / 100).toFixed(2)}%`}`);
  for (const r of rows) console.log(`           ${r}`);
  return { drift, total };
}

/** Exactly the keeper's path: wait out cooldown, pull fresh prices if older than 90s, simulate, send. */
async function rebalance(bucket) {
  for (;;) {
    const last = Number(await rd(bucket, bkt, "lastRebalance"));
    const now = Number((await pub.getBlock()).timestamp);
    const wait = last + PARAMS.cooldown - now;
    if (wait > 0) {
      log(`cooldown: waiting ${wait}s`);
      await sleep((wait + 3) * 1000);
      continue;
    }
    const age = await oldestAge();
    if (age > REFRESH_AGE) {
      log(`prices ${age === Infinity ? "stale" : `${age}s old`}: posting a fresh report first`);
      await reportPrices();
    }
    try {
      await pub.simulateContract({ address: bucket, abi: bkt, functionName: "rebalance", account: account.address });
    } catch (e) {
      const msg = (e.shortMessage || e.message || "").split("\n").slice(0, 3).join(" ");
      if (/Cooldown/.test(msg)) continue;
      return { ok: false, why: msg };
    }
    const r = await send({ address: bucket, abi: bkt, functionName: "rebalance" });
    const legs = [];
    let tip = 0n;
    for (const l of r.logs) {
      if (l.address.toLowerCase() !== bucket.toLowerCase()) continue;
      try {
        const ev = viem.decodeEventLog({ abi: bkt, data: l.data, topics: l.topics });
        if (ev.eventName === "TradeExecuted") legs.push(ev.args);
        if (ev.eventName === "Rebalanced") tip = ev.args.tipUsdc;
      } catch { /* other events */ }
    }
    for (const g of legs) {
      const [i, o] = [await symbolOf(g.tokenIn), await symbolOf(g.tokenOut)];
      const dIn = i === "USDC" ? 6 : 18, dOut = o === "USDC" ? 6 : 18;
      console.log(`           trade  ${viem.formatUnits(g.amountIn, dIn)} ${i} -> ${viem.formatUnits(g.amountOut, dOut)} ${o}`);
    }
    log(`rebalanced: ${legs.length} trades, tip ${viem.formatUnits(tip, 6)} USDC, tx https://explorer.testnet.arc.io/tx/${r.transactionHash}`);
    return { ok: true, legs };
  }
}

/** Rebalance until inside the band (big gaps can need more than one pass, max trade is 50%). */
async function settle(bucket, name, expect) {
  for (let pass = 1; pass <= 3; pass++) {
    const r = await rebalance(bucket);
    if (!r.ok) return check(name, false, r.why);
    const sides = await Promise.all(r.legs.map(async (g) => `${await symbolOf(g.tokenIn)}>${await symbolOf(g.tokenOut)}`));
    if (expect && pass === 1) check(`${name}: expected trades`, expect(sides), sides.join(", ") || "none");
    const { drift } = await show(bucket, `after rebalance ${pass}`);
    if (drift !== null && drift <= PARAMS.bandBps) return check(name, true, `back inside the ${PARAMS.bandBps / 100}% band (drift ${(drift / 100).toFixed(2)}%) after ${pass} rebalance(s)`);
  }
  check(name, false, "still outside the band after 3 rebalances");
}

(async () => {
  const t0 = Date.now();
  log(`operator ${account.address}, gas ${viem.formatEther(await pub.getBalance({ address: account.address }))} USDC`);
  const [WETH, BTC, XAU] = await Promise.all(["WETH.m", "cirBTC.m", "XAUM.m"].map(bySymbol));

  // ---- round 1: open the basket ----
  log("ROUND 1: create basket 40% WETH / 30% cirBTC / 30% XAUM and deposit");
  await reportPrices();
  const before = await rd(A.factory, fac, "bucketsOf", [account.address]);
  await send({ address: A.factory, abi: fac, functionName: "createBucket", args: [`Live test ${new Date().toISOString().slice(0, 16)}`, [WETH, BTC, XAU], [4000, 3000, 3000], PARAMS] });
  const after = await rd(A.factory, fac, "bucketsOf", [account.address]);
  const bucket = after.find((b) => !before.includes(b)) ?? after[after.length - 1];
  log(`basket ${bucket}  https://explorer.testnet.arc.io/address/${bucket}`);
  await send({ address: A.USDC, abi: ERC20, functionName: "approve", args: [bucket, DEPOSIT * 2n] });
  await send({ address: bucket, abi: bkt, functionName: "deposit", args: [DEPOSIT] });
  await show(bucket, "after deposit");
  await settle(bucket, "round 1 (new deposit invested)", (s) => ["USDC>WETH.m", "USDC>cirBTC.m", "USDC>XAUM.m"].every((x) => s.includes(x)));

  // ---- round 2: more cash ----
  log("ROUND 2: deposit more USDC");
  await send({ address: bucket, abi: bkt, functionName: "deposit", args: [DEPOSIT / 2n] });
  await show(bucket, "after second deposit");
  await settle(bucket, "round 2 (extra cash invested)", (s) => s.length > 0 && s.every((x) => x.startsWith("USDC>")));

  // ---- round 3: owner changes the mix ----
  log("ROUND 3: change targets to 20% WETH / 50% cirBTC / 30% XAUM");
  await send({ address: bucket, abi: bkt, functionName: "setTargets", args: [[WETH, BTC, XAU], [2000, 5000, 3000]] });
  await show(bucket, "after new targets");
  await settle(bucket, "round 3 (mix changed: sells then buys)", (s) => s.includes("WETH.m>USDC") && s.includes("USDC>cirBTC.m") && s.indexOf("WETH.m>USDC") < s.indexOf("USDC>cirBTC.m"));

  // ---- round 4: owner pulls half the gold out ----
  log("ROUND 4: withdraw half the XAUM");
  const [tokens, amounts] = await rd(bucket, bkt, "holdings");
  const xi = tokens.findIndex((t) => t.toLowerCase() === XAU.toLowerCase());
  await send({ address: bucket, abi: bkt, functionName: "withdraw", args: [XAU, amounts[xi] / 2n, account.address] });
  await show(bucket, "after withdrawal");
  await settle(bucket, "round 4 (gold bought back)", (s) => s.some((x) => x.endsWith(">XAUM.m")));

  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} checks passed in ${Math.round((Date.now() - t0) / 60000)} min. Basket ${bucket}`);
  process.exitCode = bad.length ? 1 : 0;
})().catch((e) => {
  console.error("ERR", e.shortMessage || e.message);
  process.exit(1);
});
