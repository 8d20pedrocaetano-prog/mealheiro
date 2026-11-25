# Changelog

All notable changes to Mealheiro. Each milestone lists what shipped and any decision taken where the spec
was silent (CLAUDE.md "Working style").

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
