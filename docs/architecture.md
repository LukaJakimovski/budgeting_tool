# How Tally works

## The big picture

```
┌───────────────────────────── one web app (app/) ─────────────────────────────┐
│  Svelte 5 UI  ──►  actions.ts  ──►  repo (in-memory + IndexedDB)  ──►  sync   │
│     ▲                                   │  outbox of unsynced changes    │    │
│     └──────── reactive reads ◄──────────┘                                │    │
└───────┬───────────────────┬───────────────────────┬──────────────────────┼────┘
        │ browser / PWA     │ Tauri (Linux)         │ Capacitor (Android)  │ HTTPS
        ▼                   ▼                       ▼                      ▼
                                                              server/ (Node, no deps)
                                                              vault logs · backups · exports
                                                              + serves the web app
```

* **One codebase.** The same build runs in the browser, inside a Tauri window
  on Linux and inside Capacitor on Android. Platform differences (saving files,
  the Android back button) live in `app/src/lib/platform/`.
* **Local-first.** The device is the source of truth for the UI. Reads are
  synchronous from memory; writes go to memory, then IndexedDB, then (in the
  background) the server. Slow or no internet only delays sync.
* **Documents everywhere.** Data is a set of JSON documents
  ([data-format.md](data-format.md)) with hybrid-logical-clock revisions;
  the same documents are stored, synced, exported and backed up.

## Repository layout

```
app/                      the web app (Svelte 5 + TypeScript + Vite)
  src/lib/core/           pure logic, no UI: types, money, dates, ledger, budgets, recurring, hlc, ids,
                          banktext (bank statement text → merchant names)
  src/lib/db/             IndexedDB (idb.ts) and the reactive repository (repo.svelte.ts)
  src/lib/sync/           sync engine and crypto
  src/lib/theme/          palette generator, styles (one file each), fonts, chart palette
  src/lib/charts/         dependency-free SVG charts
  src/lib/ui/             shared components (sheet, pickers, filters, rows…)
  src/lib/modules/        event bus, module registry, dashboard types
  src/lib/actions.ts      domain operations used by screens (save purchase, recurring…)
  src/lib/analysis.ts     view-models for stats and widgets
  src/lib/importers.ts    bank CSV import (CIBC preset)
  src/lib/bulk.ts         bulk edits (History selection), merging merchants, tidy-up suggestions — all undoable
  src/lib/exporters.ts    JSON / CSV / SQLite export
  src/lib/backup.ts       backup reminders, zip backups, restore
  src/lib/attachments.ts  receipts: image shrinking, local storage, lazy download, clean-up
  src/routes/             screens (Home, History, Stats, Budgets, Settings…, TxEditor)
  src/widgets/            dashboard widgets + registry
  android/                Capacitor Android project
  tests/                  unit tests (vitest) and e2e tests (Playwright)
desktop/src-tauri/        Tauri 2 project for Linux
server/                   sync server (src/), deployment files (deploy/), Dockerfile
packaging/                Arch PKGBUILDs, .desktop file
tools/                    scripts for working with exported data
docs/                     you are here
```

## Data flow of a purchase

1. **TxEditor** (`routes/TxEditor.svelte`) — amount, merchant, category.
   Choosing a known merchant fills its learned defaults (category, payment
   method, online/in-person, item name, currency) into fields you haven't touched.
2. **`saveTransaction`** (`lib/actions.ts`) — creates the merchant if new,
   converts to the base currency, stores the transaction, updates the merchant's
   learned defaults, evaluates the budgets it counts towards and emits events.
3. **`repo.save`** — stamps a new revision, updates memory (the UI re-renders
   immediately), writes the document + an outbox entry in one IndexedDB
   transaction, then notifies sync.
4. The toast shows what's left in each affected budget, with *Undo*.
5. **Sync** pushes the outbox within ~1.5 s if online ([sync-protocol.md](sync-protocol.md)).

## Calculations

* **Allocations** (`core/ledger.ts`): each transaction becomes one or more
  *allocation lines* (one per split), each with a base-currency amount, a
  category and tags. Every total, chart and budget is computed from these, so
  split purchases count towards the right categories everywhere.
* **Spending** = expenses − refunds. Income is separate.
* **Filters** (`compileFilter`) combine categories (including subcategories),
  tags, merchants, payment methods, channel, kind, amount range and text search.
  The same filter type powers budgets, the History view, Stats and widgets.
* **Periods** (`core/dates.ts`) work on local calendar dates; weeks start on your
  chosen day, months on your chosen day (payday budgeting), and any period can
  repeat every N units.
* **Budgets** (`core/budgets.ts`) report spent, remaining, % used, the even-pace
  amount for today, per-day allowance left and a status (ok / warning / over).
  Budgets may overlap freely.
* **Multi-currency:** each transaction stores its original amount and its value
  in your base currency (exact from your statement if you enter it, otherwise
  converted with your saved rate at the time).

## Reactivity and performance

* The repo keeps every document in a `Map`; a single `$state` version number
  changes on every write. Derived lists (sorted transactions, lookups,
  allocations) are memoised per version, so screens re-compute only what they
  read, once per change.
* A few thousand purchases a year means everything fits comfortably in memory;
  start-up loads all documents in one IndexedDB read.
* The main bundle is ~51 KB gzipped; Stats, Budgets, Settings and Import load on
  first use. Charts are hand-written SVG (no chart library). SQLite export loads
  its WebAssembly only when used.
* The service worker caches the app shell, so the web app starts instantly and
  offline after the first visit; updates show a *Reload* bar instead of
  surprising you.

## Theming

See [theming.md](theming.md): one accent colour is turned into contrast-checked
light and dark palettes in OKLCH; styles are single files; everything visual is
a CSS variable.

## Extensibility

See [extending.md](extending.md): typed domain events, a widget registry with
declarative settings, a style registry and on/off modules with synced state — the
groundwork for things like gamification.

## Testing

* `app/tests/*.test.ts` — unit tests for money parsing, dates and periods,
  clocks, the ledger, budgets, recurring rules, the repository (IndexedDB),
  two devices syncing through a real server (plain and encrypted), crypto,
  theme contrast for every style, CSV import (CIBC) and exports.
* `server/test/` — vault creation/auth, LWW, pagination, restart and compaction,
  signup modes, backups and retention, rate limiting.
* `app/tests/e2e/` — Playwright: the purchase flow on a phone viewport, splits
  and undo, budget feedback, bank import, restore + exports, theming,
  dashboard customisation, keyboard-only entry, and two browsers syncing.
