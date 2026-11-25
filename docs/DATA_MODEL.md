# Data model (contract)

This document and `reference/mh.py` define the data repo format and every calculation. The TypeScript core
must match `reference/mh.py`; parity is enforced by tests against `fixtures/golden/`. Section numbers are
referenced from SPEC and ARCHITECTURE.

## 1. Data repo layout

```
accounts.csv        categories.csv      rules.csv          settings.json
events.csv          overrides.csv       manual.csv
budgets.csv         goals.csv           balances.csv       imports.csv
transactions/2026/2026-11.csv           (one file per booking month)
tools/              ingest tools (copy of reference/), used by the ingest session
.claude/skills/     ingest skill for the ingest session
```

Raw statements are **never** committed (data repo `.gitignore` blocks `*.pdf`, `*.xls*`, `inbox/`).

## 2. Conventions and ownership

- UTF-8, comma separated, header row, `\n` line endings, RFC 4180 quoting.
- Dates `YYYY-MM-DD`; timestamps ISO 8601 local time. Amounts are strings with a dot and exactly two
  decimals, negative = money out (`-12.34`). Booleans `true`/`false`. Empty cell = not set.
- Unknown columns must be preserved on rewrite (forward compatibility).

| File | Written by | Notes |
|---|---|---|
| `transactions/**` | ingest (session or M5 in-app import) | append-only; the session may fill the three suggestion columns |
| `imports.csv` | ingest | one row per imported file |
| `rules.csv` | app and session | session appends only, with `source=claude` |
| `events.csv` | app; session may append `status=proposed` rows | only the app confirms or dismisses |
| `overrides.csv`, `manual.csv`, `budgets.csv`, `goals.csv`, `balances.csv` | app only | the owner's decisions |
| `accounts.csv`, `categories.csv`, `settings.json` | app (seeded once) | |

## 3. Files

### transactions/YYYY/YYYY-MM.csv (partitioned by `booking_date` month)

| column | type | notes |
|---|---|---|
| id | string(16) | §4 |
| account_id | → accounts.id | |
| booking_date | date | CGD "Data mov." |
| value_date | date | CGD "Data-valor". **All analysis uses value_date** (for card purchases abroad it is the purchase date; booking comes 2–4 days later) |
| description_raw | string | as printed, whitespace collapsed (CGD truncates to ~21 chars) |
| amount | money | signed |
| currency | ISO 4217 | `EUR` for CGD |
| balance_after | money | running balance after the row; empty if the source has none |
| import_id | → imports.id | |
| category_suggested | → categories.id | set by the ingest session for rows no rule covers |
| suggested_by | string | e.g. `claude-sonnet` |
| review_note | string | short question or reason shown in the review inbox |

Row order inside a file is statement order (oldest first); the balance chain (§4) depends on it.

### accounts.csv
`id, name, institution, type (current|savings|wallet|cash), currency, tracked (bool), opening_date, notes`.
**tracked** = this account's own transactions are imported or logged in full. See §6.

### categories.csv
`id, name, group, kind (expense|income|transfer), counterparty_account, budgetable (bool), icon`.
`counterparty_account` is set on transfer categories (e.g. `transfer-revolut` → `revolut`, `cash-withdrawal` → `cash`).
Reserved ids: `uncategorized`. Synthetic reporting ids `unitemized-<account_id>` are generated (§6), never stored here.

### rules.csv
`id, priority (int, ascending = first), pattern (regex), direction (in|out|empty), amount_min, amount_max,
account_id, merchant (display name, optional), category_id, source (seed|user|claude), created_at`.

Regex dialect: the common subset of Python `re` and JavaScript (no lookbehind, no named groups, no inline flags).
Matching is case-insensitive and unanchored unless the pattern anchors itself (`^`).

### events.csv
`id, name, type (trip|work-trip|stage|tag), status (proposed|confirmed|dismissed), start_date, end_date (empty =
open stage), budget (money, optional), color, source (detector|claude|user), notes, created_at`.

### overrides.csv (one row per transaction, upsert by txn_id)
`txn_id, category_id, event_id, note, excluded (bool), reimburses_txn_id, updated_at`. Empty cell = no override
for that field. Applies to imported and manual transactions.

### manual.csv
`id (m-<uuid>), account_id, date, description, amount, currency, category_id, event_id, note, created_at`.
Treated as a transaction with `booking_date = value_date = date`, no balance, `category_suggested = category_id`.
Quick add only offers accounts with no imports (cash, untracked Revolut…) to avoid double counting.

