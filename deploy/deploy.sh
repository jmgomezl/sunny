#!/usr/bin/env bash
# Deploys Sunny to the shared VPS (the same box as Aivy/APEX).
#
#   deploy/deploy.sh setup   one-time: install the nginx site (HTTP) and reload nginx
#   deploy/deploy.sh tls     one-time, once DNS points here: HTTPS certificate via certbot
#   deploy/deploy.sh web     build and upload the Mini App
#   deploy/deploy.sh bot     build and upload the bot, then (re)start it under PM2
#
# Other apps share this server: only Sunny's site, folders and PM2 process are touched,
# and nginx is validated with `nginx -t` before every reload.
set -euo pipefail

HOST=root@167.172.152.172
DOMAIN=sunny.aivylabs.xyz
ROOT=$(cd "$(dirname "$0")/.." && pwd)

setup() {
  rsync -az "$ROOT/deploy/nginx/sunny.aivylabs" "$HOST:/etc/nginx/sites-available/sunny.aivylabs"
  ssh "$HOST" 'mkdir -p /var/www/sunny /opt/sunny \
    && ln -sfn /etc/nginx/sites-available/sunny.aivylabs /etc/nginx/sites-enabled/sunny.aivylabs \
    && nginx -t && systemctl reload nginx'
}

tls() {
  ssh "$HOST" "certbot --nginx -d $DOMAIN --non-interactive --redirect && nginx -t && systemctl reload nginx"
}

web() {
  pnpm --dir "$ROOT/web" build
  # New hashed assets first, then the page that points at them, so an open page never breaks.
  rsync -az "$ROOT/web/dist/assets/" "$HOST:/var/www/sunny/assets/"
  rsync -az --exclude assets --exclude index.html "$ROOT/web/dist/" "$HOST:/var/www/sunny/"
  rsync -az "$ROOT/web/dist/index.html" "$HOST:/var/www/sunny/index.html"
}

bot() {
  [ -f "$ROOT/.env" ] || { echo "Missing $ROOT/.env (copy .env.example and fill it in)"; exit 1; }
  pnpm --dir "$ROOT/bot" build
  rsync -az "$ROOT/bot/dist/bot.mjs" "$HOST:/opt/sunny/bot.mjs"
  rsync -az "$ROOT/brand/sunny-avatar-640.png" "$HOST:/opt/sunny/sunny-avatar.png"
  rsync -az "$ROOT/.env" "$HOST:/opt/sunny/.env"
  # Back off between crash restarts so a bad build can't hammer the shared server.
  # 240M: the x402 SDK and @solana/kit added ~30 MB over the 113 MB the bot used before.
  ssh "$HOST" 'chmod 600 /opt/sunny/.env && cd /opt/sunny && if pm2 describe sunny-bot >/dev/null 2>&1; then pm2 restart sunny-bot --max-memory-restart 240M; else \
    pm2 start bot.mjs --name sunny-bot --node-args="--env-file=/opt/sunny/.env" --max-memory-restart 240M \
      --exp-backoff-restart-delay=2000; fi && pm2 save >/dev/null'
  # Health check: the bot must have stayed up since the restart. 'online' alone isn't enough:
  # a crash loop with backoff also looks online for a moment (it happened on 2026-10-07).
  sleep 15
  ssh "$HOST" 'pm2 jlist | python3 -c "import json,sys,time; p=[p for p in json.load(sys.stdin) if p[\"name\"]==\"sunny-bot\"][0][\"pm2_env\"]; up=(time.time()*1000-p[\"pm_uptime\"])/1000; print(\"sunny-bot:\", p[\"status\"], \"up\", round(up), \"s, restarts:\", p[\"restart_time\"]); sys.exit(p[\"status\"]!=\"online\" or up<12)" \
    || { pm2 logs sunny-bot --err --lines 15 --nostream; exit 1; }'
}

case "${1:-}" in
  setup) setup ;;
  tls) tls ;;
  web) web ;;
  bot) bot ;;
  *) sed -n '3,8p' "$0"; exit 1 ;;
esac
