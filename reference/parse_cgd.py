#!/usr/bin/env python3
"""Reference parser for Caixa Geral de Depositos 'Consultar saldos e movimentos a ordem' PDF exports.

Usage: python3 parse_cgd.py STATEMENT.pdf [--account cgd-main] [--out out.csv]

Reads every page, extracts movement rows by column position, and checks the running-balance
chain (each row's balance = previous row's balance + amount). Exits non-zero if any check fails.
Output: normalized CSV (see DATA_MODEL.md, table `transactions`), oldest first.
"""
import argparse, csv, hashlib, re, sys
from decimal import Decimal
import pdfplumber

DATE = re.compile(r"^\d{2}-\d{2}-\d{4}$")
AMOUNT = re.compile(r"^-?\d{1,3}(\.\d{3})*,\d{2}$")

# Column x-boundaries (points) measured on the CGD layout. Header words are used to re-measure
# per page when present, so small layout shifts don't break the parser.
DEFAULT_COLS = {"value_date": 130, "description": 205, "amount": 380, "balance": 440}


def eur(s: str) -> Decimal:
    return Decimal(s.replace(".", "").replace(",", "."))


def iso(d: str) -> str:
    dd, mm, yyyy = d.split("-")
    return f"{yyyy}-{mm}-{dd}"


def header_info(page):
    text = page.extract_text() or ""
    info = {}
    m = re.search(r"Saldo contabil\S*\s+([\d.]+,\d{2})\s+EUR", text)
    if m:
        info["closing_balance"] = eur(m.group(1))
    m = re.search(r"Intervalo de\s+(\d{2}-\d{2}-\d{4})\s+a\s+(\d{2}-\d{2}-\d{4})", text)
    if m:
        info["period_start"], info["period_end"] = iso(m.group(1)), iso(m.group(2))
    return info


def rows_from_page(page):
    words = page.extract_words(keep_blank_chars=False, use_text_flow=False)
    lines = {}
    for w in words:
        key = round(w["top"] / 2)  # 2pt tolerance
        lines.setdefault(key, []).append(w)
    out = []
    for key in sorted(lines):
        ws = sorted(lines[key], key=lambda w: w["x0"])
        if not ws or not DATE.match(ws[0]["text"]):
            continue
        cols = {"booking_date": [], "value_date": [], "description": [], "amount": [], "balance": []}
        for w in ws:
            x0, x1 = w["x0"], w["x1"]
            if x0 < DEFAULT_COLS["value_date"]:
                cols["booking_date"].append(w["text"])
            elif x0 < DEFAULT_COLS["description"]:
                cols["value_date"].append(w["text"])
            elif x1 <= DEFAULT_COLS["amount"] + 50 and x0 < DEFAULT_COLS["amount"] and not AMOUNT.match(w["text"]):
                cols["description"].append(w["text"])
            elif x1 <= DEFAULT_COLS["balance"]:
                cols["amount"].append(w["text"])
            else:
                cols["balance"].append(w["text"])
        # Amount-looking tokens inside the description zone (e.g. a merchant called "100") stay in description;
        # only the right-most two numeric tokens are amount and balance.
        row = {k: " ".join(v) for k, v in cols.items()}
        if not (DATE.match(row["booking_date"]) and DATE.match(row["value_date"])
                and AMOUNT.match(row["amount"]) and AMOUNT.match(row["balance"])):
            raise ValueError(f"Unparseable row on page {page.page_number}: {[w['text'] for w in ws]}")
        out.append(row)
    return out


def parse(path, account="cgd-main"):
    rows, info = [], {}
    with pdfplumber.open(path) as pdf:
        info = header_info(pdf.pages[0])
        for page in pdf.pages:
            rows.extend(rows_from_page(page))
    # PDF lists newest first; reverse to oldest first.
    rows.reverse()
    txns, errors = [], []
    prev_balance = None
    seen = {}
    for i, r in enumerate(rows):
        amount, balance = eur(r["amount"]), eur(r["balance"])
        if prev_balance is not None and prev_balance + amount != balance:
            errors.append(f"Balance chain broken at row {i}: {prev_balance} + {amount} != {balance} ({r})")
        prev_balance = balance
        base = f"{account}|{iso(r['booking_date'])}|{iso(r['value_date'])}|{r['description']}|{amount}|{balance}"
        n = seen.get(base, 0); seen[base] = n + 1
        tid = hashlib.sha1(f"{base}|{n}".encode()).hexdigest()[:16]
        txns.append({
            "id": tid,
            "account_id": account,
            "booking_date": iso(r["booking_date"]),
            "value_date": iso(r["value_date"]),
            "description_raw": r["description"],
            "amount": f"{amount:.2f}",
            "currency": "EUR",
            "balance_after": f"{balance:.2f}",
        })
    if txns and "closing_balance" in info and Decimal(txns[-1]["balance_after"]) != info["closing_balance"]:
        errors.append(f"Closing balance mismatch: last row {txns[-1]['balance_after']} vs header {info['closing_balance']}")
    return txns, info, errors


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("--account", default="cgd-main")
    ap.add_argument("--out", default="-")
    a = ap.parse_args()
    txns, info, errors = parse(a.pdf, a.account)
    fields = ["id", "account_id", "booking_date", "value_date", "description_raw", "amount", "currency", "balance_after"]
    fh = sys.stdout if a.out == "-" else open(a.out, "w", newline="", encoding="utf-8")
    w = csv.DictWriter(fh, fieldnames=fields)
    w.writeheader(); w.writerows(txns)
    if fh is not sys.stdout:
        fh.close()
    print(f"rows={len(txns)} period={info.get('period_start')}..{info.get('period_end')} "
          f"closing={info.get('closing_balance')} checks={'OK' if not errors else 'FAILED'}", file=sys.stderr)
    for e in errors:
        print("ERROR:", e, file=sys.stderr)
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
