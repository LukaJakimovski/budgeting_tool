# Self-hosting the sync server

The sync server is one small Node.js program with **no dependencies**. It
stores your vault, keeps rotating backups, and also serves the web app — so
the same address works for the browser, the installed PWA, the Linux app and
the Android app.

This guide uses a Raspberry Pi reached over Tailscale, but any always-on Linux
machine works.

```
 phone (APK) ─┐
 laptop (Arch)├── Tailscale (WireGuard, encrypted) ──► Pi: tailscale serve :443 ──► tally-server 127.0.0.1:8787
 browser ─────┘                                                                    └─ /var/lib/tally (vaults, backups, exports)
```

## How sync works (the plan in one paragraph)

Every device keeps its **own full copy** of your data and works offline. Each
change is saved on the device first, then pushed to the server in the
background; other devices pull it on their next sync (on open, when they come
back online, and every minute while open). The server is just an ordered log
per vault plus your receipt files and daily backups — it never needs to be
"up" for you to log a purchase. Details: [sync-protocol.md](sync-protocol.md).

## 1. Install

### Option A — Docker (recommended)

The release workflow publishes a ready-made image for amd64, arm64 (Pi 4/5 on a
64-bit OS) and armv7 (32-bit Pi OS): `ghcr.io/lukajakimovski/tally-server`.
You don't need the source code on the Pi — save this as
`~/tally/docker-compose.yml`:

```yaml
services:
  tally:
    image: ghcr.io/lukajakimovski/tally-server:latest
    restart: unless-stopped
    ports:
      - "127.0.0.1:8787:8787"   # only this machine; tailscale serve exposes it
    volumes:
      - ./data:/data            # vaults, receipts, exports, backups
      # - /home/pi/Sync/tally-backups:/backups   # + TALLY_BACKUP_DIR=/backups
    environment:
      TZ: America/Toronto
```

```bash
cd ~/tally && docker compose up -d
```

* Data lives in `~/tally/data` (owned by uid 1000 — the default `pi` user).
* Update: `docker compose pull && docker compose up -d`.
* Logs: `docker logs -f tally`.
* Tags: `latest` and `x.y.z` for releases (`v*` git tags), `edge` for manual
  builds of the release workflow.
* Building it yourself instead (from a checkout):
  `docker compose -f server/docker-compose.yml up -d --build`.

### Option B — directly with Node (systemd)

```bash
# Node.js 20+ (Raspberry Pi OS / Debian)
sudo apt install -y nodejs npm git

git clone https://github.com/LukaJakimovski/budgeting_tool.git tally
cd tally
npm --prefix app ci && npm --prefix app run build   # builds the web app (~1 min on a Pi 4)
sudo ./server/deploy/install.sh
```

The installer copies the server and the built app to `/opt/tally`, creates a
`tally` system user, stores data in `/var/lib/tally`, and enables the
`tally-server` systemd service on `127.0.0.1:8787`.

Instead of building on the Pi you can download `tally-server.tar.gz` from a
GitHub release (it contains the built app), unpack it and run the same
`sudo ./server/deploy/install.sh`.

### Option C — just run it

```bash
npm --prefix app ci && npm --prefix app run build
node server/src/index.js serve          # http://0.0.0.0:8787, data in server/data
```

Either way the server needs about 50 MB of RAM and almost no CPU.

## 2. Make it reachable over Tailscale with HTTPS

```bash
sudo tailscale serve --bg --https=443 http://127.0.0.1:8787
```

Your server is now at `https://<pi-name>.<tailnet>.ts.net` — only from devices
on your tailnet, with a real TLS certificate (enable *HTTPS certificates* in the
Tailscale admin console → DNS if asked).

