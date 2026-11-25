# Changelog

All notable changes to Mealheiro. Each milestone lists what shipped and any decision taken where the spec
was silent (CLAUDE.md "Working style").

## M5: In-app import (2026-11-25)

### Shipped

- **Import a statement on the phone** (More → Import): pick a file or share the PDF from the CGD app straight
  to Mealheiro (Android share target). The file is read on the device; pdf.js extracts the text in its own
  worker, served from this origin.
- **CGD PDF:** a TypeScript port of `reference/parse_cgd.py`. It gives rows and ids identical to
  `fixtures/cgd/expected.csv`, with the same balance-chain and closing-balance checks.
- **Preview before saving:** in the file, new, already here, the balance checks, the "missing transactions?"
  gap warning, rows left out, and how many new rows no rule covers. You can pick the account. A statement
  that fails a check saves nothing, and Mealheiro never adjusts numbers.
- **Append-only import op.** New rows go into their booking-month files and the file is logged in
  `imports.csv`, all in one commit. Into an empty repo this writes month files byte for byte the same as
  `mh.py ingest`. Importing the same file again, or a statement an ingest session already pushed, adds
  nothing. The import waits in the pending-ops queue like any edit, so it survives going offline.
- **Revolut CSV:** only completed EUR rows are imported. A fee becomes its own row, suggested as Bank fees,
  and top-ups are suggested as Transfer to/from Revolut. The balance chain is checked in completion order.
  After the first import the app offers to mark the account as tracked.
- **PayPal CSV (enrichment):** each "PayPal Europe" outflow on CGD is matched to a PayPal payment with the
  same amount within 3 days. The rules suggest a category from the PayPal name. Saving sets the category
  and adds "PayPal: name" to the note.
- **Tests:**
  - the CGD parser, with pdf.js in Node, against `expected.csv`, a broken chain, and an unreadable row
  - import into an empty repo, re-import, an overlapping statement, and the gap warning
  - the import through sync, including when an ingest session pushed first
  - Revolut and PayPal parsing with synthetic fixtures
  - Playwright: PDF, Revolut and PayPal flows, plus the share target through the service worker

### Decisions

- **No data contract change.** Imports write only columns that already exist. A Revolut fee row and top-up
  carry `category_suggested` with `suggested_by=import`. PayPal names go in the override note, because
  overrides have no merchant column.
- **Revolut rows in another currency are left out**, and the preview says how many. Mealheiro would need
  their EUR amount, and the owner's first real export will show how to get it (IMPORT_FORMATS §3).
- **A file with nothing new is not logged.** `mh.py ingest` logs it anyway. This makes no difference to
  rows or ids.
- **Revolut and PayPal formats are written against IMPORT_FORMATS**, not a real export. Expect a small
  adjustment after the owner's first real file.

## M4: Events, budgets, goals (2026-11-25)

### Shipped

- **Trip proposals** (More → Events, and Needs attention on Home): open a proposal to rename it, change the
  dates, untick members, tick pre-trip bookings, pick trip or work trip and set a budget, with a live total.
  **Confirm** writes the event as confirmed and an `event_id` override on each ticked transaction;
  **Dismiss** keeps the event row as dismissed, so the detector doesn't propose that range again.
- **Event pages:** trips show spent, per day, pre-trip, FX fees and unitemized cash, a by-day chart, a
  by-category breakdown, the budget bar and every member. Stages compare their monthly averages with the
  same length of time before the stage, or with another stage. Tags list their transactions. Events can be
  added, edited and deleted.
- **Plan tab:** budgets for any month up to next month, with progress, pace marker, projected month-end and
  a state with an icon (on track, over pace, heading over, over). Edit or stop a budget from a month on;
  add a budget for a category, a group or everything; "Suggest budgets" fills each budgetable category from
  its 6-month average rounded up to €5. Goals with progress, the monthly saving needed and on track /
  behind; add, edit and delete.
