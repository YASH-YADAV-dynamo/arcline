#!/usr/bin/env bash
# Sync the Arc Studio workspace to the local app UI, exactly. Run from the repo root:  bash studio/sync-ui.sh
# Pulls Studio's current files, attaches every app file that differs (placed at its exact workspace path),
# then runs PROMPT-13 so Studio only verifies. package.json, tailwind and postcss configs are never sent.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
command -v arc-studio >/dev/null || { echo "arc-studio not on PATH" >&2; exit 1; }
TMP=$(mktemp -d)
arc-studio pull --session arc-treasury --out "$TMP" >/dev/null 2>&1
ARGS=()
cd app
for f in $(git ls-files src public index.html vite.config.ts); do
  if [ ! -f "$TMP/$f" ] || ! diff -q --strip-trailing-cr "$f" "$TMP/$f" >/dev/null; then ARGS+=(--file "app/$f:$f"); fi
done
for f in src/data/market-snapshots.json src/lib/feed.ts; do # untracked-safe: make sure these always go
  [ -f "$f" ] && [[ " ${ARGS[*]} " != *" app/$f:$f "* ]] && { [ ! -f "$TMP/$f" ] || ! diff -q --strip-trailing-cr "$f" "$TMP/$f" >/dev/null; } && ARGS+=(--file "app/$f:$f")
done
cd ..
echo "attaching $(( ${#ARGS[@]} / 2 )) files"
arc-studio usage | head -1
arc-studio run --prompt-file studio/PROMPT-13-sync-ui.md --session arc-treasury --output json --timeout 60 "${ARGS[@]}" > studio/turn13.json 2> studio/turn13.log
code=$?
node -e 'const r=require("./studio/turn13.json");console.log("status",r.status,"| url",r.webUrl,"| files",(r.filesChanged||[]).length);console.log(String(r.result||r.text||r.message||"").slice(0,1500))' 2>/dev/null || echo "no JSON result; see studio/turn13.log"
rm -rf "$TMP"
exit $code
