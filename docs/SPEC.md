# Mealheiro: product spec

## 1. Purpose and principles

One person wants to see and steer where their money goes: by time, by category, by merchant, and by *life
context* (trips, work trips, life stages). Data comes mainly from Caixa Geral de Depósitos (CGD) statements, plus
money that leaves CGD through Revolut, PayPal, MB Way and cash.

Principles, in priority order:

1. **Trustworthy numbers.** Totals reconcile to the bank. Transfers are never counted as spending twice. Every
   number drills down to its transactions.
2. **Ten-second habits.** Logging a cash expense, fixing a category or confirming a trip takes one or two taps.
3. **The app proposes, the owner decides.** Detectors and the ingest session suggest categories, paybacks and
   trips; nothing is silently "decided" for the owner.
4. **Owner's data, plain files.** CSV in a private repo, readable in Excel or Power BI, with full git history.
5. **Phone first, desktop wide.** Same app; the desktop layout uses the extra width for side-by-side panels.

## 2. Jobs to be done

- *How am I doing this month?* Spent vs budget, income, saved, what's unusual.
- *Where does my money go?* By category group → category → merchant → transactions, over any period.
- *What did that trip cost me?* Including the flight booked weeks before, the FX fees and the Revolut top-ups.
- *Am I saving?* Savings rate per month, net worth trend, progress to goals.
- *What changed?* This month vs last, this stage vs the previous one, this year vs last.
- *Quick capture*: cash spending and balance snapshots for accounts that aren't imported.
- *Clean-up*: categorise the unknowns, tell the app who "Trf Mbway 912XXX001" is, link friends' paybacks.

## 3. Navigation

Bottom tab bar (phone) / left rail (desktop):

**Home** · **Activity** (transactions) · **Insights** · **Plan** (budgets and goals) · **More** (events, review,
import, settings).

A floating **+** button on Home and Activity opens Quick add. A badge on More shows the review count.
Events get their own tab if, in use, they turn out to be visited often (track in changelog; owner decides).

## 4. Screens and features

Acceptance criteria are marked **AC**. All money shown in pt-PT format (`1.234,56 €`), dates `dd/mm/yyyy`
or `12 Mar`. UI language English.

### 4.1 Home

- Month switcher (swipe or arrows), defaulting to the current month.
- KPI cards: **Spent** (net, see DATA_MODEL §6) with budget bar and "on pace / over pace"; **Income**; **Saved**
  (income − spent) with savings rate; **Balance** (CGD) and **Net worth**.
- **Budget pace chart**: cumulative spend vs a straight-line budget pace for the month, plus a dashed
  projection to month end.
- **Top categories** this month (5) with delta vs the trailing 3-month average.
- **Needs attention**: review count, proposed trips, budgets over 90%, "no import for 20+ days".
- Last 5 transactions.
- **AC:** with demo data, every KPI equals the corresponding figure from `fixtures/golden/monthly-summary.json`
  for that month; tapping any KPI opens Activity filtered to exactly the transactions that make it up.

### 4.2 Activity (transactions)

- Infinite list grouped by day, with day net total. Row: merchant (pretty name), category chip, event chip,
  amount (green for in, default for out, grey/struck for transfers and excluded).
- Search (merchant, raw description, note, amount like `12,5`) and filters: period, account, category/group,
  kind, event, "needs review", "has note".
- **Detail sheet**: raw description, value date and booking date, account, balance after, source (import id or
  manual), current category with *why* (override / rule `r012` / suggestion by claude / none). Actions:
  - Change category → then offer **"Apply to all like this?"** which creates a rule with a pre-filled, editable
    anchored pattern (e.g. `^REPSOL`) and shows how many past transactions it would change before saving.
  - Assign to event / remove from event.
  - Mark as **payback for…** (pick the expense it offsets; sets `reimburses_txn_id` and copies its category).
  - Add note; exclude from analysis (with reason).
- **AC:** changing a category updates every total on every screen immediately (optimistic), queues one override
  write, and survives an offline reload.

### 4.3 Insights

Period presets: this month, last month, last 3 / 6 / 12 months, year to date, calendar year, custom, and any
**stage** (§4.5). Optional "compare to": previous period, same period last year, another stage.

