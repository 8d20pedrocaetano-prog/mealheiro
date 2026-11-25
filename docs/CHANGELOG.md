# Changelog

All notable changes to Mealheiro. Each milestone lists what shipped and any decision taken where the spec
was silent (CLAUDE.md "Working style").

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
