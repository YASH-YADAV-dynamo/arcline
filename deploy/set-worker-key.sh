#!/usr/bin/env bash
# One-time: put the Arc TESTNET reporter key on the server for the feed worker, as /etc/arcline/worker.env
# (root-only, mode 600). Reads ARC_PRIVATE_KEY from the repo's .env; never prints it.
# Note: SSM keeps the command text in its history, so this is for a TESTNET key only.
set -euo pipefail
REGION=ap-south-1
INSTANCE=${INSTANCE:-i-0b0c935bda5d40a9f}
KEY=$(grep -m1 '^ARC_PRIVATE_KEY=' .env | cut -d= -f2- | tr -d '\r[:space:]')
[[ $KEY =~ ^0x[0-9a-fA-F]{64}$ ]] || { echo "ARC_PRIVATE_KEY missing or malformed in .env"; exit 1; }
B64=$(printf 'ARC_PRIVATE_KEY=%s\n' "$KEY" | base64 -w0)
CMD="umask 077; mkdir -p /etc/arcline; echo $B64 | base64 -d > /etc/arcline/worker.env; chmod 600 /etc/arcline/worker.env; echo written"
ID=$(aws ssm send-command --region $REGION --instance-ids "$INSTANCE" --document-name AWS-RunShellScript \
  --parameters "$(node -e 'console.log(JSON.stringify({commands:[process.argv[1]]}))' "$CMD")" \
  --query Command.CommandId --output text)
aws ssm wait command-executed --region $REGION --command-id "$ID" --instance-id "$INSTANCE" || true
aws ssm get-command-invocation --region $REGION --command-id "$ID" --instance-id "$INSTANCE" --query '[Status,StandardOutputContent]' --output text
