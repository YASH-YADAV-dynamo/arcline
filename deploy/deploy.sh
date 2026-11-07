#!/usr/bin/env bash
# Build Arcline from the repo and publish it behind Caddy. Run as root on the server:
#   sudo bash /opt/arcline/deploy/deploy.sh
# First run installs Caddy and Bun; later runs just pull, build and swap the files in.
set -euo pipefail
REPO=${REPO:-https://github.com/YASH-YADAV-dynamo/arcline.git}
DIR=/opt/arcline
WEB=/srv/arcline

# The Vite build needs more than a 2 GB box has free; a swap file keeps it from being OOM-killed.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q "^/swapfile" /etc/fstab || echo "/swapfile none swap sw 0 0" >> /etc/fstab
fi

if ! command -v caddy >/dev/null; then
  apt-get update -y
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg unzip
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi
if [ ! -x /root/.bun/bin/bun ]; then
  curl -fsSL https://bun.sh/install | bash -s "bun-v1.2.21"
fi
export PATH=/root/.bun/bin:$PATH

if [ -d "$DIR/.git" ]; then git -C "$DIR" fetch --depth 1 origin main && git -C "$DIR" reset --hard origin/main
else git clone --depth 1 "$REPO" "$DIR"; fi

cd "$DIR/app"
bun install --frozen-lockfile
NODE_OPTIONS=--max-old-space-size=1536 bunx vite build --logLevel warn 2>&1 | grep -v PURE || true
test -f dist/index.html

mkdir -p "$WEB"
rsync -a --delete dist/ "$WEB/" 2>/dev/null || { rm -rf "$WEB"/* && cp -r dist/. "$WEB/"; }
cp "$DIR/deploy/Caddyfile" /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemctl enable caddy >/dev/null 2>&1 || true
systemctl reload caddy 2>/dev/null || systemctl restart caddy
echo "deployed $(git -C "$DIR" rev-parse --short HEAD)"
