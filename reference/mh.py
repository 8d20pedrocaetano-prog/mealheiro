#!/usr/bin/env python3
"""Mealheiro data toolkit: the reference implementation of the data rules in DATA_MODEL.md.

Run from the root of the data repo:
  python3 tools/mh.py ingest STATEMENT.pdf [--account cgd-main]   parse, dedupe, write month files, log import
  python3 tools/mh.py unmatched [--limit 60]                      rows no rule/override/suggestion covers
  python3 tools/mh.py suggest TXN_ID CATEGORY_ID [--note TEXT]    set category_suggested on one row
  python3 tools/mh.py add-rule PATTERN CATEGORY_ID [--merchant M] [--direction in|out] [--min X] [--max Y]
  python3 tools/mh.py pairs                                       likely paybacks / pass-through pairs
  python3 tools/mh.py detect-trips [--write]                      foreign-trip candidates (writes proposed events)
  python3 tools/mh.py summary [--months 6]                        monthly income / spend / saved by group
  python3 tools/mh.py validate                                    schema, ids, categories, balance chain
Only depends on the standard library (+ pdfplumber for ingest).
"""
import argparse, csv, datetime as dt, glob, hashlib, json, os, re, sys
from collections import defaultdict
from decimal import Decimal

ROOT = os.getcwd()
TXN_FIELDS = ["id", "account_id", "booking_date", "value_date", "description_raw", "amount", "currency",
              "balance_after", "import_id", "category_suggested", "suggested_by", "review_note"]
OVR_FIELDS = ["txn_id", "category_id", "event_id", "note", "excluded", "reimburses_txn_id", "updated_at"]
EVENT_FIELDS = ["id", "name", "type", "status", "start_date", "end_date", "budget", "color", "source", "notes", "created_at"]
RULE_FIELDS = ["id", "priority", "pattern", "direction", "amount_min", "amount_max", "account_id", "merchant",
               "category_id", "source", "created_at"]
IMPORT_FIELDS = ["id", "imported_at", "account_id", "source_type", "file_name", "file_sha256", "period_start",
                 "period_end", "rows_in_file", "rows_added", "rows_duplicate", "closing_balance", "checks", "by"]
NON_TRIP_CATEGORIES = {"salary", "tax-refund", "work-reimbursement", "family-support", "other-income",
                       "software-ai", "streaming", "phone", "gym", "utilities", "rent", "savings-transfer",
                       "flights", "accommodation", "travel-other"}

# ---------- io ----------
def p(*parts): return os.path.join(ROOT, *parts)

def read_csv(path):
    if not os.path.exists(path): return []
    with open(path, newline="", encoding="utf-8") as f: return list(csv.DictReader(f))

def write_csv(path, rows, fields):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore", lineterminator="\n")
        w.writeheader(); w.writerows(rows)

def txn_files(): return sorted(glob.glob(p("transactions", "*", "*.csv")))

def load():
    d = {
        "accounts": {a["id"]: a for a in read_csv(p("accounts.csv"))},
        "categories": {c["id"]: c for c in read_csv(p("categories.csv"))},
        "rules": sorted(read_csv(p("rules.csv")), key=lambda r: int(r["priority"])),
        "overrides": {o["txn_id"]: o for o in read_csv(p("overrides.csv"))},
        "events": read_csv(p("events.csv")),
        "settings": json.load(open(p("settings.json"))) if os.path.exists(p("settings.json")) else {},
    }
    txns = []
    for f in txn_files():
        for r in read_csv(f): r["_file"] = f; txns.append(r)
    for m in read_csv(p("manual.csv")):
        txns.append({"id": m["id"], "account_id": m["account_id"], "booking_date": m["date"], "value_date": m["date"],
                     "description_raw": m["description"], "amount": m["amount"], "currency": m.get("currency") or "EUR",
                     "balance_after": "", "category_suggested": m.get("category_id", ""), "suggested_by": "manual",
                     "_manual": m})
    txns.sort(key=lambda t: (t["value_date"], t["booking_date"]))
    d["txns"] = txns
    return d