Panels (each tappable through to transactions):

- **Spending over time**: monthly stacked columns by group (toggle: category within a group), income line, and
  savings-rate line on a secondary axis.
- **Where it goes**: treemap group → category → merchant (donut on phone if the treemap is unreadable).
- **Money flow**: Sankey income → groups → saved, for the period.
- **Merchants**: top merchants by total and by count; frequency (visits/month).
- **Calendar heatmap**: daily spend, with trips shaded.
- **Recurring**: detected recurring payments (DATA_MODEL §8) with monthly cost and next expected date.
- **Gross vs net toggle**: net shows paybacks and refunds netted against their categories (default).
- **AC:** totals for a period equal the sum of `fixtures/golden/monthly-summary.json` months in it; switching
  period on a 2-year dataset (~1,200 rows) re-renders in under 150 ms on the phone.

### 4.4 Plan: budgets and goals

**Budgets** (DATA_MODEL `budgets.csv`): monthly limits per category, per group, or total. Optional setting to
exclude confirmed trips from monthly budgets (trips carry their own budget).

- List with progress bar, amount left, pace marker, and projected month-end (DATA_MODEL §9).
- Colour states: under pace (neutral), over pace (amber), projected over (amber outline), over (red).
- Editing a limit applies from the current month on (new row with `start_month`; history stays intact).
- "Suggest budgets" fills each from the trailing 6-month average, rounded up to €5, for the owner to adjust.

**Goals** (`goals.csv`): name, target amount, target date, basis (`net-worth`, `account:<id>`, or
`savings-since-start`).

- Card with progress, required monthly saving to hit the date, and on-track / behind state.
- **AC:** with demo data, goal progress matches DATA_MODEL §10 hand-calculated values in a unit test.

### 4.5 Events: trips, work trips, stages, tags

One concept, four types (DATA_MODEL `events.csv`):

- **Trip / work trip**: a date range plus an explicit set of member transactions. Work trips can be marked
  reimbursable and linked to the reimbursement income.
- **Stage**: a life period ("new job", "living alone"), open-ended allowed. Membership is the date range; used as
  an Insights period and for before/after comparisons.
- **Tag**: an arbitrary label on transactions (e.g. "Christmas gifts 2026").

**Trip detection** (DATA_MODEL §11) runs in the app on every data load and in the ingest session.

- *Proposed trips* appear in Needs attention and at the top of the Events list: dates, length, total, sample
  merchants, and **pre-trip suggestions** (flights or hotels booked up to 120 days before).
- Proposal sheet: rename, adjust dates, untick members (e.g. the supermarket run on the departure morning), tick
  pre-trip bookings, set type (trip / work trip), set a budget → **Confirm** writes `event_id` overrides for the
  ticked transactions and sets the event to `confirmed`. **Dismiss** sets `dismissed`; the detector never
  proposes the same range again.
- The ingest session may also propose events (e.g. domestic trips it recognises from town names); these appear
  the same way, with source "claude".
- **Trip page**: total, per day, by category, by day (bar), FX fees paid, unitemized money (Revolut top-ups and
  cash during the trip), pre-trip costs, vs budget, and its transaction list.
- **Stage compare**: average monthly spend by group, stage A vs stage B.
- **AC:** with demo data, the raw detector output equals `fixtures/golden/trips.json` (the domestic Porto
  weekend is *not* detected; it exists as a confirmed manual event). After the app-side filter, only the
  3–6 Jul proposal is shown, under the name of its matching proposed event (Edinburgh is already confirmed).

### 4.6 Review inbox

A queue of things that need the owner, each resolvable in one or two taps, one card at a time (swipe on phone):

1. **Uncategorised**: show the suggestion if any ("claude thinks: Restaurants, Porto weekend?") → confirm,
   pick another, or "apply to all like this" (rule).
2. **Who is this?**: unknown MB Way recipients (`Trf Mbway 912XXX001`) and transfer senders (`TFI JOANA FICTICIA SI`),
   grouped with count and total → give a nickname and a default category (creates a rule).
