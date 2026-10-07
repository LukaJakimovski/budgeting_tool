# User guide

## Logging a purchase (the 10-second version)

1. Tap **+** (or press **N** on a computer).
2. Type the **amount** — the keyboard opens on it. Press Enter/Next.
3. Start typing the **merchant** and pick it from the list. Tally fills in the
   category, payment method, online/in-person and currency you used there last
   time.
4. Tap **Add purchase** (or press Enter / Ctrl+Enter).

A new merchant needs a category the first time; after that it remembers. The
toast after saving shows how much is left in every budget the purchase counts
towards, plus **Undo**.

**Quick add widget:** put your most-used merchants on Home as one-tap buttons
(Home → Customise → Add widget → Quick add).

### Everything else is optional — under *Details*

* **What did you buy?** — e.g. "Coffee and a muffin". Shown instead of the
  merchant name in lists.
* **Date and time** — default now; change it for something you forgot to log.
* **Payment method** and **In person / Online**.
* **Tags** — free-form labels across categories: who it was for (`#sam`), an
  event or trip (`#montreal-trip`), `#work`… Type and press Enter to create one.
* **Description** and **Purpose** — notes for future you ("why did I spend this?").
* **Split across categories** — one receipt, several categories (groceries +
  a chocolate bar). Splits must add up to the total.

### Receipts

Tap the **camera** next to *Add purchase* to photograph a receipt (or, under
*Details → Receipt*, choose **Photo** or **File / PDF** — e-receipts work too).
Add as many as you like; tap one to view it full size, save/share it, or
remove it. Photos are shrunk (still easily readable) so they sync fast on a
slow connection; until a receipt reaches your server, the cloud icon shows it
as a pending change. Other devices download a receipt the first time you open
it. Transactions with receipts show a 📎 and you can filter by *With receipt*.

*Settings → Backup, import & export → Receipts* shows how much space they use,
can download all of them to the device for offline use, and cleans up files of
deleted transactions. Backups include receipts (as a .zip).

**Type:** *Expense* (default), *Refund* (money back — reduces spending in its
category) or *Income*.

**Other currencies:** tap the currency next to the amount to switch (e.g. EUR).
Optionally enter the CAD amount from your card statement; otherwise your saved
exchange rate is used (Settings → General).

Tap any transaction anywhere to edit, duplicate or delete it.

## Home (dashboard)

Starts minimal: today, this week, your budgets and recent purchases.
**Customise** (bottom of Home) lets you:

* **add** widgets: totals for any period (spent / income / net, optionally
  filtered), budgets, recent, quick add, breakdowns, spending chart, pace vs last
  period, calendar heatmap;
* **move** them (drag the handle or use the arrows), make them **full or half**
  width, open their **settings**, or **remove** them.

The layout syncs to your other devices.

Home also shows **recurring items due** (Add / Skip), a warning if changes
haven't synced for a while, and a backup reminder when you don't use sync.

## History

All transactions, grouped by **day with daily totals**, or as a **table** you
can sort by date, amount, merchant, category or payment method (click the
column header). Use **‹ ›** to step through weeks/months/years, the period
button for presets or a custom range, the search box (name, merchant, notes,
tags, bank text) and **Filter** (categories, tags, merchants, payment methods,
online/in-person, type, amount). The current view lives in the address, so you
can bookmark it.

## Stats

Pick a period and optional filter; everything on the page follows it:

* **Tiles:** spent (vs the previous period), per day, income and net, number of
  transactions.
* **Spending over time:** per day, week or month, with your daily average.
  Click a bar to see those transactions.
* **Breakdown:** by category, subcategory, merchant, tag, payment method,
  online/in-person or weekday. Click a row to drill in. Every chart has a
  **Table** view.
* **This period vs the previous one:** cumulative spending, day by day — are you
  ahead of last month?
* **Calendar:** which days you spend the most.

## Budgets