**Why HTTPS matters even inside Tailscale:** browsers only allow offline mode
(service worker) and app install on HTTPS pages, and Android blocks plain
`http://` by default. Plain `http://100.x.y.z:8787` works for sync from the
native apps (they're allowed), but the browser version loses offline support.

## 3. Connect your devices

On the first device: **Settings → Sync & devices → Create new vault**:

* **Server address:** `https://<pi-name>.<tailnet>.ts.net` (pre-filled when you
  open the web app from the server)
* **Vault name:** e.g. `luka`
* **Passphrase:** long and unique; store it in your password manager — it
  cannot be recovered
* **End-to-end encrypt:** your call. On by default. Off means the server can
  read the data and keeps a plain JSON export for scripts (see below); traffic is
  still encrypted by Tailscale either way.

On every other device: **Join existing vault** with the same name and
passphrase. Data already on a device is merged in.

## 4. Backups

The server writes a gzipped snapshot of each vault **every day something
changed**, and keeps 14 daily, 8 weekly and 24 monthly snapshots:

```
/var/lib/tally/backups/luka/luka-2026-10-07.json.gz
```

* **Off-device copies:** point `TALLY_BACKUP_DIR` at a Syncthing or Nextcloud
  folder and they'll be copied to your other machines automatically. Docker:
  mount the folder (see the compose file). systemd: see the note about the
  sandbox in `/opt/tally/tally-server.env`.
* **Manual snapshot:** *Settings → Sync → Snapshot now* in the app, or
  `docker exec tally node src/index.js backup` /
  `sudo -u tally node /opt/tally/server/src/index.js backup`.
* **Restore:** *Settings → Sync → Server backups → Restore* (the current state is
  snapshotted first, so a restore can itself be undone).
* **Receipts** are copied once into `/var/lib/tally/backups/<vault>/blobs/`
  (they never change, so this is incremental). Copies are kept even after a
  receipt is deleted, and the server falls back to them if a restore needs one.
* Encrypted vaults' snapshots are ciphertext — safe to store anywhere, but only
  readable through the app with your passphrase.

Also keep the occasional app-side backup (*Settings → Backup → Download backup*)
— it's a plain JSON file.

## 5. Plain export for scripts (unencrypted vaults)

For vaults created *without* end-to-end encryption, the server keeps
`/var/lib/tally/exports/<vault>.json` up to date (a few seconds after each
change). It's the same format as the app's JSON export:

```bash
python3 tools/tally_export.py /var/lib/tally/exports/luka.json --by merchant
```

Receipt files of unencrypted vaults are plain files in
`/var/lib/tally/vaults/<vault>/blobs/<attachment id>` (the transaction's
`attachments[].mime` tells you the type).

## Configuration

Environment variables (in `/opt/tally/tally-server.env`, or the compose file):

| Variable | Default | Meaning |
|---|---|---|
| `TALLY_HOST` | `0.0.0.0` (installer: `127.0.0.1`) | Address to listen on |
| `TALLY_PORT` | `8787` | Port |
| `TALLY_DATA_DIR` | `server/data` | Vaults, exports, trash |
| `TALLY_STATIC_DIR` | `../app/dist` | Built web app to serve; empty = API only |
| `TALLY_SIGNUP_SECRET` | — | Require this secret to create a vault (good when friends use your server) |
| `TALLY_ALLOW_SIGNUP` | `true` | `false` = no new vaults at all |
| `TALLY_BACKUPS` | `true` | Daily snapshots on/off |
| `TALLY_BACKUP_DIR` | `<data>/backups` | Where snapshots go |
| `TALLY_BACKUP_KEEP_DAILY` / `_WEEKLY` / `_MONTHLY` | `14` / `8` / `24` | Retention |
| `TALLY_PLAIN_EXPORT` | `true` | Keep `exports/<vault>.json` for unencrypted vaults |
| `TALLY_CORS_ORIGINS` | `*` | Allowed origins for the API (comma-separated). Tokens, not cookies, are used, so `*` is safe |
| `TALLY_MAX_BODY_MB` | `25` | Request size limit for sync |
| `TALLY_MAX_FILE_MB` | `20` | Largest receipt file accepted |

## Sharing with friends

Each person gets their own vault (own passphrase) on the same server. Set
`TALLY_SIGNUP_SECRET` and give them the secret so strangers on your tailnet
(if you ever share nodes) can't create vaults. Invite them to your tailnet or
use Tailscale node sharing for the Pi.

## Command line

```bash
node server/src/index.js serve               # run
node server/src/index.js vaults              # list vaults
node server/src/index.js backup [vault]      # snapshot now
node server/src/index.js export <vault> [f]  # write the plain JSON export (unencrypted vaults)
```

## Updating

Docker: `docker compose pull && docker compose up -d`.

systemd:

```bash
cd tally && git pull
npm --prefix app ci && npm --prefix app run build
sudo ./server/deploy/install.sh               # keeps your env file and data
```

Open apps pick up the new web version on their next start (the browser shows a
"new version — Reload" bar).

## Troubleshooting

* **"Could not reach the sync server"** — is Tailscale up on the device? Does
  `curl https://<pi>.<tailnet>.ts.net/api/v1/health` work?
* **"Unknown vault or wrong passphrase"** — names are lower-case; the passphrase
  is case-sensitive.
* **Linux app can't reach an `http://` server** — desktop WebViews may block
  plain http from the app's secure origin; use the HTTPS address from step 2.
* Logs: `docker logs -f tally` or `journalctl -u tally-server -f`.
