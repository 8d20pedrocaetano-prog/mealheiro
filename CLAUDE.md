# CLAUDE.md: Mealheiro

You are building **Mealheiro** (Portuguese for "piggy bank"): a personal spending and savings app for one person.
It runs as an installable PWA on an Android phone (Samsung Galaxy S23, Chrome) and in a desktop browser (Windows).
There is no backend. The owner's data lives as CSV files in a **private GitHub repo** (the *data repo*); the app
reads and writes those files through the GitHub REST API.

Read these before writing code, in this order:

1. `docs/SPEC.md`: what to build, screen by screen, with acceptance criteria
2. `docs/DATA_MODEL.md`: the data repo's files and every calculation rule (this is a contract)
3. `docs/ARCHITECTURE.md`: sync, auth, offline, deploy
4. `docs/ROADMAP.md`: milestones; build in this order
5. `docs/IMPORT_FORMATS.md`: bank statement formats (needed from M5)

`reference/` holds the Python reference implementation (`mh.py`, `parse_cgd.py`) used by the owner's ingest sessions.
`fixtures/` holds **synthetic** data: a fake CGD statement PDF, a demo data repo, and golden outputs.

## Non-negotiables

1. **This repo is public.** Never commit real statements, real transactions, names, account numbers, tokens or
   screenshots of real data. Everything in `fixtures/` is synthetic and must stay that way. Add a pre-commit
   check that fails if a `*.pdf` outside `fixtures/cgd/` or a file containing a 25-digit IBAN-like number is staged.
2. **No backend, no third-party services.** No analytics, no telemetry, no CDNs at runtime, no external fonts.
   The only network calls go to `api.github.com`.
3. **Money is integer cents** everywhere in TypeScript. CSV stores `-12.34` (dot, two decimals). Never sum floats.
4. **The data model is shared.** `docs/DATA_MODEL.md` + `reference/mh.py` define the file formats and the rules
   (normalisation, categorisation precedence, untracked accounts, trip detection, summaries). The TypeScript core
   must reproduce `fixtures/golden/*` from `fixtures/demo-data/` exactly (parity tests). If you need to change a
   rule or a column, change `DATA_MODEL.md`, `reference/mh.py` and the golden files in the same commit and bump
   `schema_version`.
5. **File ownership.** The app writes only user-owned files (see DATA_MODEL §2). It never rewrites existing rows in
   `transactions/**`. In-app import (M5) only appends new rows, using the same id and dedup rules as `mh.py ingest`.
6. **Never lose an edit.** Every user change goes into a persisted pending-ops queue (IndexedDB) before it touches
   the network. Show sync state honestly ("2 changes waiting to sync").
7. **Mobile first.** Design at 360×780 CSS px (S23 in Chrome) first, then widen to desktop. One-handed use:
   primary actions within thumb reach, bottom navigation, sheets instead of modals.
8. **Numbers must be trustworthy.** Every total on screen can be tapped through to the transactions behind it.

## Stack (decided; don't relitigate)

- Vite + React + TypeScript (`strict: true`), React Router
- Tailwind CSS + headless primitives (Radix) for sheets, dialogs, menus
- Apache ECharts (tree-shaken import) for charts
- Zustand for app state; plain TS modules for the domain core
- Papa Parse for CSV; `idb` for IndexedDB; `date-fns` for dates
- `vite-plugin-pwa` (Workbox) for install + offline
- Vitest for unit/parity tests; Playwright for a mobile-viewport smoke test
- ESLint + Prettier; GitHub Actions: lint, test, build, deploy to GitHub Pages
- M5 only: `pdfjs-dist` in a Web Worker for in-app PDF import

## Layout

```
src/core/      pure TS, no React/DOM: money, csv, schema, normalize, rules, categorize, effective,
               recurring, trips, pairs, aggregates, budgets, goals
src/sync/      GitHub client, local cache, pending ops, merge/retry
src/import/    (M5) CGD PDF parser, Revolut/PayPal CSV parsers
src/ui/        screens, components, charts
src/demo/      loads fixtures/demo-data in demo mode
tests/         unit + parity tests (read fixtures/), e2e/
fixtures/      given, synthetic, read-only
reference/     given, read-only Python reference
docs/
```

## Commands

`npm run dev` · `npm test` · `npm run test:parity` · `npm run build` · `npm run e2e`

**Demo mode** (`/?demo=1` or a button on the connect screen) loads `fixtures/demo-data` bundled at build time,
with writes kept in memory only. Build all UI against demo mode first; it must work with no token.

## Definition of done (every milestone)

- Lint, typecheck, unit and parity tests pass in CI; Pages deploy succeeds
- Works offline after the first load; installable (Lighthouse PWA checks pass)
- Checked at 360 px and 1280 px widths, light and dark mode; no console errors
- `docs/CHANGELOG.md` updated with what shipped and any decision you made

## Working style

- Build milestone by milestone (`docs/ROADMAP.md`). Ship small, working increments.
- When the spec is silent, choose the simplest thing that fits the principles in SPEC §1 and note it in the changelog.
- Ask the owner only about items listed under "Open questions" in SPEC §9, or when a change would break the data contract.