# ---------- core rules (mirror these exactly in the app) ----------
PREFIX = re.compile(r"^(COMPRAS C\.DEB|COMPRA)\s+")
def norm(desc):
    s = re.sub(r"\s+", " ", desc.strip().upper())
    return PREFIX.sub("", s)

def is_card_intl(t): return t["description_raw"].upper().startswith("COMPRAS C.DEB")
def is_fx_fee(t): return norm(t["description_raw"]).startswith("COMISSAO COMPRAS FORA")

def rule_matches(rule, t, desc_norm, amount):
    if rule.get("account_id") and rule["account_id"] != t["account_id"]: return False
    if rule.get("direction") == "in" and amount <= 0: return False
    if rule.get("direction") == "out" and amount >= 0: return False
    a = abs(amount)
    if rule.get("amount_min") and a < Decimal(rule["amount_min"]): return False
    if rule.get("amount_max") and a > Decimal(rule["amount_max"]): return False
    return re.search(rule["pattern"], desc_norm, re.IGNORECASE) is not None

def merchant_key(desc_norm):
    words = re.sub(r"[^A-Z ]", " ", desc_norm).split()
    return " ".join(words[:2]) if words else desc_norm

def categorize(d, t):
    """Returns (category_id, merchant, source). Precedence: override > rule > suggestion > uncategorized."""
    dn, amount = norm(t["description_raw"]), Decimal(t["amount"])
    o = d["overrides"].get(t["id"])
    rule = next((r for r in d["rules"] if rule_matches(r, t, dn, amount)), None)
    merchant = (rule["merchant"] if rule and rule["merchant"] else None) or dn.title()
    if o and o.get("category_id"): return o["category_id"], merchant, "override"
    if rule: return rule["category_id"], merchant, "rule:" + rule["id"]
    if t.get("category_suggested"): return t["category_suggested"], merchant, "suggested:" + (t.get("suggested_by") or "?")
    return "uncategorized", merchant, "none"

def effective(d, t):
    """Adds the reporting view: kind (expense|income|transfer), reporting category, excluded flag."""
    cat_id, merchant, src = categorize(d, t)
    cat = d["categories"].get(cat_id) or d["categories"]["uncategorized"]
    kind, rep_cat, group = cat["kind"], cat_id, cat["group"]
    if kind == "transfer" and cat.get("counterparty_account"):
        acct = d["accounts"].get(cat["counterparty_account"])
        if not acct or acct.get("tracked", "false").lower() != "true":
            # Money moved to an account we don't import is spending we can't itemise (and money coming
            # back from it reduces that spending).
            kind, rep_cat, group = "expense", "unitemized-" + cat["counterparty_account"], "Unitemized"
    o = d["overrides"].get(t["id"]) or {}
    return {"category_id": cat_id, "report_category": rep_cat, "group": group, "kind": kind, "merchant": merchant,
            "source": src, "excluded": (o.get("excluded", "").lower() == "true"), "event_id": o.get("event_id", "")}

def recurring_keys(d, min_months=3):
    seen = defaultdict(set)
    for t in d["txns"]:
        if Decimal(t["amount"]) < 0:
            seen[merchant_key(norm(t["description_raw"]))].add(t["value_date"][:7])
    return {k for k, months in seen.items() if len(months) >= min_months}

