#!/usr/bin/env python3
"""Summarise a Tally JSON export (or the server's plain export) — stdlib only.

    python3 tools/tally_export.py tally-export.json                 # spending per month × category
    python3 tools/tally_export.py tally-export.json --by merchant   # … × merchant (also: tag, payment)
    python3 tools/tally_export.py tally-export.json --csv out.csv   # flat CSV of transaction lines

A starting point for your own analysis; the format is in docs/data-format.md.
"""
import argparse
import csv
import json
from collections import defaultdict


def load(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if data.get("format") == "tally-vault-snapshot":
        if data.get("encrypted"):
            raise SystemExit("This snapshot is end-to-end encrypted; export JSON from the app instead.")
        docs = [e["data"] for e in data["entries"]]
    else:
        docs = data["documents"]
    return [d for d in docs if isinstance(d, dict) and not d.get("deleted")]


def lines(docs):
    """Yield one dict per transaction line (splits expanded), amounts in base currency."""
    by_id = {d["id"]: d for d in docs}
    name = lambda i: by_id.get(i, {}).get("name", "") if i else ""
    for t in docs:
        if t["type"] != "transaction":
            continue
        parts = t["splits"] or [{"amount": t["amount"], "categoryId": t["categoryId"], "tagIds": [], "note": ""}]
        total = sum(p["amount"] for p in parts) or 1
        for p in parts:
            cat = by_id.get(p["categoryId"]) if p["categoryId"] else None
            parent = by_id.get(cat["parentId"]) if cat and cat.get("parentId") else None
            yield {
                "date": t["occurredAt"][:10],
                "kind": t["kind"],
                "amount": t["baseAmount"] * p["amount"] / total / 100,
                "currency": t["baseCurrency"],
                "category": cat["name"] if cat else "Uncategorised",
                "group": (parent or cat or {}).get("name", "Uncategorised"),
                "merchant": name(t.get("merchantId")) or t.get("name") or "",
                "payment": name(t.get("paymentMethodId")),
                "tags": [name(x) for x in t["tagIds"] + p.get("tagIds", [])],
                "name": t.get("name", ""),
            }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file")
    ap.add_argument("--by", choices=["category", "group", "merchant", "tag", "payment"], default="group")
    ap.add_argument("--csv", help="write transaction lines to this CSV file")
    args = ap.parse_args()

    rows = list(lines(load(args.file)))
    if args.csv:
        with open(args.csv, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()) if rows else ["date"])
            w.writeheader()
            for r in rows:
                w.writerow({**r, "tags": ";".join(r["tags"])})
        print(f"wrote {len(rows)} lines to {args.csv}")
        return

    table = defaultdict(lambda: defaultdict(float))
    for r in rows:
        if r["kind"] == "income":
            continue
        sign = -1 if r["kind"] == "refund" else 1
        keys = (r["tags"] or ["(untagged)"]) if args.by == "tag" else [r[args.by] or "(none)"]
        for k in keys:
            table[r["date"][:7]][k] += sign * r["amount"]

    for month in sorted(table):
        items = sorted(table[month].items(), key=lambda kv: -kv[1])
        print(f"\n{month}   total {sum(v for _, v in items):10.2f}")
        for k, v in items:
            print(f"  {k:<28} {v:10.2f}")


if __name__ == "__main__":
    main()
