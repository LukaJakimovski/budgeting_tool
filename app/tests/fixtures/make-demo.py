"""Generate a realistic demo backup (tally-export JSON) for screenshots and E2E tests.

    python3 tests/fixtures/make-demo.py > tests/fixtures/demo-backup.json
"""
import json, random, datetime as dt

random.seed(7)
TODAY = dt.date.today()
REV = "000000001-0000-demo"
docs = []

def doc(type_, id_, **f):
    d = {"id": id_, "type": type_, "rev": REV, "createdAt": "2026-01-01T00:00:00.000Z", **f}
    docs.append(d)
    return d

merchants = [
    ("mer_tims", "Tim Hortons", "cat_coffee", "pm_debit", "in_person", (2.5, 7)),
    ("mer_loblaws", "Loblaws", "cat_groceries", "pm_credit", "in_person", (25, 140)),
    ("mer_nofrills", "No Frills", "cat_groceries", "pm_debit", "in_person", (15, 80)),
    ("mer_starbucks", "Starbucks", "cat_coffee", "pm_credit", "in_person", (4, 9)),
    ("mer_bakery", "Fresh Bakery", "cat_treats", "pm_cash", "in_person", (3, 12)),
    ("mer_ttc", "TTC", "cat_transit", "pm_credit", "in_person", (3.35, 3.35)),
    ("mer_uber", "Uber", "cat_rides", "pm_credit", "online", (12, 38)),
    ("mer_amazon", "Amazon", "cat_household", "pm_credit", "online", (10, 90)),
    ("mer_sushi", "Sushi Place", "cat_eating_out", "pm_credit", "in_person", (18, 55)),
    ("mer_steam", "Steam", "cat_fun", "pm_credit", "online", (5, 60)),
    ("mer_shoppers", "Shoppers Drug Mart", "cat_health", "pm_debit", "in_person", (8, 45)),
]
for mid, name, cat, pm, ch, _ in merchants:
    doc("merchant", mid, name=name, aliases=[name.lower()], defaults={"categoryId": cat, "paymentMethodId": pm, "channel": ch, "tagIds": [], "name": "", "currency": "CAD"}, learnDefaults=True, archived=False)

for tid, name in [("tag_work", "work"), ("tag_sam", "sam"), ("tag_trip", "montreal-trip")]:
    doc("tag", tid, name=name, color="", archived=False)

weights = [8, 2, 1.5, 3, 2, 6, 1, 0.8, 1.2, 0.4, 0.6]
n = 0
for back in range(120, -1, -1):
    day = TODAY - dt.timedelta(days=back)
    for _ in range(random.choice([0, 1, 1, 2, 2, 3])):
        m = random.choices(merchants, weights)[0]
        lo, hi = m[5]
        amt = int(round(random.uniform(lo, hi) * 100))
        hh, mm = random.randint(7, 21), random.randint(0, 59)
        tags = []
        if m[0] == "mer_tims" and random.random() < 0.3: tags.append("tag_work")
        if m[0] == "mer_sushi" and random.random() < 0.4: tags.append("tag_sam")
        n += 1
        doc("transaction", f"tx_demo{n:04d}", kind="expense", occurredAt=f"{day.isoformat()}T{hh:02d}:{mm:02d}:00-04:00",
            amount=amt, currency="CAD", baseAmount=amt, baseCurrency="CAD", merchantId=m[0], name="",
            categoryId=m[2], paymentMethodId=m[3], channel=m[4], tagIds=tags, description="", purpose="", splits=[])
    if day.day == 1:
        n += 1
        doc("transaction", f"tx_demo{n:04d}", kind="expense", occurredAt=f"{day.isoformat()}T09:00:00-04:00", amount=145000, currency="CAD",
            baseAmount=145000, baseCurrency="CAD", merchantId=None, name="Rent", categoryId="cat_rent", paymentMethodId="pm_debit",
            channel="online", tagIds=[], description="", purpose="", splits=[], recurringId=None)
    if day.day in (15, 28) or (day.day == 1):
        n += 1
        doc("transaction", f"tx_demo{n:04d}", kind="income", occurredAt=f"{day.isoformat()}T08:00:00-04:00", amount=210000, currency="CAD",
            baseAmount=210000, baseCurrency="CAD", merchantId=None, name="Paycheque", categoryId="cat_salary", paymentMethodId=None,
            channel=None, tagIds=[], description="", purpose="", splits=[])

# One split grocery run and one EUR purchase
n += 1
doc("transaction", f"tx_demo{n:04d}", kind="expense", occurredAt=f"{TODAY.isoformat()}T12:10:00-04:00", amount=6420, currency="CAD", baseAmount=6420,
    baseCurrency="CAD", merchantId="mer_loblaws", name="Weekly shop", categoryId="cat_groceries", paymentMethodId="pm_credit", channel="in_person",
    tagIds=[], description="", purpose="", splits=[{"amount": 5620, "categoryId": "cat_groceries", "tagIds": [], "note": ""}, {"amount": 800, "categoryId": "cat_treats", "tagIds": [], "note": "chocolate"}])
n += 1
doc("transaction", f"tx_demo{n:04d}", kind="expense", occurredAt=f"{(TODAY - dt.timedelta(days=20)).isoformat()}T15:00:00+02:00", amount=1850, currency="EUR", baseAmount=2775,
    baseCurrency="CAD", merchantId=None, name="Museum tickets", categoryId="cat_events", paymentMethodId="pm_credit", channel="in_person",
    tagIds=["tag_trip"], description="Louvre", purpose="Holiday", splits=[])

doc("budget", "bud_food", name="Food", icon="🍽️", amount=15000, period={"unit": "week", "count": 1, "anchor": "2024-01-01"}, filter={"categoryIds": ["cat_food"]}, warnAt=0.8, order=0, archived=False)
doc("budget", "bud_treats", name="Sweet treats", icon="🍩", amount=2000, period={"unit": "week", "count": 1, "anchor": "2024-01-01"}, filter={"categoryIds": ["cat_treats"]}, warnAt=0.8, order=1, archived=False)
doc("budget", "bud_coffee", name="Coffee", icon="☕", amount=500, period={"unit": "day", "count": 1, "anchor": "2024-01-01"}, filter={"categoryIds": ["cat_coffee"]}, warnAt=0.8, order=2, archived=False)
doc("budget", "bud_fun", name="Fun money", icon="🎮", amount=20000, period={"unit": "month", "count": 1, "anchor": "2024-01-01"}, filter={"categoryIds": ["cat_fun", "cat_eating_out"]}, warnAt=0.8, order=3, archived=False)
doc("setting", "setting:onboarded", key="onboarded", value=True)
doc("recurring", "rule_spotify", name="Spotify", freq="month", interval=1, startDate=(TODAY - dt.timedelta(days=40)).isoformat(), endDate=None, mode="confirm", active=True,
    template={"kind": "expense", "amount": 1199, "currency": "CAD", "merchantId": None, "name": "Spotify", "categoryId": "cat_subscriptions", "paymentMethodId": "pm_credit", "channel": "online", "tagIds": [], "description": "", "purpose": "", "time": "09:00"})

print(json.dumps({"format": "tally-export", "version": 1, "exportedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "app": "demo", "documents": docs}, indent=1))
