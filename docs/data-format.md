# Data format

Tally stores everything as **documents**: small JSON objects with an `id`, a
`type` and a revision. The same documents are used on the device, in sync and
in the JSON export, so a JSON export is a complete, lossless copy of your data
that any language can read.

Schema version: **1** (`SCHEMA_VERSION` in `app/src/lib/core/types.ts`, the
source of truth for this page).

## Conventions

| Thing | Format | Example |
|---|---|---|
| Money | **Integer minor units** (cents) + ISO 4217 currency code. Never floats. | `"amount": 1250, "currency": "CAD"` = $12.50 |
| Calendar date | `YYYY-MM-DD` (local date) | `"2026-10-07"` |
| Timestamp of a purchase | ISO 8601 **local time with offset** | `"2026-10-07T14:32:00-04:00"` |
| Other timestamps | ISO 8601 UTC | `"createdAt": "2026-10-07T18:32:01.123Z"` |
| IDs | Strings, unique, time-sortable. Prefix tells the type (`tx_`, `mer_`, `cat_` …). Seed data uses fixed ids (`cat_food`, `pm_credit`). | `"tx_01k6x3…"` |
| Revision (`rev`) | Hybrid logical clock: `<ms base36>-<counter base36>-<device>`; compare as plain strings, larger = newer. | `"0mgg5w3sz-0000-k7d2p9xa"` |

The **first 10 characters of `occurredAt` are the local date** the purchase
belongs to. Grouping by day/week/month always uses that, so a purchase at 23:30
stays on its day regardless of time zone.

## Common fields (every document)

```jsonc
{
  "id": "tx_01k6x3…",        // unique
  "type": "transaction",      // see below
  "rev": "0mgg5w3sz-0000-k7d2p9xa",
  "createdAt": "2026-10-07T18:32:01.123Z",
  "deleted": true             // only present on deleted documents (tombstones)
}
```

Deleted documents are kept as tombstones so deletions sync. **Exports leave them
out**; the sync log and server snapshots keep them.

## Document types

### `transaction`

```jsonc
{
  "type": "transaction",
  "kind": "expense",              // "expense" | "refund" | "income"
  "occurredAt": "2026-10-07T14:32:00-04:00",
  "amount": 1850,                 // positive, minor units of `currency`
  "currency": "EUR",
  "baseAmount": 2775,             // the same amount in your base currency
  "baseCurrency": "CAD",
  "merchantId": "mer_…",          // or null
  "name": "Museum tickets",       // what was bought (optional, "" if empty)
  "categoryId": "cat_events",     // or null
  "paymentMethodId": "pm_credit", // or null
  "channel": "in_person",         // "in_person" | "online" | null
  "tagIds": ["tag_…"],
  "description": "Louvre",
  "purpose": "Holiday",
  "splits": [],                   // see below
  "recurringId": null,            // set when created by a recurring rule
  "importRef": null,              // fingerprint of the bank row it came from / was matched to
  "bankDescription": null,        // raw bank statement text
  "attachments": []               // receipts, see below (may be absent on older documents)
}
```

**Signs:** amounts are always positive; `kind` says the direction. *Spending* =
expenses − refunds. Income is reported separately.