A budget is a **limit for a period on whatever you choose**:

* period: daily, weekly, monthly, yearly — or every N of them (fortnightly);
* what counts: categories (subcategories included), tags, merchants, payment
  methods — or everything;
* budgets can overlap: a weekly *Food* budget and a weekly *Sweet treats*
  budget both count a donut.

Each budget shows spent / limit, **what's left and per day left**, and a status:
✓ *On track*, ↗ *Ahead of pace* (spending faster than an even pace — the dark
tick on the bar), ⚠️ *Close to limit* (from your warning %, default 80%) or ⛔
*Over budget*. Tap a budget for its history over the last 8 periods.

Weeks start on Monday and months on the 1st by default; change both in
*Settings → General* (e.g. month starts on payday).

## Recurring

*Settings → Recurring* for rent, subscriptions, salary. **Automatic** rules add
the transaction on its date; **Ask first** rules appear on Home for you to Add
or Skip (good when the amount changes). Missed occurrences are caught up when
you next open the app.

## Categories, merchants, tags, payment methods

All in Settings:

* **Categories:** two levels (Food › Sweet treats), icon, chart colour, order,
  archive. Deleting one asks where its transactions should move.
* **Merchants:** edit learned defaults, turn learning off, add **bank names**
  (aliases) for CSV import, merge duplicates ("Tims" → "Tim Hortons").
* **Tags:** rename, archive, merge, delete.
* **Payment methods:** add your cards/accounts, set "usually online / in
  person", reorder.

## Importing bank statements (CIBC and others)

*Settings → Backup, import & export → Import bank CSV*:

1. Download a CSV from CIBC online banking (account → *Download transactions* →
   Spreadsheet/CSV) and pick it. The CIBC format is detected automatically;
   other banks work by choosing columns.
2. Review: Tally skips rows **already imported**, **card payments/transfers**,
   and purchases **you already logged by hand** (same amount within 3 days — the
   bank line is linked to your entry instead). Fix merchant names and categories
   as needed.
3. Import. Merchant names you confirm are remembered, so the next statement
   needs fewer edits.

Tip: log as you go for the details only you know (what and why), and import the
statement weekly or monthly to catch anything you forgot.

## Sync

See [self-hosting.md](self-hosting.md) to set up the server. Then *Settings →
Sync & devices* on each device. The **cloud icon** (top right on phones, bottom
left on computers) always shows the state:

| Icon | Meaning |
|---|---|
| cloud with ✓ | everything synced |
| cloud + dot | changes saved on this device, waiting to upload |
| crossed-out cloud | offline (still saving locally), or sync not set up |
| ⚠ | a problem — tap for details |

## Backups and your data

* With sync, the **server snapshots daily**; restore from *Settings → Sync →
  Server backups*.
* *Settings → Backup, import & export → Download backup* saves a JSON file
  anytime; **Restore** can *merge* or *replace*.
* **Export** as JSON (lossless), CSV (spreadsheets) or SQLite (SQL). The format
  is documented in [data-format.md](data-format.md); `tools/tally_export.py` is
  a starting point for scripts.

## Appearance

*Settings → Appearance*: choose a style (Clean, Paper, Midnight, Forest, Sakura,
Ocean, Ember, Mono), light/dark/auto, **any accent colour** (the whole palette
is generated from it), font, text size, corner roundness and density. Fine-tune
any individual colour, then **save the look as your own style** — or export it
to share. See [theming.md](theming.md).

## Keyboard shortcuts (computer)

| Keys | Action |
|---|---|
| N | New purchase |
| Enter (in amount) | Jump to merchant |
| ↑ ↓ Enter (in merchant) | Pick a suggestion |
| Ctrl+Enter | Save |
| Esc | Close suggestions / sheet |
| ← → (on a chart) | Read values |

## Privacy

Nothing leaves your devices except to your own sync server. Optional PIN lock in
*Settings → Security*. See [security.md](security.md).
