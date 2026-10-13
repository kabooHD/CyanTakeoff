#!/usr/bin/env bash
# One-time (and safe to re-run) server setup for Debian/Ubuntu: installs Caddy
# and rsync, installs the Caddyfile, opens HTTP/HTTPS in the firewall.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"

if ! command -v caddy >/dev/null; then
  apt-get update -y
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi
command -v rsync >/dev/null || apt-get install -y rsync

mkdir -p /var/www/cyantakeoff
install -m 644 "$here/Caddyfile" /etc/caddy/Caddyfile

if command -v ufw >/dev/null && ufw status | grep -q active; then
  ufw allow 80/tcp
  ufw allow 443/tcp
fi

systemctl enable --now caddy
systemctl reload caddy
echo "Server ready."