**Splits:** when `splits` is non-empty, the purchase is divided across
categories. Split amounts are in the transaction's currency and add up to
`amount`. Each split has its own `categoryId`, extra `tagIds` (the
transaction's own tags apply to every split) and a `note`:

```json
"splits": [
  { "amount": 5620, "categoryId": "cat_groceries", "tagIds": [], "note": "" },
  { "amount": 800,  "categoryId": "cat_treats",    "tagIds": [], "note": "chocolate" }
]
```

The base-currency value of each split is `baseAmount` divided in proportion
(remainders go to the largest parts, so the parts always add up exactly).

**Attachments (receipts):** photos or PDFs. The document holds only metadata;
the bytes are stored separately under the attachment `id` (a "blob" — on each
device in IndexedDB, on the server in `vaults/<vault>/blobs/<id>`). Photos are
re-encoded as JPEG (longest side ≤ 2400 px) before storing.

```json
"attachments": [
  { "id": "att_01k6x4…", "name": "receipt.jpg", "mime": "image/jpeg", "size": 412345,
    "width": 1800, "height": 2400, "addedAt": "2026-10-07T18:40:02.000Z" }
]
```

### `merchant`

```jsonc
{
  "type": "merchant",
  "name": "Tim Hortons",
  "aliases": ["tim hortons #"],        // lower-case text looked for in bank CSV lines (after channel, type and reference number)
  "defaults": {                        // filled into new purchases at this merchant
    "categoryId": "cat_coffee",
    "paymentMethodId": "pm_debit",
    "channel": "in_person",
    "tagIds": [],
    "name": "",
    "currency": "CAD"
  },
  "learnDefaults": true,               // update defaults from the latest purchase
  "archived": false
}
```

### `category`

```jsonc
{
  "type": "category",
  "name": "Sweet treats",
  "parentId": "cat_food",   // null for top level; one level of nesting in the UI
  "icon": "🍩",
  "color": "slot:3",        // chart colour: "slot:0".."slot:7" (palette) or "#rrggbb"; "" for subcategories
  "kind": "expense",        // "expense" | "income"
  "order": 4,
  "archived": false
}
```

### `tag`, `paymentMethod`

```jsonc
{ "type": "tag", "name": "work", "color": "", "archived": false }
{ "type": "paymentMethod", "name": "CIBC Visa", "defaultChannel": null, "order": 0, "archived": false }
```

### `budget`

```jsonc
{
  "type": "budget",
  "name": "Sweet treats",
  "icon": "🍩",
  "amount": 2000,                                        // limit, base-currency minor units
  "period": { "unit": "week", "count": 1, "anchor": "2024-01-01" },
  "filter": { "categoryIds": ["cat_treats"] },           // what counts (see Filter)
  "warnAt": 0.8,                                         // show a warning from 80%
  "order": 1,
  "archived": false
}
```

`period.unit` is `day | week | month | year`; `count` > 1 makes e.g.
fortnightly budgets, aligned to `anchor`. Weeks start on the `weekStart`
setting, months on `monthStartDay`.

### `recurring`

```jsonc
{
  "type": "recurring",
  "name": "Rent",
  "freq": "month", "interval": 1,
  "startDate": "2026-01-01", "endDate": null,
  "mode": "auto",            // "auto" creates on the day; "confirm" asks first
  "active": true,
  "template": { "kind": "expense", "amount": 145000, "currency": "CAD", "merchantId": null,
                "name": "Rent", "categoryId": "cat_rent", "paymentMethodId": "pm_debit",
                "channel": "online", "tagIds": [], "description": "", "purpose": "", "time": "09:00" }
}
```

Occurrences get deterministic ids `rec_<ruleId>_<date>`, so the same occurrence
created on two devices is one document. A skipped occurrence is a deleted
transaction with that id.

### `setting`

Synced preferences, one document per key, id `setting:<key>`:

```json
{ "type": "setting", "id": "setting:baseCurrency", "key": "baseCurrency", "value": "CAD" }
```

Keys: `baseCurrency`, `currencies`, `rates` (units of base per 1 unit of each
currency), `weekStart` (0 = Sunday), `monthStartDay`, `dateFormat`
(`dmy|ymd|mdy`), `appearance`, `dashboard`, `backupReminderDays`, `modules`,
`onboarded`, and `module:<id>` for modules' own state.

### Filter

Used by budgets, saved views and widgets. All parts are optional; parts are
combined with AND, values inside a part with OR. Categories include their
subcategories. `excludeTagIds` is the one negative part: a line carrying any of
those tags never matches, whatever else it matches ("Food, but not #work").
Like `tagIds`, it is checked per line, so on a split purchase only the splits
carrying the tag are left out (a tag on the whole purchase applies to every split).

```jsonc
{
  "categoryIds": ["cat_food"], "tagIds": [], "excludeTagIds": ["tag_…"],
  "merchantIds": [], "paymentMethodIds": [],
  "channels": ["online"], "kinds": ["expense"], "text": "coffee",
  "minAmount": 500, "maxAmount": null,      // base-currency minor units
  "hasAttachment": true                     // only with (true) / without (false) a receipt
}
```

## Export files

### JSON (lossless) — `tally-YYYY-MM-DD_HHMM.json`

```json
{
  "format": "tally-export",
  "version": 1,
  "exportedAt": "2026-10-07T18:40:00.000Z",
  "app": "tally 0.1.0",
  "documents": [ { "id": "cat_food", "type": "category", "…": "…" }, "…" ]
}
```

This is also the backup format. Restoring it (Settings → Backup) either merges
(newer revision of each document wins) or replaces everything.

### Backup with receipts — `tally-backup-….zip`

When any transaction has receipts, *Download backup* produces a zip:

```
tally-backup.json            the JSON export above
receipts/att_01k6x4….jpg     one file per attachment, named <attachment id>.<ext>
```

Restoring the zip brings the receipts back too.

### CSV — `tally-transactions-….csv`

One row per **transaction line** (a split purchase gives one row per split), so
summing `amount_base` grouped by `category` is always right.

`transaction_id, line, date, time, kind, name, merchant, amount, currency,
amount_base, base_currency, category, category_path, tags, payment_method,
channel, description, purpose, split_note, bank_description, receipts`

(`receipts` = `;`-separated attachment ids, matching the file names in a zip backup.)

Amounts are decimal strings (`12.50`); `tags` are `;`-separated; dates are ISO.

### SQLite — `tally-….sqlite`

Tables `transactions`, `splits`, `transaction_tags`, `attachments`, `categories`,
`merchants`, `tags`, `payment_methods`, `budgets`, plus:

* `transaction_lines` — the CSV above as a table (easiest place to start);
* `documents` — every document as raw JSON (`json` column), for anything else.

Money columns end in `_minor` (integers).

```sql
-- Spending per category per month
SELECT substr(date, 1, 7) AS month, category_path, SUM(CAST(amount_base AS REAL)) AS spent
FROM transaction_lines WHERE kind = 'expense'
GROUP BY month, category_path ORDER BY month, spent DESC;
```

## Reading the data from code

`tools/tally_export.py` (standard library only) loads a JSON export — or the
server's plain export — and prints monthly totals; use it as a starting point:

```bash
python3 tools/tally_export.py tally-2026-10-07_1840.json
python3 tools/tally_export.py /var/lib/tally/exports/luka.json --by merchant
```

Minimal Python:

```python
import json
docs = json.load(open("tally-export.json"))["documents"]
cats = {d["id"]: d["name"] for d in docs if d["type"] == "category"}
for t in (d for d in docs if d["type"] == "transaction" and d["kind"] == "expense"):
    print(t["occurredAt"][:10], cats.get(t["categoryId"]), t["baseAmount"] / 100)
```

## Where the data lives

| Place | What | Format |
|---|---|---|
| Each device | IndexedDB database `tally` (stores `docs`, `outbox`, `meta`) | documents |
| Sync server | `<data>/vaults/<vault>/log.jsonl` | one change per line (`{"seq","id","rev","data","at"}`); `data` is the document, or ciphertext for encrypted vaults |
| Each device | IndexedDB stores `blobs` / `blobOutbox` | receipt bytes, and uploads not yet sent |
| Sync server | `<data>/vaults/<vault>/blobs/<id>` | receipt files — the original bytes for unencrypted vaults, ciphertext otherwise |
| Sync server | `<data>/exports/<vault>.json` | same as the JSON export (unencrypted vaults only), refreshed a few seconds after each change |
| Sync server | `<backups>/<vault>/<vault>-YYYY-MM-DD.json.gz` | gzipped snapshot of the vault log |

## Versioning

Additive changes (new optional fields, new document types, new setting keys)
keep version 1 — readers should ignore fields they don't know. A breaking
change bumps `SCHEMA_VERSION`; the app refuses to restore backups from a newer
version than itself.