- **Insights:** net / gross toggle, compare to the previous period, the same time last year or a stage
  (deltas on the headline numbers plus a by-group table), money flow (income → groups → saved), spending by
  day as month calendars with trip days hatched, and recurring payments with monthly cost and next expected
  date. Every block and day taps through to its transactions.
- **Tests:** confirming the July proposal gives 165,85 € (unit and Playwright), dismiss, pre-trip, new event
  ids, budgets set for next month keep this month's limit, stop a budget, goals, stage averages, and the
  compare-to periods (month-aligned, leap day, custom, stage).

### Decisions

- **"Leave out confirmed trips" is per budget.** SPEC §4.4 calls it a setting; `budgets.csv` already has
  `exclude_events`, while `settings.json` is not a file the app writes through its edit queue. The switch
  is in each budget's sheet.
- **Events live under More** (with a proposals badge), as SPEC §3 lists them; Home links each proposal
  straight to its sheet.
- **Proposals the ingest session wrote** (`events.csv` rows with `status=proposed`) tick every outflow in
  their date range by default, since they carry no member list.
- **Compare-to uses the part of the period that has happened:** "this month" on the 25th compares the 1st to
  the 25th with the same days of the period it is compared to.
- **Gross view:** spending counts only money out (refunds and paybacks are not netted), as DATA_MODEL §6 says.
  Saved stays the real figure, and money flow shows refunds and paybacks as money in so the flow adds up.
- **Calendar heatmap** is drawn as month grids in HTML rather than an ECharts calendar, so each day is a
  tappable link and the layout fits a 360 px screen. It shows up to the last 12 months of the period.
- **Recurring** marks a payment "may have stopped" when nothing came for a whole interval (at least two
  weeks) after it was due, and leaves it out of the monthly total.

## M3: Editing and capture (2026-11-25)

### Shipped

- **Detail sheet actions:** change category (then "Apply to all like this?"), all-like-this rule with a live
  preview of how many past transactions change, note, exclude with a reason, add to / remove from an event,
  payback for… (suggested expense first), delete a manual entry.
- **What was this cash for?** on cash withdrawals: one line pre-filled with the full amount, pick a category,
  save (3 taps). "Split" adds lines; the rest stays unitemized cash. Rows and the sheet show "€25 of €40
  itemised"; tapping again edits or removes the lines.
- **Quick add** (the + on Home and Activity): expense or income with the 8 most-used categories, date,
  account (only accounts without imports, Cash by default), note, and the current trip pre-selected. Second
  tab: balance snapshot.
- **Review inbox** (More → Review, with a badge on More): uncategorised (confirm the suggestion, pick another,
  or make a rule), who is this? (nickname + default category for unknown people), payback?, pass-through?,
  and optional cash cards (link cash logged in the week after a withdrawal, itemise, or skip). One card at a
  time; swipe left or "Later" to come back to it.
- **Settings:** accounts (tracked switch with what it means, rename, balance snapshots), categories (add,
  rename, group, kind, transfer account, icon, merge), rules (ordered list with source and hit count, move
  up/down, edit with preview, delete, add).
- **Tests:** every edit is checked against the demo data (cash AC: 15,50 € moves from Unitemized to
  Restaurants with Spent unchanged; rule preview equals what saving changes; merging categories keeps totals),
  an offline edit survives a reload and syncs later, and Playwright runs the cash, exclude, quick add and
  review flows on phone and desktop.

### Decisions

- **New rules go first.** A rule made in the app gets a priority just below the current lowest, so it wins for
  every transaction it matches (an override still wins over it). Its id is `u` + the next free number, so it
  can't clash with an ingest session's `r` rules.
- **Pattern suggestion:** the first word of the description (two if the first is 3 letters or fewer, like
  `EDP COMERCIAL`); for transfers with a person (`TFI …`, `TRF MBWAY …`) the whole description.
