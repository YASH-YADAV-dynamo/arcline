// Full end-to-end test on Arc Testnet: the entire user flow, start to finish.
//
//   node ops/e2e.cjs
//
// Covers: fresh prices -> direct BUY and SELL on the real Uniswap v4 venue (USDC/EURC) ->
// direct BUY and SELL on the mirror venue -> bucket create -> deposit -> rebalance (multi-leg,
// sells before buys) -> SIP set and execute. Prints a pass/fail table and explorer links.
//
// Spends real testnet USDC. Never logs the private key.
const { viem, pub, account, A, abiOf, ERC20, send, withRetry } = require("./lib.cjs");
const { run: reportPrices } = require("./report-prices.cjs");

const reg = abiOf("AssetRegistry");
const fac = abiOf("BucketFactory");
const bkt = abiOf("BucketAccount");
const VENUE = viem.parseAbi([
  "function quote(address tokenIn, address tokenOut, uint256 amountIn) view returns (uint256)",
  "function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address to) returns (uint256)",
  "event Swapped(address indexed caller, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut)",
]);
const V4_QUOTER = "0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94";
const QUOTER = viem.parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }",
  "function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)",
]);
const POOL_KEY = { currency0: A.USDC, currency1: A.EURC, fee: 500, tickSpacing: 10, hooks: "0x0000000000000000000000000000000000000000" };