3. **Payback?**: incoming money from a person near a bigger shared expense (DATA_MODEL §12) → link / not a payback.
4. **Pass-through?**: equal in/out pair on the same day → link both to one category.
5. **Proposed events** (from §4.5).
6. **PayPal unknowns** (until PayPal enrichment exists, M5).

**AC:** clearing the inbox on the owner's first real import (≈80 items) takes under 10 minutes on the phone.

### 4.7 Quick add

Opened by **+**. Fields: amount (numeric keypad, default sign = expense, toggle for income), category (grid of the
8 most-used, "more…"), date (today), account (default **Cash**), note, event (pre-selected if today is inside a
confirmed trip). Second tab: **Balance snapshot** (account + balance + date) for Revolut/PayPal/cash.

- **AC:** from tapping + to saved in ≤ 3 taps + typing the amount; works offline.

### 4.8 Import

- **M2–M4:** read-only screen: history from `imports.csv` (period covered, rows added, checks), last import date
  per account, coverage gaps, and how to run an ingest session (link to data repo README).
- **M5:** in-app import of the CGD PDF (and Revolut CSV): pick a file or share it to Mealheiro from the CGD app
  (Android share target). Parse on device in a Web Worker, show a preview (new / duplicate / balance check
  result / unmatched count), then commit the new rows. Same rules and ids as `reference/parse_cgd.py`.
- **AC (M5):** importing `fixtures/cgd/synthetic-statement.pdf` produces rows identical to
  `fixtures/cgd/expected.csv`; importing it twice adds nothing.

### 4.9 Settings

- **Connection**: GitHub owner, data repo name, branch, token (fine-grained PAT), "Test connection".
- **App lock**: 4–6 digit PIN, required on open and after 5 min in background; the token is encrypted with a key
  derived from the PIN. "Forgot PIN" wipes local data (the data repo is untouched).
- **Accounts**: name, tracked on/off (explains the effect: untracked ⇒ money sent there counts as unitemized
  spending), manual balance snapshots.
- **Categories**: add, rename, merge, change group/kind, colour/icon.
- **Rules**: ordered list, drag to reorder, test a pattern against history before saving, see source (seed /
  user / claude) and hit count.
- **Trip detection**: thresholds from `settings.json`, home-area words.
- **Data**: export everything as a ZIP of CSVs; clear local cache; demo mode.

## 5. Calculations

Defined precisely in `DATA_MODEL.md`. Summary: analysis uses **value date**. **Spent** = net of expense-kind
transactions (refunds and paybacks reduce their category). **Transfers** between tracked accounts are neutral;
transfers to **untracked** accounts (Revolut, cash) are *unitemized spending* until that account is imported.
**Saved** = income − spent.

## 6. Visual direction

Calm, numeric, legible: a personal finance tool, not a casino.

- Neutral background, one accent colour, semantic colours only for state (over budget, income). Category
  colours from a fixed, colour-blind-safe palette; groups get hues, categories get tints.
- Tabular numerals for all amounts; right-aligned in lists; negatives without red unless they mean "bad".
- Big, readable KPI numbers; charts with direct labels instead of legends where possible; no 3D, no gradients.
- Light and dark mode following the system.
- Skeleton loaders on first sync; never a blank screen.

## 7. Non-functional

- **Performance:** cold start to Home under 2 s on the S23 with cached data; full recompute of 3,000 transactions
  under 100 ms (do it in a worker if not).
- **Offline:** full read access offline; edits queue and sync later.
- **Security:** token encrypted at rest (PIN); strict CSP; no third-party code at runtime; nothing sensitive in
  URLs or logs.
- **Accessibility:** WCAG AA contrast, 44 px touch targets, charts have a table view.
- **Data limits:** design for 10 years × 1,000 transactions.

## 8. Out of scope for v1

Bank API connections (open banking), multi-user/sharing, investments, multi-currency balances beyond showing
original currency on Revolut rows, receipts/photos, notifications.

## 9. Open questions for the owner

1. Should events get their own bottom tab from day one?
2. Calendar months for everything, or also a custom "financial month" starting on payday?
3. Paybacks: default view net (recommended) or gross?
4. Any categories to add or merge after the first month of use?
