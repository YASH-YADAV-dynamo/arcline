# Arcline: static build + Caddy. Built locally (the 2 GB server can't compile the bundle), pushed to ECR,
# pulled and run on EC2. Certificates live in the /data volume so they survive image updates.
FROM caddy:2.10-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY app/dist /srv/arcline