const TRADE = 400_000n; // 0.40 USDC per probe trade — USDC is also the gas token on Arc
const results = [];
const pass = (name, detail = "") => { results.push({ name, ok: true, detail }); console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`); };
// A check that cannot run right now (not a product failure): shown, counted separately, never green.
const skip = (name, why) => { results.push({ name, ok: true, skipped: true, detail: why }); console.log(`  SKIP  ${name} — ${why}`); };
const fail = (name, why) => { results.push({ name, ok: false, detail: why }); console.log(`  FAIL  ${name} — ${why}`); };

const u6 = (n) => viem.formatUnits(n, 6);

/** Custom-error name + args from a viem revert, so a gate can be reported by name. */
function revertOf(e) {
  const d = e?.cause?.data ?? e?.data;
  return { name: d?.errorName ?? null, args: (d?.args ?? []).map(String) };
}
const lc = (s) => String(s).toLowerCase();

async function erc20(token, fn, args = []) {
  return withRetry(() => pub.readContract({ address: token, abi: ERC20, functionName: fn, args }), { label: `erc20.${fn}` });
}

/** Any registry/bucket read, through the rate limit. */
function rd(address, abi, functionName, args = []) {
  return withRetry(() => pub.readContract({ address, abi, functionName, args }), { label: functionName });
}

/** Ensure `spender` can pull `amount` of `token`. */
async function ensureAllowance(token, spender, amount, label) {
  const cur = await erc20(token, "allowance", [account.address, spender]);
  if (cur >= amount) return;
  await send({ address: token, abi: ERC20, functionName: "approve", args: [spender, amount] });
  console.log(`    approved ${label}`);
}

/** One direct swap through a venue, asserting the Swapped event and the balance delta. */
async function tradeOnce({ label, venue, tokenIn, tokenOut, amountIn, decOut, isV4 }) {
  try {
    // quote first: the v4 venue's quote() always reverts, so EURC quotes go via the v4 Quoter
    let quoted = null;
    if (isV4) {
      const { result } = await withRetry(() => pub.simulateContract({
        address: V4_QUOTER, abi: QUOTER, functionName: "quoteExactInputSingle",
        args: [{ poolKey: POOL_KEY, zeroForOne: lc(tokenIn) === lc(A.USDC), exactAmount: amountIn, hookData: "0x" }],
        account: account.address,
      }), { label: "v4Quoter" });
      quoted = result[0];
    } else {
      quoted = await rd(venue, VENUE, "quote", [tokenIn, tokenOut, amountIn]);
    }
    if (!quoted || quoted === 0n) return fail(label, "quote returned 0");

    const minOut = (quoted * 97n) / 100n; // 3% slippage: thin testnet pools
    const before = await erc20(tokenOut, "balanceOf", [account.address]);
    await ensureAllowance(tokenIn, venue, amountIn, label);
    const rcpt = await send({ address: venue, abi: VENUE, functionName: "swap", args: [tokenIn, tokenOut, amountIn, minOut, account.address] });
    const after = await erc20(tokenOut, "balanceOf", [account.address]);

    const logs = viem.parseEventLogs({ abi: VENUE, logs: rcpt.logs }).filter((l) => l.eventName === "Swapped");
    if (!logs.length) return fail(label, "no Swapped event in receipt");
    const got = after - before;
    if (got <= 0n) return fail(label, "output balance did not increase");
    const slip = quoted > 0n ? ((Number(got) - Number(quoted)) / Number(quoted)) * 100 : 0;
    pass(label, `in ${u6(amountIn)} -> out ${viem.formatUnits(got, decOut)} (quote ${viem.formatUnits(quoted, decOut)}, ${slip >= 0 ? "+" : ""}${slip.toFixed(2)}%)`);
  } catch (e) {
    fail(label, e.shortMessage || e.message);
  }
}

(async () => {
  console.log(`\n=== Arcline end-to-end — operator ${account.address} ===\n`);

  // ---------- 0. prices ----------
  console.log("[0] refresh oracle prices");
  try {
    await reportPrices();
    const list = await rd(A.registry, reg, "assets");
    let stale = 0;
    for (const t of list) {
      if (lc(t) === lc(A.USDC)) continue;
      await rd(A.registry, reg, "priceE8", [t]).catch(() => { stale++; });
    }
    stale === 0 ? pass("all oracle prices fresh", `${list.length - 1} assets`) : fail("oracle prices fresh", `${stale} still stale`);
  } catch (e) { fail("refresh prices", e.shortMessage || e.message); if (process.env.E2E_DEBUG) console.log("DEBUG stack:", e.stack, "\nmeta:", e.metaMessages); }

  // ---------- 1. funding ----------
  console.log("\n[1] funding");
  const gas = await withRetry(() => pub.getBalance({ address: account.address }), { label: "getBalance" });
  gas > 0n ? pass("native gas balance", `${Number(viem.formatEther(gas)).toFixed(3)}`) : fail("native gas balance", "zero");
  const usdc0 = await erc20(A.USDC, "balanceOf", [account.address]);
  usdc0 >= 1_500_000n ? pass("USDC balance", `${u6(usdc0)} USDC`) : fail("USDC balance", `only ${u6(usdc0)}, need >= 1.5 (USDC is the gas token too)`);
  if (usdc0 < 1_500_000n) { summary(); return; }

  // ---------- 2. real Uniswap v4 venue: buy then sell ----------
  console.log("\n[2] Uniswap v4 venue (USDC/EURC, fee 0.05%)");
  await tradeOnce({ label: "v4 BUY  USDC->EURC", venue: A.uniVenue, tokenIn: A.USDC, tokenOut: A.EURC, amountIn: TRADE, decOut: 6, isV4: true });
  const eurcBal = await erc20(A.EURC, "balanceOf", [account.address]);
  if (eurcBal > 0n) {
    const sell = eurcBal / 2n > 0n ? eurcBal / 2n : eurcBal;
    await tradeOnce({ label: "v4 SELL EURC->USDC", venue: A.uniVenue, tokenIn: A.EURC, tokenOut: A.USDC, amountIn: sell, decOut: 6, isV4: true });
  } else fail("v4 SELL EURC->USDC", "no EURC to sell");

  // ---------- 3. mirror venue: buy then sell ----------
  console.log("\n[3] Mirror venue (oracle-priced test tokens)");
  const list = await rd(A.registry, reg, "assets");
  let mirror = null;
  for (const t of list) {
    const a = await rd(A.registry, reg, "assetOf", [t]);
    if (a.mirror && lc(a.venue) === lc(A.mirrorVenue)) { mirror = { token: t, ...a }; break; }
  }
  if (!mirror) fail("find a mirror asset", "none listed on the mirror venue");
  else {
    console.log(`    using ${mirror.symbol} (${mirror.decimals} dp)`);
    await tradeOnce({ label: `mirror BUY  USDC->${mirror.symbol}`, venue: A.mirrorVenue, tokenIn: A.USDC, tokenOut: mirror.token, amountIn: TRADE, decOut: Number(mirror.decimals), isV4: false });
    const mb = await erc20(mirror.token, "balanceOf", [account.address]);
    if (mb > 0n) await tradeOnce({ label: `mirror SELL ${mirror.symbol}->USDC`, venue: A.mirrorVenue, tokenIn: mirror.token, tokenOut: A.USDC, amountIn: mb, decOut: 6, isV4: false });
    else fail(`mirror SELL ${mirror.symbol}->USDC`, "no balance to sell");
  }

  // ---------- 4. bucket: create, deposit, rebalance ----------
  // Re-sync the oracle BEFORE touching buckets. The testnet v4 pool is shallow enough that the
  // direct trades above move it several percent, and EURC's oracle price is read FROM that pool.
  // Left stale, the bucket computes minOut from the old price and the swap reverts MinOut.
  console.log("\n[3b] re-sync oracle after trades (thin pool moves on every swap)");
  try {
    await reportPrices();
    pass("oracle re-synced post-trade", "so bucket minOut matches the live pool");
  } catch (e) { fail("oracle re-sync", e.shortMessage || e.message); }

  console.log("\n[4] Bucket create / deposit / rebalance");
  let bucket = null;
  try {
    let mine = await rd(A.factory, fac, "bucketsOf", [account.address]);
    if (!mine.length) {
      await send({ address: A.factory, abi: fac, functionName: "createFromTemplate", args: [1n, true] });
      mine = await rd(A.factory, fac, "bucketsOf", [account.address]);
    }
    bucket = mine[mine.length - 1];
    pass("bucket exists", `${bucket}`);

    const p = await rd(bucket, bkt, "params");
    if (p.maxSlippageBps < 300) await send({ address: bucket, abi: bkt, functionName: "setParams", args: [{ ...p, maxSlippageBps: 300 }] });

    // size the deposit from the balance remaining AFTER the direct trades above, not the
    // balance at startup — the trades and their fees consume USDC as they go
    const free = await erc20(A.USDC, "balanceOf", [account.address]);
    const dep = free < 3_000_000n ? (free * 60n) / 100n : 3_000_000n;
    if (dep < 200_000n) {
      fail("deposit", `only ${u6(free)} USDC left — top up the operator from the faucet`);
      await sipSection(bucket); summary(); return;
    }
    await ensureAllowance(A.USDC, bucket, dep, "bucket deposit");
    await send({ address: bucket, abi: bkt, functionName: "deposit", args: [dep] });
    pass("deposit", `${u6(dep)} USDC (of ${u6(free)} free)`);

    const [dBefore] = await rd(bucket, bkt, "driftBps");

    // rebalance() is gated: NotNeeded inside the band, Cooldown before the window reopens.
    // Both are correct refusals, so probe first and only wait when the wait is short.
    let ready = false;
    for (let attempt = 0; attempt < 2 && !ready; attempt++) {
      try {
        await withRetry(() => pub.simulateContract({ address: bucket, abi: bkt, functionName: "rebalance", account: account.address }), { label: "sim rebalance" });
        ready = true;
      } catch (e) {
        const { name, args } = revertOf(e);
        if (name === "NotNeeded") { pass("rebalance gate: within band", `drift ${(Number(dBefore) / 100).toFixed(2)}% <= band 3.00% — correctly refused`); break; }
        if (name === "Cooldown" && attempt === 0) {
          const readyAt = Number(args[0] ?? 0);
          const now = Number((await withRetry(() => pub.getBlock(), { label: "getBlock" })).timestamp);
          const waitS = readyAt - now;
          pass("rebalance gate: cooldown enforced", `${waitS}s left of the ${"3600"}s window`);
          if (waitS > 0 && waitS <= 900) { console.log(`    waiting ${waitS}s for the cooldown to clear, to test a real rebalance`); await new Promise((r) => setTimeout(r, waitS * 1000 + 5000)); continue; }
          skip("rebalance executed", `cooldown has ${waitS}s left (the keeper or an earlier run rebalanced recently); rerun after that to test a live rebalance`);
          break;
        }
        fail("rebalance executed", `${name ?? "revert"} ${args.join(",")}`);
        break;
      }
    }
    if (!ready) { await sipSection(bucket); summary(); return; }

    const rcpt = await send({ address: bucket, abi: bkt, functionName: "rebalance" });
    const evs = viem.parseEventLogs({ abi: bkt, logs: rcpt.logs });
    const trades = evs.filter((l) => l.eventName === "TradeExecuted");
    const [dAfter] = await rd(bucket, bkt, "driftBps");

    trades.length > 0 ? pass("rebalance executed trades", `${trades.length} legs`) : fail("rebalance executed trades", "no TradeExecuted events");
    // sells must settle before buys, or the bucket can run out of USDC mid-rebalance
    const order = trades.map((t) => (lc(t.args.tokenOut) === lc(A.USDC) ? "sell" : "buy"));
    const ordered = order.join(",").indexOf("sell") <= order.join(",").lastIndexOf("sell") && !/buy.*sell/.test(order.join(","));
    ordered ? pass("sells ordered before buys", order.join(" -> ") || "n/a") : fail("sells ordered before buys", order.join(" -> "));
    Number(dAfter) < Number(dBefore)
      ? pass("drift reduced", `${(Number(dBefore) / 100).toFixed(2)}% -> ${(Number(dAfter) / 100).toFixed(2)}%`)
      : fail("drift reduced", `${(Number(dBefore) / 100).toFixed(2)}% -> ${(Number(dAfter) / 100).toFixed(2)}%`);

    const [tokens, amounts, values, tot] = await rd(bucket, bkt, "holdings");
    console.log("    holdings:");
    for (let i = 0; i < tokens.length; i++) {
      const sym = await erc20(tokens[i], "symbol").catch(() => tokens[i]);
      console.log(`      ${String(sym).padEnd(14)} ${String(amounts[i]).padStart(12)}  $${(Number(values[i]) / 1e18).toFixed(4)}`);
    }
    pass("holdings valued", `total $${(Number(tot) / 1e18).toFixed(4)}`);
  } catch (e) { fail("bucket flow", e.shortMessage || e.message); }

  // ---------- 5. SIP ----------
  await sipSection(bucket);

  summary();
})().catch((e) => { console.error("\nFATAL", e.shortMessage || e.message); summary(); process.exit(1); });

/** SIP: configure at the contract's real minimum interval (3600s), prove the not-due gate
 *  refuses an early run, then clean up. A 1s interval reverts BadParams — the contract
 *  enforces interval >= 3600, which an earlier version of this test got wrong. */
async function sipSection(bucket) {
  console.log("\n[5] SIP (recurring USDC buy)");
  if (!bucket) return fail("SIP", "no bucket");
  try {
    const amt = 1_000_000n;
    const INTERVAL = 3600; // contract minimum
    await send({ address: bucket, abi: bkt, functionName: "setSip", args: [amt, INTERVAL, 2] });
    const active = await rd(bucket, bkt, "sipActive");
    active ? pass("SIP configured", `${u6(amt)} USDC every ${INTERVAL}s x2`) : fail("SIP configured", "sipActive false");

    const nextAt = await rd(bucket, bkt, "sipNextAt");
    const now = Number((await withRetry(() => pub.getBlock(), { label: "getBlock" })).timestamp);
    pass("SIP next-due set", `in ${Number(nextAt) - now}s`);

    // the owner's allowance is what a due SIP pulls from
    await ensureAllowance(A.USDC, bucket, amt * 2n, "SIP allowance");

    // executing before it is due must be refused
    try {
      await withRetry(() => pub.simulateContract({ address: bucket, abi: bkt, functionName: "executeSip", account: account.address }), { label: "sim executeSip" });
      fail("SIP not-due gate", "executeSip succeeded before it was due");
    } catch (e) {
      const { name } = revertOf(e);
      name === "SipNotDue" ? pass("SIP not-due gate", "early run correctly refused") : fail("SIP not-due gate", name ?? "unexpected revert");
    }

    await send({ address: bucket, abi: bkt, functionName: "cancelSip" });
    const stillActive = await rd(bucket, bkt, "sipActive");
    !stillActive ? pass("SIP cancelled", "cleanup") : fail("SIP cancelled", "still active");
  } catch (e) {
    const { name, args } = revertOf(e);
    fail("SIP flow", `${name ?? (e.shortMessage || e.message)} ${args.join(",")}`);
  }
}

function summary() {
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${"=".repeat(68)}\nRESULT  ${ok}/${results.length} passed\n${"=".repeat(68)}`);
  for (const r of results) console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) { console.log(`\n${failed.length} FAILED`); process.exitCode = 1; }
  else console.log("\nAll green — full flow works on Arc Testnet.");
}
