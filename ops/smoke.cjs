// Live smoke test on Arc Testnet: refresh prices, create a "Global FX" bucket from template 1,
// deposit 5 USDC, then rebalance (real Uniswap v4 USDC->EURC + mirror GBPA buy). Prints explorer links.
const { viem, pub, account, A, abiOf, ERC20, send } = require("./lib.cjs");
const { run: reportPrices } = require("./report-prices.cjs");
const fac = abiOf("BucketFactory"), bkt = abiOf("BucketAccount");

(async () => {
  await reportPrices();
  let mine = await pub.readContract({ address: A.factory, abi: fac, functionName: "bucketsOf", args: [account.address] });
  if (!mine.length) {
    await send({ address: A.factory, abi: fac, functionName: "createFromTemplate", args: [1n, true] });
    mine = await pub.readContract({ address: A.factory, abi: fac, functionName: "bucketsOf", args: [account.address] });
  }
  const b = mine[mine.length - 1];
  console.log("bucket", b, `https://explorer.testnet.arc.io/address/${b}`);

  const p = await pub.readContract({ address: b, abi: bkt, functionName: "params" });
  if (p.maxSlippageBps < 300) // thin testnet pool: allow the contract's max 3%
    await send({ address: b, abi: bkt, functionName: "setParams", args: [{ ...p, maxSlippageBps: 300 }] });

  const amt = viem.parseUnits("5", 6);
  const [, , , total] = await pub.readContract({ address: b, abi: bkt, functionName: "holdings" });
  if (total === 0n) {
    await send({ address: A.USDC, abi: ERC20, functionName: "approve", args: [b, amt] });
    await send({ address: b, abi: bkt, functionName: "deposit", args: [amt] });
  }
  const [maxDrift] = await pub.readContract({ address: b, abi: bkt, functionName: "driftBps" });
  console.log("drift before", Number(maxDrift) / 100, "%");
  const r = await send({ address: b, abi: bkt, functionName: "rebalance" });
  const logs = viem.parseEventLogs({ abi: bkt, logs: r.logs });
  for (const l of logs) if (l.eventName === "TradeExecuted" || l.eventName === "Rebalanced") console.log(" ", l.eventName, JSON.stringify(l.args, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

  const [tokens, amounts, values, tot] = await pub.readContract({ address: b, abi: bkt, functionName: "holdings" });
  for (let i = 0; i < tokens.length; i++) {
    const sym = await pub.readContract({ address: tokens[i], abi: ERC20, functionName: "symbol" }).catch(() => tokens[i]);
    console.log(`  ${String(sym).padEnd(14)} amount ${amounts[i]}  value $${(Number(values[i]) / 1e18).toFixed(4)}`);
  }
  console.log("  total $", (Number(tot) / 1e18).toFixed(4));
  const [after] = await pub.readContract({ address: b, abi: bkt, functionName: "driftBps" });
  console.log("drift after", Number(after) / 100, "%");
})().catch((e) => { console.error("ERR", e.shortMessage || e.message, e.metaMessages ? e.metaMessages.join(" ") : ""); process.exit(1); });
