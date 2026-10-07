#!/usr/bin/env bash
# Installs the Tally sync server on a Debian-based machine (e.g. Raspberry Pi OS)
# from an unpacked release bundle or a git checkout with app/dist built.
#   sudo ./server/deploy/install.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEST=/opt/tally

command -v node >/dev/null || { echo "Install Node.js 20+ first (e.g. sudo apt install nodejs)"; exit 1; }
[ -f "$ROOT/app/dist/index.html" ] || { echo "app/dist is missing — run 'npm --prefix app ci && npm --prefix app run build' first"; exit 1; }

id tally >/dev/null 2>&1 || useradd --system --home /var/lib/tally --shell /usr/sbin/nologin tally
mkdir -p "$DEST/server" "$DEST/app" /var/lib/tally
rm -rf "$DEST/server/src" "$DEST/app/dist"
cp -r "$ROOT/server/src" "$ROOT/server/package.json" "$DEST/server/"
cp -r "$ROOT/app/dist" "$DEST/app/"
[ -f "$DEST/tally-server.env" ] || cp "$ROOT/server/deploy/tally-server.env" "$DEST/tally-server.env"
chown -R tally:tally /var/lib/tally
cp "$ROOT/server/deploy/tally-server.service" /etc/systemd/system/tally-server.service
systemctl daemon-reload
systemctl enable --now tally-server
systemctl restart tally-server
echo
echo "Tally server is running on 127.0.0.1:8787."
echo "Expose it on your tailnet with HTTPS:"
echo "  sudo tailscale serve --bg --https=443 http://127.0.0.1:8787"
echo "Then open https://<this-machine>.<your-tailnet>.ts.net on your devices."