# ---------- commands ----------
def cmd_ingest(a):
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import parse_cgd
    rows, info, errors = parse_cgd.parse(a.file, a.account)
    if errors:
        for e in errors: print("ERROR:", e)
        sys.exit("Parser checks failed: nothing written. Do not hand-edit rows; report the error.")
    d = load()
    existing = {t["id"] for t in d["txns"]}
    sha = hashlib.sha256(open(a.file, "rb").read()).hexdigest()
    imports = read_csv(p("imports.csv"))
    if any(i["file_sha256"] == sha for i in imports):
        print("This exact file was already imported; nothing to do."); return
    imp_id = "imp-" + dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    new = [dict(r, import_id=imp_id, category_suggested="", suggested_by="", review_note="") for r in rows if r["id"] not in existing]
    # continuity check against what we already have for this account
    acct_rows = [t for t in d["txns"] if t["account_id"] == a.account and t.get("balance_after")]
    warn = ""
    if acct_rows and new:
        first_new = new[0]
        opening = Decimal(first_new["balance_after"]) - Decimal(first_new["amount"])
        before = [t for t in acct_rows if t["booking_date"] <= first_new["booking_date"]]
        if before and not any(Decimal(t["balance_after"]) == opening for t in before[-30:]):
            warn = f"GAP? opening balance {opening} of first new row ({first_new['booking_date']}) matches no earlier closing balance"
    by_month = defaultdict(list)
    for r in new: by_month[r["booking_date"][:7]].append(r)
    for ym, rs in by_month.items():
        path = p("transactions", ym[:4], f"{ym}.csv")
        old = read_csv(path)
        # Stable sort on booking_date only: keeps statement order within a day (old rows first, then new
        # rows in parsed order), which the balance-chain check depends on.
        merged = sorted(old + rs, key=lambda t: t["booking_date"])
        write_csv(path, merged, TXN_FIELDS)
    imports.append({"id": imp_id, "imported_at": dt.datetime.now().isoformat(timespec="seconds"), "account_id": a.account,
                    "source_type": "cgd-pdf", "file_name": os.path.basename(a.file), "file_sha256": sha,
                    "period_start": info.get("period_start", ""), "period_end": info.get("period_end", ""),
                    "rows_in_file": len(rows), "rows_added": len(new), "rows_duplicate": len(rows) - len(new),
                    "closing_balance": str(info.get("closing_balance", "")), "checks": "ok" + ("; " + warn if warn else ""),
                    "by": a.by})
    write_csv(p("imports.csv"), imports, IMPORT_FIELDS)
    print(f"import {imp_id}: {len(rows)} rows in file, {len(new)} new, {len(rows)-len(new)} duplicates skipped")
    if warn: print("WARNING:", warn)
    cmd_unmatched(argparse.Namespace(limit=40, import_id=imp_id))

def cmd_unmatched(a):
    d = load()
    groups = defaultdict(list)
    for t in d["txns"]:
        if getattr(a, "import_id", None) and t.get("import_id") != a.import_id: continue
        cat, m, src = categorize(d, t)
        if src == "none": groups[norm(t["description_raw"])].append(t)
    total = sum(len(v) for v in groups.values())
    print(f"{total} rows / {len(groups)} descriptions with no rule, override or suggestion")
    for k, v in sorted(groups.items(), key=lambda kv: -sum(abs(Decimal(t['amount'])) for t in kv[1]))[: a.limit]:
        amt = sum(Decimal(t["amount"]) for t in v)
        print(f"  {k:<26} x{len(v):<3} {amt:>9}  e.g. {v[0]['id']} {v[0]['value_date']}")

def cmd_suggest(a):
    for f in txn_files():
        rows = read_csv(f)
        for r in rows:
            if r["id"] == a.txn_id:
                if a.category not in {c["id"] for c in read_csv(p("categories.csv"))}:
                    sys.exit(f"Unknown category {a.category}")
                r["category_suggested"], r["suggested_by"], r["review_note"] = a.category, a.by, a.note or ""
                write_csv(f, rows, TXN_FIELDS); print("ok", a.txn_id, "->", a.category); return
    sys.exit("txn not found")

def cmd_add_rule(a):
    re.compile(a.pattern)
    cats = {c["id"] for c in read_csv(p("categories.csv"))}
    if a.category not in cats: sys.exit(f"Unknown category {a.category}")
    rules = read_csv(p("rules.csv"))
    n = max([int(r["id"][1:]) for r in rules if r["id"][1:].isdigit()] + [0]) + 1
    prio = a.priority or (max([int(r["priority"]) for r in rules] + [0]) + 10)
    rules.append({"id": f"r{n:03d}", "priority": prio, "pattern": a.pattern, "direction": a.direction or "",
                  "amount_min": a.min or "", "amount_max": a.max or "", "account_id": "", "merchant": a.merchant or "",
                  "category_id": a.category, "source": a.by, "created_at": dt.date.today().isoformat()})
    write_csv(p("rules.csv"), rules, RULE_FIELDS)
    print(f"added r{n:03d} (priority {prio}): /{a.pattern}/ -> {a.category}")

