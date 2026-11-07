#!/usr/bin/env bash
# Runs one Arc Studio turn that writes, tests and deploys the OpenAlpha Arc contracts + preview app,
# then copies (never invents) the reported deployments and Studio URL into arc/deployments.json.
#
#   bash arc/run-studio.sh            # from the repo root (or anywhere: paths are resolved)
#   SESSION=openalpha-arc-2 bash arc/run-studio.sh
#
# Needs: `arc-studio whoami` to pass (a human runs `arc-studio login --paste` once) and node on PATH.
# Never prints the Arc Studio token or any key.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

SESSION="${SESSION:-openalpha-arc}"
RESULT="arc/studio-result.json"
OUT="arc/deployments.json"

command -v arc-studio >/dev/null 2>&1 || { echo "arc-studio CLI not found on PATH" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "node not found on PATH (used to parse the result JSON)" >&2; exit 1; }
arc-studio whoami >/dev/null 2>&1 || { echo "Not logged in: run 'arc-studio login --paste' in a normal terminal first" >&2; exit 1; }

PROMPT_CHARS=$(wc -c < arc/PROMPT.md | tr -d ' ')
if [ "$PROMPT_CHARS" -gt 10000 ]; then
  echo "arc/PROMPT.md is $PROMPT_CHARS chars; Arc Studio caps prompts at 10000" >&2
  exit 1
fi

echo "Running Arc Studio turn (session $SESSION). Contract deploys take 5-20 min; progress goes to stderr." >&2
TMP="$(mktemp)"
arc-studio run \
  --prompt-file arc/PROMPT.md \
  --file arc/IOpenAlpha.sol \
  --session "$SESSION" \
  --output json > "$TMP"
CODE=$?
# 0 completed, 3 needs_input, 4 budget_exceeded, 1 error. The JSON result is still on stdout for all of them.

if ! node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$TMP" 2>/dev/null; then
  echo "arc-studio exited $CODE without a JSON result; nothing written. Recover with: arc-studio attach --session $SESSION --output json" >&2
  rm -f "$TMP"
  exit 1
fi
mv "$TMP" "$RESULT"
echo "Saved $RESULT (arc-studio exit $CODE)" >&2

# Copy only fields Arc Studio reported. Addresses/hashes are format-checked, never generated.
node - "$RESULT" "$OUT" <<'NODE'
const fs = require("fs");
const [resultPath, outPath] = process.argv.slice(2);
const r = JSON.parse(fs.readFileSync(resultPath, "utf8"));
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const str = (v) => (typeof v === "string" && v.length < 500 ? v : null);
const deployments = (Array.isArray(r.deployments) ? r.deployments : [])
  .filter((d) => d && ADDR.test(d.address))
  .map((d) => ({
    contract: str(d.contract),
    address: d.address,
    network: str(d.network),
    explorerUrl: str(d.explorerUrl),
    txHash: HASH.test(d.txHash ?? "") ? d.txHash : null,
  }));
const pick = (name) => [...deployments].reverse().find((d) => d.contract === name)?.address ?? null;
const out = {
  note: "Copied verbatim from arc/studio-result.json by arc/run-studio.sh. Arc Testnet (chain 5042002). Testnet only.",
  copiedAt: new Date().toISOString(),
  status: str(r.status),
  appId: str(r.appId),
  webUrl: str(r.webUrl),
  chainId: 5042002,
  bountyVault: pick("OpenAlphaBountyVault"),
  basketLedger: pick("OpenAlphaBasketLedger"),
  deployments,
};
fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
console.error(`Wrote ${outPath}: status=${out.status}, ${deployments.length} deployment(s), vault=${out.bountyVault ?? "missing"}, ledger=${out.basketLedger ?? "missing"}, webUrl=${out.webUrl ? "yes" : "missing"}`);
if (r.status === "needs_input") console.error("Arc Studio needs input: see questions in " + resultPath + ", then rerun with --answers-json on the same session.");
NODE

exit "$CODE"
