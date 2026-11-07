// Accepts the 2-step ownership handoff on both registries (pending owner = our wallet).
const { pub, account, A, OWN, send } = require("./lib.cjs");
(async () => {
  for (const a of [A.registry, A.templates]) {
    const p = await pub.readContract({ address: a, abi: OWN, functionName: "pendingOwner" });
    if (p.toLowerCase() === account.address.toLowerCase()) await send({ address: a, abi: OWN, functionName: "acceptOwnership" });
    console.log(a, "owner now", await pub.readContract({ address: a, abi: OWN, functionName: "owner" }));
  }
})().catch((e) => { console.error("ERR", e.shortMessage || e.message); process.exit(1); });
