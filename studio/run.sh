#!/usr/bin/env bash
# Arcline: Arc Studio turns. Run from anywhere:  bash studio/run.sh 1   then   bash studio/run.sh 2
# Turn 1 = contracts+tests+deploy. Turn 2 = frontend. Saves results to studio/turn<N>.json. Never prints secrets.
set -uo pipefail
cd "$(dirname "$0")" || exit 1
T="${1:?usage: run.sh 1|2}"
command -v arc-studio >/dev/null || { echo "arc-studio not on PATH" >&2; exit 1; }
arc-studio whoami >/dev/null 2>&1 || { echo "not logged in to arc-studio" >&2; exit 1; }
for f in PROMPT-1-contracts.md PROMPT-2-frontend.md; do [ "$(wc -c < "$f")" -le 10000 ] || { echo "$f over 10000 chars" >&2; exit 1; }; done
arc-studio usage | head -1
if [ "$T" = 1 ]; then
  arc-studio run --prompt-file PROMPT-1-contracts.md --file IArcTreasury.sol --session arc-treasury --output json --timeout 60 > turn1.json 2> turn1.log
else
  REF=../../openalpha/web/src/components/trade
  arc-studio run --prompt-file PROMPT-2-frontend.md --session arc-treasury --output json --timeout 60 \
    --file "$REF/Terminal.tsx" --file "$REF/OrderTicket.tsx" --file "$REF/PriceChart.tsx" --file "$REF/OrderBook.tsx" > turn2.json 2> turn2.log
fi
code=$?
node -e 'const r=require("./turn'"$T"'.json");console.log("status",r.status,"| app",r.appId,"| url",r.webUrl,"| deployments",(r.deployments||[]).length,"| files",(r.filesChanged||[]).length);if(r.questions)console.log("QUESTIONS",JSON.stringify(r.questions))' 2>/dev/null || echo "no JSON result; try: arc-studio attach --session arc-treasury --output json"
arc-studio usage | head -1
exit $code
