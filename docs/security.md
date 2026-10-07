# Security and privacy

## Where data goes

* **On each device:** in the app's private storage (IndexedDB). Nothing is
  sent anywhere unless you connect a sync server.
* **Sync server:** only the server *you* run. Traffic between your devices and
  the server travels over Tailscale (WireGuard) and, with `tailscale serve`,
  HTTPS as well.
* No analytics, no third-party requests, no web fonts or CDNs. The app works
  fully offline.

## Vault passphrase and encryption

* The passphrase never leaves the device. It derives (PBKDF2-SHA256, 210 000
  iterations) an **access token** for the server and, for encrypted vaults, an
  **AES-256-GCM key**.
* The server stores only a SHA-256 hash of the token; an attacker with a copy
  of the server's disk must still brute-force the passphrase. Use a long,
  unique passphrase (a few random words).
* With **end-to-end encryption on** (the default), the server stores only
  ciphertext; backups made by the server are encrypted too. The trade-off: the
  server can't produce a readable export for scripts — export from the app.
* With it **off**, the server can read your data (and keeps
  `exports/<vault>.json`). Reasonable when the server is your own Pi on your own
  tailnet.
* A wrong passphrase and an unknown vault get the same answer; repeated failures
  from one address are rate-limited.

Details: [sync-protocol.md](sync-protocol.md).

## App PIN

*Settings → Security* sets a 4–12 digit PIN that locks the app after it has been
in the background for a chosen time. It's a **privacy screen** (stops someone
with your unlocked phone from browsing your spending), not encryption: a short
PIN can't meaningfully encrypt data. The data itself is protected by your
phone's / computer's storage encryption and lock screen. The PIN is stored per
device as a salted PBKDF2 hash.

Forgot it? Clear the app's data (Android: *App info → Storage → Clear*; browser:
site data) and reconnect to your vault or restore a backup.

## Server hardening (included)

* systemd unit runs as an unprivileged `tally` user with `ProtectSystem=strict`,
  `ProtectHome`, `NoNewPrivileges`, writing only to `/var/lib/tally`.
* Binds to `127.0.0.1` by default in the installer and compose file; exposure
  is through `tailscale serve`.
* Strict Content-Security-Policy on the web app; no inline scripts.
* `TALLY_SIGNUP_SECRET` / `TALLY_ALLOW_SIGNUP=false` control who can create
  vaults.

## Backups

Keep at least one copy off the Pi: point `TALLY_BACKUP_DIR` at a Syncthing or
Nextcloud folder, and/or download an app backup now and then. Encrypted vault
snapshots are safe to store on other machines.