def cmd_pairs(a):
    d = load()
    txns = [t for t in d["txns"] if not t.get("_manual")]
    ins = [t for t in txns if Decimal(t["amount"]) > 0 and categorize(d, t)[0] == "people-in"]
    for t in ins:
        day = dt.date.fromisoformat(t["value_date"])
        amt = Decimal(t["amount"])
        exact = [o for o in txns if Decimal(o["amount"]) == -amt and abs((dt.date.fromisoformat(o["value_date"]) - day).days) <= 1]
        if exact:
            o = exact[0]; print(f"PASS-THROUGH {t['value_date']} +{amt} {norm(t['description_raw'])}  <->  {o['value_date']} {o['amount']} {norm(o['description_raw'])}"); continue
        cands = [o for o in txns if Decimal(o["amount"]) <= -amt * Decimal("1.5")
                 and 0 <= (day - dt.date.fromisoformat(o["value_date"])).days <= 3
                 and categorize(d, o)[0] in {"restaurants", "bars-nightlife", "entertainment", "groceries", "delivery", "travel-other", "accommodation", "people-out", "online-shopping"}]
        if cands:
            o = max(cands, key=lambda o: -Decimal(o["amount"]))
            print(f"PAYBACK?     {t['value_date']} +{amt} {norm(t['description_raw'])}  for  {o['value_date']} {o['amount']} {norm(o['description_raw'])} [{categorize(d, o)[0]}]")

def detect_trips(d):
    s = d["settings"].get("trip_detection", {})
    away_score, max_gap, min_score = s.get("away_day_score", 3), s.get("max_gap_days", 2), s.get("min_trip_score", 6)
    rec = recurring_keys(d)
    score = defaultdict(int); fee_pts = defaultdict(int)
    for t in d["txns"]:
        if Decimal(t["amount"]) >= 0: continue
        day = t["value_date"]
        if is_fx_fee(t):  # FX fees score even though they recur (they follow every foreign purchase)
            if fee_pts[day] < 2: fee_pts[day] += 1; score[day] += 1
            continue
        cat = categorize(d, t)[0]
        if cat in NON_TRIP_CATEGORIES or merchant_key(norm(t["description_raw"])) in rec: continue
        if is_card_intl(t): score[day] += 2
        elif t.get("currency", "EUR") != d["settings"].get("home_currency", "EUR"): score[day] += 3
    away = sorted(day for day, sc in score.items() if sc >= away_score)
    clusters, cur = [], []
    for day in away:
        if cur and (dt.date.fromisoformat(day) - dt.date.fromisoformat(cur[-1])).days > max_gap:
            clusters.append(cur); cur = []
        cur.append(day)
    if cur: clusters.append(cur)
    # Extend each cluster to neighbouring days (within max_gap) that still have some foreign activity (score >= 2),
    # e.g. the airport coffee on the way home.
    for c in clusters:
        while True:
            cand = [x for x in score if score[x] >= 2 and 0 < (dt.date.fromisoformat(x) - dt.date.fromisoformat(c[-1])).days <= max_gap]
            if not cand: break
            c.append(min(cand))
        while True:
            cand = [x for x in score if score[x] >= 2 and 0 < (dt.date.fromisoformat(c[0]) - dt.date.fromisoformat(x)).days <= max_gap]
            if not cand: break
            c.insert(0, max(cand))
    starts = [c[0] for c in clusters]
    def nearest_following_start(v):
        later = [x for x in starts if x > v]
        return min(later) if later else None
    out = []
    for c in clusters:
        start, end = c[0], c[-1]
        total_score = sum(score[x] for x in score if start <= x <= end)
        span = (dt.date.fromisoformat(end) - dt.date.fromisoformat(start)).days + 1
        if span < 2 and total_score < min_score: continue
        members, pre = [], []
        s0 = dt.date.fromisoformat(start)
        for t in d["txns"]:
            amt, v = Decimal(t["amount"]), t["value_date"]
            cat = categorize(d, t)[0]; eff = effective(d, t)
            if start <= v <= end and amt < 0 and cat not in NON_TRIP_CATEGORIES:
                members.append(t)   # everything spent in the window (incl. FX fees, cash, Revolut top-ups); owner unticks strays
            elif eff["report_category"] == "unitemized-revolut" and amt < 0 and (s0 - dt.timedelta(days=2)).isoformat() <= v < start:
                members.append(t)   # top-ups in the 2 days before departure
            elif cat in {"flights", "accommodation", "travel-other"} and nearest_following_start(v) == start \
                    and 0 < (s0 - dt.date.fromisoformat(v)).days <= s.get("pre_trip_window_days", 120):
                pre.append(t)
        # Pre-untick things that are probably home life happening during the trip (online orders, MB Way to
        # friends, recurring domestic merchants). The owner can tick them back.
        def likely_home(t):
            cat = categorize(d, t)[0]
            if is_card_intl(t) or is_fx_fee(t) or cat == "cash-withdrawal": return False
            return cat in {"online-shopping", "people-out"} or merchant_key(norm(t["description_raw"])) in rec
        unticked = [t for t in members if likely_home(t)]
        ticked = [t for t in members if not likely_home(t)]
        out.append({"start": start, "end": end, "days": span, "score": total_score,
                    "total": str(-sum(Decimal(t["amount"]) for t in ticked)), "members": [t["id"] for t in members],
                    "unticked": [t["id"] for t in unticked],
                    "pre_trip_suggestions": [t["id"] for t in pre],
                    "sample": sorted({norm(t["description_raw"]) for t in ticked})[:8]})
    return out

