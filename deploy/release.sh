#!/usr/bin/env bash
# Build Arcline locally, push the image to ECR, and run it on the EC2 box via SSM. Run from the repo root:
#   bash deploy/release.sh
set -euo pipefail
# Deploy freeze (Nov 2026): prices are stale until a price reporter is running again, so nothing ships
# by accident. Override deliberately with: DEPLOY=1 bash deploy/release.sh
if [ "${DEPLOY:-0}" != "1" ]; then echo "Deploys are frozen. Re-run with DEPLOY=1 to ship anyway." >&2; exit 1; fi
REGION=ap-south-1
INSTANCE=${INSTANCE:-i-0b0c935bda5d40a9f}
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REPO=$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/arcline
TAG=$(git rev-parse --short HEAD)

(cd app && bun install --frozen-lockfile && bunx vite build --logLevel warn)
aws ecr describe-repositories --region $REGION --repository-names arcline >/dev/null 2>&1 ||
  aws ecr create-repository --region $REGION --repository-name arcline >/dev/null
aws ecr get-login-password --region $REGION | docker login -u AWS --password-stdin "${REPO%/*}"
docker build --platform linux/amd64 -f deploy/Dockerfile -t "$REPO:$TAG" -t "$REPO:latest" .
docker build --platform linux/amd64 -f deploy/Dockerfile.worker -t "$REPO:worker-$TAG" .
docker push -q "$REPO:$TAG" && docker push -q "$REPO:latest" && docker push -q "$REPO:worker-$TAG"

# The box has no IAM role, so it gets a short-lived (12h) ECR pull token with the command.
PW=$(aws ecr get-login-password --region $REGION)
CMD="set -e
systemctl disable --now caddy 2>/dev/null || true
echo '$PW' | docker login -u AWS --password-stdin ${REPO%/*} >/dev/null
docker pull -q $REPO:$TAG
docker pull -q $REPO:worker-$TAG
docker rm -f arcline 2>/dev/null || true
docker run -d --name arcline --restart unless-stopped -p 80:80 -p 443:443 -p 443:443/udp \
  -v arcline_data:/data -v arcline_config:/config -v arcline_feed:/srv/feed:ro $REPO:$TAG
# Feed worker (prices every 60s + /feed snapshots). Its key lives only in /etc/arcline/worker.env (mode 600).
docker rm -f arcline-worker 2>/dev/null || true
if [ -f /etc/arcline/worker.env ]; then
  docker run -d --name arcline-worker --restart unless-stopped --env-file /etc/arcline/worker.env \
    --log-opt max-size=5m --log-opt max-file=2 -v arcline_feed:/feed $REPO:worker-$TAG
else
  echo 'WARN: /etc/arcline/worker.env missing, worker not started (run deploy/set-worker-key.sh)'
fi
docker logout ${REPO%/*} >/dev/null
docker image prune -f >/dev/null
docker ps --filter name=arcline --format '{{.Names}} {{.Image}} {{.Status}}'"
ID=$(aws ssm send-command --region $REGION --instance-ids "$INSTANCE" --document-name AWS-RunShellScript \
  --parameters "$(node -e 'console.log(JSON.stringify({commands:[process.argv[1]]}))' "$CMD")" \
  --query Command.CommandId --output text)
aws ssm wait command-executed --region $REGION --command-id "$ID" --instance-id "$INSTANCE" || true
aws ssm get-command-invocation --region $REGION --command-id "$ID" --instance-id "$INSTANCE" \
  --query '[Status,StandardOutputContent,StandardErrorContent]' --output text