- **Answering a card without a "dismissed" column:** "not a payback", "not related" (pass-through) and "skip"
  (cash) save the transaction's current category as the owner's own choice (an override). That is what keeps
  the card from coming back, on every device, with no change to the data contract.
- **"Who is this?" cards** are transfers that only a generic `seed` rule categorises as people-in/people-out,
  grouped by full description and direction. Saving creates a user rule with the nickname as display name.
- **Excluding with a reason** saves the reason as the transaction's note (overrides.csv has no reason column).
- **Editing a manual entry's event** updates the manual row when it has one, otherwise the override.
- **Merging categories** moves rules, overrides, manual entries and budgets, and gives an override to
  transactions whose category only came from a suggestion (transaction files are never rewritten).
- **The app refuses to write** any file outside DATA_MODEL §2's user-owned list, as a guard in `commit()`.
- **Rule reordering** uses up/down buttons rather than drag (one hand, 44 px targets); it swaps priorities,
  or renumbers in steps of 10 when two rules share one.

## M2: Read-only app on real data (2026-11-25)

### Shipped

- **Connect and lock:** owner / repo / branch / fine-grained token with "Test connection" (refuses a public
  repo or a token without push access). The token is stored only encrypted (AES-GCM, key from the PIN via
  PBKDF2-SHA256, 600k iterations) and lives in memory while unlocked. 4–6 digit PIN pad, auto-lock after
  5 minutes in the background, "Forgot PIN" wipes the device.
- **Sync down:** Git Data API (head sha, recursive tree, changed blobs only) into IndexedDB; the app opens
  offline from the cache, then syncs on open, on focus, when back online and every 10 minutes. Sync badge
  shows synced / syncing / offline / "n changes waiting".
- **Sync up (ahead of M3):** the persisted pending-ops queue, one batched commit per flush
  (`app: <labels>` + device), and re-apply on a moved head (422/409) are in place and tested against an
  in-memory GitHub, including an ingest push racing the ref update. No screen creates edits yet.
- **Home:** month switcher (swipe or arrows), Spent with total budget and pace, Income, Saved, Balance,
  Net worth, pace chart, top categories vs 3-month average, needs attention, latest transactions.
- **Activity:** search (merchant, description, note, category or amount like `12,5`), filters (kind, group,
  category, account, event, needs review, has note), month chips, day groups, read-only detail sheet that
  says why a transaction has its category.
- **Insights:** This month / Last month / Last 3, 6, 12 months / This year / custom; spending over time by
  group (or by category within a group) with income; savings rate; where it goes (treemap plus a ranked
  list); merchants by total or visits; a table view for the time chart.
- **Import history:** coverage per account, gaps, last import, how to ingest a new statement.
- **Every total taps through:** each total opens Activity with its filter, and Activity shows the filter
  and its total.
  Tests check that every Home KPI and period total equals the sum of the transactions it opens, for every
  demo month.

### Decisions

- **Savings rate is its own small chart** under spending over time, not a second y-axis on the same chart.
- **ECharts is lazy-loaded** (its own ~670 KB chunk, cached by the service worker), so the shell loads
  first and charts show a skeleton for a moment.
- **Treemap plus a ranked list:** on a 360 px screen small treemap blocks can't hold a label, so the
  groups are also listed with share and total, each tappable.
- **Filters:** ids, dates, kinds and category ids go in the URL, so a filtered list survives a reload.
  Merchant, search text and the filter label go in `history.state` instead, because they can hold a
  description or an amount (ARCHITECTURE §7). After a reload those three are dropped and the rest stays.
- **PIN length is stored** with the connection so the lock screen unlocks as soon as enough digits are typed.
- **Charts group colours** fold groups outside the fixed eight into "Other groups" (grey).

## M0 + M1: Foundations and core engine (2026-11-25)

### Shipped

- **App shell:** Vite 7 + React 19 + TypeScript (strict) + Tailwind 4, React Router with bottom tab bar on
  the phone and a left rail from 1024 px, light/dark following the system, skeleton loading screen.
