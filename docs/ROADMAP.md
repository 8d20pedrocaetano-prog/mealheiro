# Roadmap

Build in order. Each milestone ends deployable, with its checks green.

## M0: Foundations

- Vite/React/TS app, Tailwind, router, bottom nav shell, light/dark, PWA manifest + service worker.
- CI: lint, typecheck, tests, build, deploy to GitHub Pages. Pre-commit guard against real data.
- `src/core/money.ts` (cents), `csv.ts` (parse/serialise, preserves unknown columns), `schema.ts` (typed rows
  for every file in DATA_MODEL §3).
- Demo mode loads `fixtures/demo-data`.
- **Done when:** the deployed site installs on Android, opens offline, and demo mode lists all 412 + 2 transactions.

## M1: Core engine with parity

- Port `reference/mh.py`: normalise, rules, categorise, effective/reporting view, recurring keys, trip
  detection, payback/pass-through pairing, monthly summary, manual-entry offset.
- Parity tests: `fixtures/golden/categorized.csv`, `trips.json`, `monthly-summary.json`, `recurring-keys.json`
  must match exactly from `fixtures/demo-data`.
- Unit tests for budgets and goals (DATA_MODEL §9–10) with hand-calculated expectations.
- **Done when:** `npm run test:parity` is green.

## M2: Read-only app on real data

- Connect screen (owner/repo/branch/token, test), PIN lock, encrypted token storage.
- Sync down (trees + blobs + cache), sync status indicator.
- Home (KPIs, budget pace, top categories, needs attention), Activity (list, search, filters, detail sheet
  read-only), Insights (spending over time, where it goes, merchants), Import history.
- **Done when:** the owner can open the app on the phone and laptop, see their real data, and every Home KPI drills
  down to its transactions.

## M3: Editing and capture

- Pending-ops queue, batched commits, conflict retry (ARCHITECTURE §4).
- Detail sheet actions: recategorise, "apply to all like this" (rule with preview), note, exclude, payback link,
  "What was this cash for?" on cash withdrawals.
- Review inbox (all card types except events), Quick add (expense/income + balance snapshot, cash linking).
- Settings: accounts (tracked toggle), categories, rules (order, test, hit count).
- **Done when:** the owner clears the first-import review inbox on the phone, offline edits sync later, and a
  concurrent push from an ingest session doesn't lose anything.

## M4: Events, budgets, goals

- Trip proposals (detector + session-proposed), proposal sheet (rename, dates, tick/untick, pre-trip, type,
  budget), confirm/dismiss, trip page, stages, tags, stage compare.
- Budgets (progress, pace, projection, suggest from averages, edit from month), goals (progress, required monthly,
  on-track), Plan tab.
- Insights additions: Sankey, calendar heatmap with trips, recurring panel, compare-to, gross/net.
- **Done when:** the owner's proposed trips can be confirmed with correct totals, and next month's budgets are set.

## M5: In-app import

- CGD PDF import in a Web Worker with `pdfjs-dist`, preview, commit; Android share target.
- Revolut CSV import; PayPal CSV enrichment.
- **Done when:** importing `fixtures/cgd/synthetic-statement.pdf` in the app matches `expected.csv` and the
  owner imports a real statement from the phone without an ingest session.

## M6: Polish

- Year in review, CSV/ZIP export, accessibility pass (table view for every chart), performance pass on a
  synthetic 10-year dataset, empty states and onboarding hints.
