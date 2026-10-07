# Sync protocol

How devices stay in step. Code: `app/src/lib/sync/` (client) and `server/src/`
(server). Version `v1`, all under `/api/v1`.

## Model

* Every change produces a new **revision** of a whole document (see
  [data-format.md](data-format.md)). The revision is a hybrid logical clock, so
  revisions from different devices sort sensibly even if a phone's clock is off.
* **Last writer wins per document**: when two devices edited the same document
  while offline, the edit with the larger revision is kept everywhere. (Edits
  to *different* documents never conflict; adding purchases on two offline
  devices always merges cleanly.)
* Deletions are tombstones (`"deleted": true`) and sync like any edit.
* The server is a dumb, ordered log. It never interprets documents — for an
  end-to-end-encrypted vault it can't.

```
 device A                         server (vault "luka")                 device B
 ────────                         ─────────────────────                 ────────
 save → IndexedDB + outbox
 POST /sync {since: 40,      →    append newer revs as seq 41,42
            push: [x, y]}    ←    {entries: [docs after 40 not from A], seq: 42}
 ack outbox, cursor = 42
                                                                 POST /sync {since: 38, push: []}
                                                           →     {entries: [seq 39..42], seq: 42}
                                                                 merge (newer rev wins), cursor = 42
```

## Client side

* **Local first.** Saving writes the document *and* an outbox entry
  `{id, rev}` in one IndexedDB transaction, then updates the UI. Nothing waits
  for the network.
* A sync round: read up to 400 outbox entries → POST them with the stored
  cursor → merge returned entries → remove outbox entries whose revision didn't
  change meanwhile → store the new cursor. Repeat until the outbox is empty and
  the server reports nothing more.
* Triggers: 1.5 s after a local change, on app start, when the app becomes
  visible, when the network comes back, and every 60 s while visible.
* Failures back off 5 s → 10 s → … → 5 min. Wrong passphrase (401/403) waits
  for the user.
* Uploads over 8 KB are gzip-compressed (`Content-Encoding: gzip`); responses
  over 1 KB come back gzipped.
* **Status shown to the user** (cloud icon / sidebar pill): *Local only*,
  *Synced*, *N changes waiting*, *Syncing*, *Offline — N changes saved on this
  device*, *Sync problem*. If changes have been waiting for more than 10
  minutes, Home shows a banner.

## Vault keys

From the **vault passphrase** the client derives 64 bytes with
PBKDF2-HMAC-SHA256, salt `tally-vault-v1:<vault name>`, 210 000 iterations:

| bytes | use |
|---|---|
| 0–31 | AES-256-GCM key for end-to-end encryption — never sent anywhere |
| 32–63 | **access token** (hex) — sent as `Authorization: Bearer <token>` |

The server stores only `sha256(token)`. WebCrypto is used when available,
otherwise an audited pure-JS implementation (`@noble/hashes`, `@noble/ciphers`),
so it also works on plain-http pages and older WebViews. Both produce identical
keys (tested).