### budgets.csv
`id, scope (category|group|total), target (category id incl. unitemized-*, group name, or "all"), monthly_limit,
start_month (YYYY-MM), end_month (YYYY-MM or empty), exclude_events (bool), notes`.

### goals.csv
`id, name, target_amount, target_date, basis (net-worth | account:<id> | savings-since-start), start_date,
start_amount, priority, notes`.

### balances.csv
`date, account_id, balance, note`: manual snapshots for accounts without a running balance.

### imports.csv
`id, imported_at, account_id, source_type (cgd-pdf|cgd-xlsx|revolut-csv|paypal-csv|app-cgd-pdf), file_name,
file_sha256, period_start, period_end, rows_in_file, rows_added, rows_duplicate, closing_balance, checks, by`.

### settings.json
```json
{ "schema_version": 1, "home_currency": "EUR", "locale": "pt-PT", "ui_language": "en",
  "week_starts_on": "monday", "home_area": ["LISBOA", "..."],
  "trip_detection": { "away_day_score": 3, "max_gap_days": 2, "min_trip_score": 6, "pre_trip_window_days": 120 },
  "budgets": { "exclude_confirmed_trips": false } }
```

## 4. Ids, dedup and integrity

- `id = sha1("{account_id}|{booking_date}|{value_date}|{description_raw}|{amount}|{balance_after}|{n}")[:16]`
  (hex), where amounts are formatted with two decimals and `n` is the 0-based occurrence count of the identical
  prefix within the same parsed statement. Re-importing an overlapping statement therefore produces the same ids and the
  duplicates are skipped.
- A file whose `file_sha256` is already in `imports.csv` is refused.
- **Balance chain:** for each account, in statement order, `prev.balance_after + amount == balance_after`.
  The parser also checks the last row against the statement header's closing balance. Any failure aborts the
  import; nothing is written.
- **Gap check:** the opening balance of the first new row (`balance_after − amount`) should equal the
  balance_after of an existing row on or before that date; otherwise warn "missing transactions?".

## 5. Derived fields

- `description_norm` = uppercase, whitespace collapsed, trimmed, then the leading prefix `COMPRAS C.DEB ` or
  `COMPRA ` removed (regex `^(COMPRAS C\.DEB|COMPRA)\s+`).
- `card_intl` = `description_raw` (uppercased) starts with `COMPRAS C.DEB` (card purchase through the
  international network).
- `fx_fee` = `description_norm` starts with `COMISSAO COMPRAS FORA` (CGD fee on non-EUR card purchases, ≈2.08%,
  same value date as the purchase).
- `merchant_key` = first two words of `description_norm` after replacing every char outside `A–Z` and space
  with a space (used for recurring detection).
- `merchant` (display) = the matched rule's `merchant` if set, else `description_norm` in title case (first letter
  of every run of letters uppercase, the rest lowercase, exactly like Python `str.title()`).

## 6. Categorisation and the reporting view

**Category precedence** (first that applies):

1. `overrides.category_id` → source `override`
2. first rule (by `priority`) whose conditions all hold → source `rule:<id>`
   - `account_id` (if set) equals the transaction's; `direction=in` needs amount > 0, `out` needs amount < 0;
     `amount_min ≤ |amount| ≤ amount_max` (each bound optional, inclusive); `pattern` matches `description_norm`
3. `category_suggested` → source `suggested:<suggested_by>`
4. `uncategorized` → source `none`

The display merchant comes from the first matching rule even when an override decides the category.

**Reporting view** (`effective()` in mh.py) for each transaction:

- `kind`, `report_category`, `group` come from the category, except: if the category's kind is `transfer`, it
  has a `counterparty_account`, and that account is missing or `tracked=false`, then
  `kind = expense`, `report_category = unitemized-<account>`, `group = Unitemized`. Money sent to an account we
  don't itemise is counted as spent; money coming back from it reduces that spending.
- `excluded` and `event_id` come from overrides.

**Sign rule (refunds and paybacks):** a positive amount in an expense category reduces that category's spending.
Linking a friend's payback (`reimburses_txn_id`) copies the expense's category to the payback, so a €80 dinner
with €40 paid back shows €40 in Restaurants (net view). Gross view = negative amounts only.

**Manual entries on untracked accounts** itemise money already counted as unitemized: in summaries, the
amount counts in its own category *and* the opposite amount is added to `Unitemized` in the same month, so the
total doesn't change (example: €60 ATM withdrawal + €15.50 logged francesinha ⇒ Unitemized €44.50, Food €15.50).

## 7. Event membership

