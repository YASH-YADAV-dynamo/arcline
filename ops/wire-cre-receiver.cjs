// Wires the CreReceiver adapter: authorizes it as an AssetRegistry reporter, removes the direct forwarder
// authorization (it can't deliver anyway: no ERC-165 on the registry), and points the CRE config at it.
// Usage: node ops/wire-cre-receiver.cjs <creReceiverAddress>
const fs = require("fs");
const path = require("path");
const { pub, A, abiOf, send, viem } = require("./lib.cjs");
const RECEIVER = process.argv[2];
const FORWARDER = "0x6e9ee680ef59ef64aa8c7371279c27e496b5edc1";
const CFG = path.join(__dirname, "..", "cre", "price-guard", "config.staging.json");
(async () => {
  if (!/^0x[0-9a-fA-F]{40}$/.test(RECEIVER || "")) throw new Error("usage: wire-cre-receiver.cjs <address>");
  const reg = abiOf("AssetRegistry");
  const R = viem.parseAbi(["function forwarder() view returns (address)", "function registry() view returns (address)", "function supportsInterface(bytes4) view returns (bool)"]);
  const [fw, rg, ok] = await Promise.all([
    pub.readContract({ address: RECEIVER, abi: R, functionName: "forwarder" }),
    pub.readContract({ address: RECEIVER, abi: R, functionName: "registry" }),
    pub.readContract({ address: RECEIVER, abi: R, functionName: "supportsInterface", args: ["0x805f2132"] }),
  ]);
  if (fw.toLowerCase() !== FORWARDER || rg.toLowerCase() !== A.registry.toLowerCase() || !ok) throw new Error(`receiver misconfigured: ${fw} ${rg} ${ok}`);
  const isRep = (a) => pub.readContract({ address: A.registry, abi: reg, functionName: "reporters", args: [a] });
  if (!(await isRep(RECEIVER))) await send({ address: A.registry, abi: reg, functionName: "setReporter", args: [RECEIVER, true] });
  if (await isRep(FORWARDER)) await send({ address: A.registry, abi: reg, functionName: "setReporter", args: [FORWARDER, false] });
  const cfg = JSON.parse(fs.readFileSync(CFG, "utf8"));
  const out = { schedule: cfg.schedule, chainSelectorName: cfg.chainSelectorName, registry: cfg.registry, receiver: RECEIVER, ...cfg };
  out.receiver = RECEIVER;
  fs.writeFileSync(CFG, JSON.stringify(out, null, 2));
  console.log("receiver reporter:", await isRep(RECEIVER), "| forwarder reporter:", await isRep(FORWARDER), "| config updated");
})().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
