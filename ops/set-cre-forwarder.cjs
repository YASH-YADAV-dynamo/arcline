// Authorizes the Chainlink CRE forwarder on Arc testnet to write reports into AssetRegistry.onReport.
// Forwarder address = the `to` of a `cre workflow simulate --broadcast` tx (0xd65a2ac5…80bb).
// Usage: node ops/set-cre-forwarder.cjs [forwarder]
const { pub, A, abiOf, send } = require("./lib.cjs");
const FORWARDER = process.argv[2] || "0x6e9ee680ef59ef64aa8c7371279c27e496b5edc1";
(async () => {
  const reg = abiOf("AssetRegistry");
  if (await pub.readContract({ address: A.registry, abi: reg, functionName: "reporters", args: [FORWARDER] })) return console.log("already reporter");
  await send({ address: A.registry, abi: reg, functionName: "setReporter", args: [FORWARDER, true] });
  console.log("reporter:", await pub.readContract({ address: A.registry, abi: reg, functionName: "reporters", args: [FORWARDER] }));
})();