def cmd_detect_trips(a):
    d = load(); trips = detect_trips(d)
    events = d["events"]
    for tr in trips:
        overlap = [e for e in events if e["type"] in ("trip", "work-trip") and not (e["end_date"] < tr["start"] or e["start_date"] > tr["end"])]
        tag = f"(overlaps {overlap[0]['id']} '{overlap[0]['name']}' {overlap[0]['status']})" if overlap else "(new)"
        print(f"{tr['start']}..{tr['end']}  {tr['days']}d  score {tr['score']}  €{tr['total']}  {len(tr['members'])} txns ({len(tr['unticked'])} unticked)  pre-trip: {len(tr['pre_trip_suggestions'])}  {tag}")
        print("    ", ", ".join(tr["sample"]))
        if a.write and not overlap:
            events.append({"id": f"ev-{tr['start']}", "name": f"Trip {tr['start']}", "type": "trip", "status": "proposed",
                           "start_date": tr["start"], "end_date": tr["end"], "budget": "", "color": "", "source": "detector",
                           "notes": "", "created_at": dt.date.today().isoformat()})
    if a.write: write_csv(p("events.csv"), events, EVENT_FIELDS); print("events.csv updated")

def month_summary(d, months=None):
    agg = defaultdict(lambda: defaultdict(Decimal))
    for t in d["txns"]:
        e = effective(d, t)
        if e["excluded"] or e["kind"] == "transfer": continue
        ym = t["value_date"][:7]
        agg[ym]["income" if e["kind"] == "income" else "spend:" + e["group"]] += Decimal(t["amount"])
        # A manual entry on an untracked account itemises money already counted as unitemized
        # (e.g. cash from an ATM): move it out of Unitemized so the total doesn't change.
        acct = d["accounts"].get(t["account_id"], {})
        if t.get("_manual") and e["kind"] == "expense" and acct.get("tracked", "false").lower() != "true":
            agg[ym]["spend:Unitemized"] -= Decimal(t["amount"])
    keys = sorted(agg)[-months:] if months else sorted(agg)
    return {k: dict(agg[k]) for k in keys}