**Encrypted vaults** send each document as
`"v1:" + base64(nonce[12] ‖ AES-GCM ciphertext+tag)`, with the document id as
associated data (a ciphertext can't be moved to another id). The server sees
only ids, revisions, sizes and timing.

## HTTP API

All bodies are JSON. Errors are `{ "error": "message" }` with a 4xx/5xx status.

### `GET /api/v1/health`

```json
{ "ok": true, "name": "tally", "version": "0.1.0", "signup": "open", "backups": true }
```

`signup` is `open`, `secret` (needs `signupSecret`) or `closed`.

### `POST /api/v1/vaults` — create a vault

```json
{ "vault": "luka", "token": "<64 hex>", "encrypted": true, "signupSecret": "…optional" }
```

`201` with vault info; `409` if it exists; `403` if signup is closed or the
secret is wrong. Vault names: `^[a-z0-9][a-z0-9_-]{0,63}$`.

### `GET /api/v1/vaults/:vault` (auth)

```json
{ "vault": "luka", "encrypted": true, "createdAt": "…", "seq": 1234, "docs": 812 }
```

`401` for an unknown vault *or* a wrong token (indistinguishable on purpose).
More than 20 failures from one IP in 10 minutes → `429`.

### `POST /api/v1/vaults/:vault/sync` (auth)

Request:

```json
{
  "since": 40,
  "limit": 1000,
  "push": [ { "id": "tx_…", "rev": "0mgg5w3sz-0000-k7d2p9xa", "data": { "…document or ciphertext string" } } ]
}
```

Server behaviour:

1. For each pushed entry, keep it only if there is no entry for that id or its
   `rev` is greater; accepted entries get the next `seq` and are appended (and
   fsynced) to the log.
2. Return the latest entry of every id with `seq > since`, oldest first,
   excluding the ones just accepted from this request, at most `limit`.

Response:

```json
{ "accepted": 1, "entries": [ { "seq": 41, "id": "…", "rev": "…", "data": { } } ], "more": false, "seq": 42 }
```

Store `seq` as the new cursor. If `more` is true, call again with
`since = seq`.

### Receipt files — blobs (auth)

Attachment bytes don't go through the document log (they're big and never
change). After each document round the client uploads queued files and
performs queued deletions; other devices download a file the first time it's
opened (or all at once via *Settings → Backup → Keep all receipts on this
device*).

* `PUT /api/v1/vaults/:vault/blobs/:id` — body = raw bytes
  (`application/octet-stream`), up to `TALLY_MAX_FILE_MB` (20 MB). Idempotent.
* `GET /api/v1/vaults/:vault/blobs/:id` — the bytes; `404` if unknown. If the
  live copy was deleted but a backup copy exists, the backup copy is served.
* `DELETE /api/v1/vaults/:vault/blobs/:id`
* `GET /api/v1/vaults/:vault/blobs` → `{ "blobs": [{ "id", "size" }] }`

Ids are random (`att_…`, `[A-Za-z0-9_-]{1,100}`), so files are immutable and
never content-addressed (which would leak "this exact photo exists" for
encrypted vaults). In encrypted vaults the body is
`nonce[12] ‖ AES-256-GCM(bytes)` with `blob:<id>` as associated data.

Uploads use a 3-minute timeout and retry with the usual back-off, so a
receipt taken on a weak connection simply uploads later; the cloud icon counts
it as a pending change until then.

### Backups (auth)

* `GET /api/v1/vaults/:vault/backups` → `{ "backups": [{ "name", "date", "size", "createdAt" }] }`
* `POST /api/v1/vaults/:vault/backups` → take a snapshot now → `{ "name" }`
* `GET /api/v1/vaults/:vault/backups/:name` → the snapshot
  (`{ "format": "tally-vault-snapshot", "encrypted", "entries": [...] }`)
* `DELETE /api/v1/vaults/:vault` → takes a final snapshot, moves the vault to
  `<data>/trash/`.

The app's *Settings → Sync → Server backups → Restore* downloads a snapshot,
decrypts it locally and applies it as a "replace" restore (after taking a fresh
snapshot of the current state first).

## Server storage

* `vaults/<vault>/vault.json` — `{ name, authHash, encrypted, createdAt, schema }`
* `vaults/<vault>/log.jsonl` — append-only, one entry per line. On start-up the
  server replays it (ignoring a torn last line after a crash) and keeps the
  latest entry per id in memory. When the log is more than twice the live size
  it's compacted to one line per id (written to a temp file, then renamed).
* Static app files are served from `TALLY_STATIC_DIR` with gzip and long-lived
  caching for hashed assets.

## Guarantees and limits

* A saved change is durable on the device before the UI confirms it, and
  durable on the server (fsync) before the server acknowledges it.
* Re-sending the same push is harmless (idempotent by revision).
* Per-document last-writer-wins means two *simultaneous* edits of the same
  purchase keep one of them whole rather than mixing fields. For a single user
  this is rare and predictable.
* Entry limit 512 KB; request limit 25 MB (`TALLY_MAX_BODY_MB`).