- **PWA:** `vite-plugin-pwa` (Workbox) precaches the app shell and the demo data; manifest with
  `display: standalone`, `start_url=/mealheiro/?source=pwa`, 192/512 and maskable icons. New versions show a
  "Reload" prompt instead of reloading under your fingers.
- **Strict CSP** injected into the production `index.html` (ARCHITECTURE §7), `no-referrer`.
- **Demo mode** (`/?demo=1` or "Try the demo"): `fixtures/demo-data` bundled at build time; Activity lists
  all 412 + 2 transactions grouped by day with day net totals.
- **Core (`src/core/`, pure TS):** `money` (integer cents, pt-PT formatting), `csv` (Papa Parse in, Python
  `csv.DictWriter`-identical out, unknown columns preserved), `schema` (every file in DATA_MODEL §3),
  `normalize`, `categorize` (precedence + reporting view), `recurring`, `trips` (detector + app-side
  filter), `pairs`, `aggregates` (reporting lines, monthly summary, manual-entry offset), `events`,
  `budgets` (active row, pace, projection, suggest), `goals` (balances, net worth, goal progress).
- **Parity:** `npm run test:parity` reproduces `categorized.csv`, `monthly-summary.json`,
  `recurring-keys.json` and `trips.json` **byte for byte** from `fixtures/demo-data`.
- **Unit tests** for money, CSV, normalisation, pairs (matches `mh.py pairs`), and budgets/goals against
  hand-calculated values (DATA_MODEL §9–10).
- **CI** (GitHub Actions): real-data guard, ESLint + Prettier, typecheck, unit + parity tests,
  `npm audit` of runtime deps, build, Playwright smoke test at 360×780 and 1280×800 (demo lists 414
  rows, works offline, manifest is installable), deploy to GitHub Pages on `main`.
- **Real-data guard:** `scripts/check-no-real-data.mjs` runs as a git pre-commit hook (installed by
  `npm install`) and in CI. It refuses PDFs outside `fixtures/cgd/`, spreadsheets, CSVs outside
  `fixtures/`, and IBAN-like numbers (PT IBANs, 21+ digit runs, 21+ digits in groups of four).

### Decisions

- **Toolchain versions:** Vite 7, TypeScript 5.9, Vitest 4, ESLint 9 rather than the newest majors, which
  `typescript-eslint` and `@vitejs/plugin-react` don't support yet. CI uses Node 24 (npm 11): npm 10 crashes
  resolving Vitest's optional peers.
- **Icons:** `lucide-react` (bundled, tree-shaken; the icon names in `categories.csv` are lucide names).
- **Group colours:** the validated 8-slot colour-blind-safe palette, fixed per group (Home, Food, Transport,
  Shopping, Leisure, Bills & subscriptions, Travel, Unitemized). Other groups fold into a grey "Other groups"
  in charts; categories use tints of their group's hue.
- **Demo clock:** demo mode treats 2026-10-31 (the last day of demo data) as "today" so the current month
  has numbers.
- **Manual entries and events:** `effective()` keeps mh.py's behaviour (event from overrides only, so parity
  holds), but event membership in the app also counts a manual entry's own `event_id` (Quick add sets it).
- **Budgets:** a budget row's `exclude_events=true` or `settings.budgets.exclude_confirmed_trips` excludes
  confirmed trip members. A manual cash entry's offset counts towards `unitemized-<account>` budgets (so the
  demo's September cash budget shows 60.00 − 15.50 = 44.50). State precedence: over > over pace >
  projected over > ok.
- **Goals:** "whole months" for `savings-since-start` = from the start month up to, not including, the
  current month (it is still in progress). Whole months left to a target date drop one when the target's day
  of month is before today's.
- **Gross view:** negative amounts only, but manual-entry offsets still apply (otherwise itemised cash would
  be counted twice).
- **Display money:** formatted by hand as `1.234,56 €` (SPEC); `Intl` pt-PT uses a narrow space for
  thousands.
