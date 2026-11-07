// Price keeper loop: re-runs the price reporter on an interval so registry prices never go stale
// and PriceUpdated history accumulates for the on-chain chart series.
//
//   node ops/keeper-loop.cjs [intervalSeconds]
//
// Liveness backstop only. The Chainlink CRE workflow in cre/price-guard is the real feed; this
// exists because that workflow is not deployed to a DON yet. Never logs the private key.
const { execFile } = require("child_process");
const path = require("path");

const INTERVAL = Math.max(60, Number(process.argv[2] || 300)) * 1000;
const SCRIPT = path.join(__dirname, "report-prices.cjs");
const stamp = () => new Date().toISOString().replace("T", " ").slice(0, 19);

let runs = 0;
let fails = 0;

function once() {
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT], { cwd: path.resolve(__dirname, "..") }, (err, stdout, stderr) => {
      runs++;
      const out = String(stdout || "").trim().split("\n");
      const tx = out.find((l) => l.includes("tx success")) || "";
      const skips = out.filter((l) => l.includes("skip")).length;
      if (err) {
        fails++;
        // stderr can carry an RPC URL but never the key (lib.cjs reads it without logging)
        console.log(`[${stamp()}] run ${runs} FAILED (${fails} total): ${String(stderr || err.message).trim().split("\n")[0]}`);
      } else {
        console.log(`[${stamp()}] run ${runs} ok, ${skips} skipped${tx ? ` — ${tx.trim()}` : ""}`);
      }
      resolve();
    });
  });
}

(async () => {
  console.log(`[${stamp()}] keeper loop started, interval ${INTERVAL / 1000}s — Ctrl+C to stop`);
  for (;;) {
    await once();
    await new Promise((r) => setTimeout(r, INTERVAL));
  }
})();
