// Read-only: checks the deployed system on Arc Testnet.
const { viem, pub, account, A, abiOf, ERC20, OWN } = require("./lib.cjs");
(async () => {
  const reg = abiOf("AssetRegistry");
  console.log("wallet", account.address, "USDC", viem.formatUnits(await pub.readContract({ address: A.USDC, abi: ERC20, functionName: "balanceOf", args: [account.address] }), 6));
  for (const [n, a] of [["AssetRegistry", A.registry], ["TemplateRegistry", A.templates]])
    console.log(n, "owner", await pub.readContract({ address: a, abi: OWN, functionName: "owner" }), "pending", await pub.readContract({ address: a, abi: OWN, functionName: "pendingOwner" }).catch(() => "-"));
  const list = await pub.readContract({ address: A.registry, abi: reg, functionName: "assets" });
  for (const t of list) {
    const a = await pub.readContract({ address: A.registry, abi: reg, functionName: "assetOf", args: [t] });
    let p = "stale/unset";
    try { const [pr, at] = await pub.readContract({ address: A.registry, abi: reg, functionName: "priceE8", args: [t] }); p = `$${Number(pr) / 1e8} @ ${new Date(Number(at) * 1000).toISOString()}`; } catch {}
    const risk = await pub.readContract({ address: A.registry, abi: reg, functionName: "riskOf", args: [t] });
    console.log(` ${a.symbol.padEnd(12)} cat=${a.category} dec=${a.decimals} mirror=${a.mirror} risk=${risk} price=${p} ref=${a.mainnetRef || "-"}`);
  }
  const tr = abiOf("TemplateRegistry"), n = await pub.readContract({ address: A.templates, abi: tr, functionName: "templateCount" });
  for (let i = 0n; i < n; i++) { const t = await pub.readContract({ address: A.templates, abi: tr, functionName: "templateOf", args: [i] }); console.log(` template ${i}: ${t.name} v${t.version} band ${t.bandBps} weights ${t.weightsBps.join("/")}`); }
})().catch((e) => { console.error("ERR", e.shortMessage || e.message); process.exit(1); });