- `trip` / `work-trip`: transactions whose override `event_id` points to the event (explicit set).
- `stage`: every transaction with `start_date ≤ value_date ≤ end_date` (open end = today).
- `tag`: explicit, like trips.
- App-side filter on detector output: hide candidates that overlap a `confirmed` or `dismissed` trip/work-trip;
  if a candidate overlaps a `proposed` event (e.g. one the ingest session named), show them as one proposal
  using the event's name and dates and the detector's members.

## 8. Recurring

`recurring_keys` = merchant_keys of outflows that occur in at least 3 distinct calendar months. The Recurring
panel also shows the median interval, typical amount and next expected date (app-only, not in parity tests).

## 9. Monthly summary, spent, saved

For each transaction (imported + manual) that is not excluded and whose reporting kind is not `transfer`,
bucket by `value_date` month:

- `income` += amount if kind is `income`
- `spend:<group>` += amount otherwise (negative numbers), plus the manual-entry offset from §6

**Spent** = −Σ spend groups. **Saved** = income − spent. **Savings rate** = saved / income (undefined if income = 0).
`fixtures/golden/monthly-summary.json` is this structure for the demo data.

**Budget progress** for month M: the active row for (scope, target) is the one with the latest
`start_month ≤ M` and (`end_month` empty or ≥ M). Spent = net spend of matching transactions (by
`report_category`, `group`, or all expense), excluding members of confirmed trips when `exclude_events=true`.
Pace = limit × day / days_in_month. Projection (current month) = spent / days_elapsed × days_in_month once
7+ days have elapsed; before that, max(spent, trailing 3-month average).

## 10. Balances, net worth, goals

- Account balance = last `balance_after` in statement order if the account has imported rows with balances,
  else the latest `balances.csv` snapshot, else unknown (shown as "—", excluded from net worth with a warning).
- Net worth = Σ known account balances.
- Goal value: `net-worth` → net worth; `account:<id>` → that balance; `savings-since-start` → `start_amount` +
  Σ saved for whole months from `start_date`'s month up to the current month.
- Progress = value / target (clamped 0–100%). Required per month = max(0, target − value) / max(1, whole months
  left to `target_date`). On track ⇔ value ≥ start_amount + (target − start_amount) × elapsed share of the
  start→target period.

## 11. Trip detection (foreign trips)

Deterministic; parameters from `settings.trip_detection`.

1. **Score days** (by value_date), over outflows only:
   - FX fee row: +1, at most 2 points per day (fees score even though they recur).
   - Skip rows whose category is in NON_TRIP (`salary, tax-refund, work-reimbursement, family-support,
     other-income, software-ai, streaming, phone, gym, utilities, rent, savings-transfer, flights, accommodation,
     travel-other`) or whose merchant_key is recurring.
   - `card_intl` row: +2. Otherwise, currency ≠ home currency: +3.
2. **Away days** = days with score ≥ `away_day_score`. Sort; split into clusters where consecutive away days are
   more than `max_gap_days` apart.
3. **Extend** each cluster forward, then backward, one day at a time, to the nearest day with score ≥ 2 that is
   within `max_gap_days` of the current edge.
4. **Keep** clusters spanning ≥ 2 days or whose total score (sum over days in range) ≥ `min_trip_score`.
5. **Members** = outflows with value_date in [start, end] and category not in NON_TRIP, plus
   `unitemized-revolut` outflows in the 2 days before start.
6. **Unticked by default** = members that are not card_intl, not FX fees, not cash withdrawals, and are either in
   `online-shopping` / `people-out` or have a recurring merchant_key. Proposal total = ticked members.
7. **Pre-trip suggestions** = transactions in `flights`, `accommodation`, `travel-other` dated 1 to
   `pre_trip_window_days` days before start, assigned only to the nearest trip that starts after them.

Domestic trips have no reliable bank signal; the ingest session proposes them from place names outside
`settings.home_area` (tolls on long motorways, supermarkets in other towns over consecutive days).

## 12. Payback and pass-through suggestions

For each incoming `people-in` transaction:

- **Pass-through:** an outflow of exactly the opposite amount within ±1 day → suggest linking both to one category.
- **Payback:** otherwise, the largest outflow 0–3 days earlier with |amount| ≥ 1.5 × the payback, in
  restaurants, bars-nightlife, entertainment, groceries, delivery, travel-other, accommodation, people-out or
  online-shopping → suggest "payback for".

## 13. Schema versioning

`settings.schema_version` (currently 1). Changing columns or rules ⇒ bump it, update this file, `reference/mh.py`,
the golden files, and add a migration in `src/core/migrations.ts` that the app runs on load (and commits).