def cmd_summary(a):
    d = load(); s = month_summary(d, a.months)
    groups = sorted({g for m in s.values() for g in m if g.startswith("spend:")})
    print("month     income    spend    saved  rate | " + " | ".join(g[6:][:10] for g in groups))
    for ym, m in s.items():
        inc = m.get("income", Decimal(0)); sp = -sum(v for k, v in m.items() if k.startswith("spend:"))
        rate = f"{(inc - sp) / inc * 100:5.0f}%" if inc else "   - "
        print(f"{ym}  {inc:8.2f} {sp:8.2f} {inc - sp:8.2f} {rate} | " + " | ".join(f"{-m.get(g, 0):8.2f}" for g in groups))

def cmd_validate(a):
    d = load(); errs = []
    ids = [t["id"] for t in d["txns"]]
    if len(ids) != len(set(ids)): errs.append("duplicate transaction ids")
    cats = d["categories"]
    for r in d["rules"]:
        try: re.compile(r["pattern"])
        except re.error as e: errs.append(f"rule {r['id']} bad regex: {e}")
        if r["category_id"] not in cats: errs.append(f"rule {r['id']} unknown category {r['category_id']}")
    for t in d["txns"]:
        if t.get("category_suggested") and t["category_suggested"] not in cats: errs.append(f"{t['id']} unknown suggested category")
        if not re.match(r"^-?\d+\.\d{2}$", t["amount"]): errs.append(f"{t['id']} bad amount {t['amount']}")
    for o in d["overrides"].values():
        if o.get("category_id") and o["category_id"] not in cats: errs.append(f"override {o['txn_id']} unknown category")
    for c in cats.values():
        if c["kind"] not in ("expense", "income", "transfer"): errs.append(f"category {c['id']} bad kind")
    # balance chain per account, in file order (statement order)
    for acct in d["accounts"]:
        rows = []
        for f in txn_files():
            rows += [t for t in read_csv(f) if t["account_id"] == acct and t["balance_after"]]
        for prev, cur in zip(rows, rows[1:]):
            if Decimal(prev["balance_after"]) + Decimal(cur["amount"]) != Decimal(cur["balance_after"]):
                errs.append(f"{acct}: balance chain break before {cur['id']} {cur['booking_date']} ({prev['balance_after']} + {cur['amount']} != {cur['balance_after']})")
                break
    print("validate:", "OK" if not errs else f"{len(errs)} problem(s)")
    for e in errs[:50]: print("  -", e)
    sys.exit(1 if errs else 0)

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--by", default="claude", help="who is making the change (stored in source columns)")
    sp = ap.add_subparsers(dest="cmd", required=True)
    x = sp.add_parser("ingest"); x.add_argument("file"); x.add_argument("--account", default="cgd-main"); x.set_defaults(f=cmd_ingest)
    x = sp.add_parser("unmatched"); x.add_argument("--limit", type=int, default=60); x.add_argument("--import-id"); x.set_defaults(f=cmd_unmatched)
    x = sp.add_parser("suggest"); x.add_argument("txn_id"); x.add_argument("category"); x.add_argument("--note"); x.set_defaults(f=cmd_suggest)
    x = sp.add_parser("add-rule"); x.add_argument("pattern"); x.add_argument("category"); x.add_argument("--merchant")
    x.add_argument("--direction", choices=["in", "out"]); x.add_argument("--min"); x.add_argument("--max"); x.add_argument("--priority", type=int); x.set_defaults(f=cmd_add_rule)
    x = sp.add_parser("pairs"); x.set_defaults(f=cmd_pairs)
    x = sp.add_parser("detect-trips"); x.add_argument("--write", action="store_true"); x.set_defaults(f=cmd_detect_trips)
    x = sp.add_parser("summary"); x.add_argument("--months", type=int); x.set_defaults(f=cmd_summary)
    x = sp.add_parser("validate"); x.set_defaults(f=cmd_validate)
    a = ap.parse_args(); a.f(a)

if __name__ == "__main__":
    main()
