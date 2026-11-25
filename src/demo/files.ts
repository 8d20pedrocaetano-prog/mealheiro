/**
 * Demo data: fixtures/demo-data bundled at build time (synthetic, see fixtures/). Imported lazily so it
 * is its own chunk; the service worker precaches it, so demo mode works offline.
 */
import type { FileMap } from '../core/dataset';

const raw = import.meta.glob('/fixtures/demo-data/**/*.{csv,json}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export const demoFiles: FileMap = Object.fromEntries(
  Object.entries(raw).map(([path, text]) => [path.replace('/fixtures/demo-data/', ''), text]),
);

/** The demo clock: the last day with demo data, so "this month" has numbers. */
export const DEMO_TODAY = '2026-10-31';

/** Files the owner fills in over time; a fresh data repo has only their header row. */
const OWNER_FILLED = [
  'imports.csv',
  'overrides.csv',
  'manual.csv',
  'events.csv',
  'budgets.csv',
  'goals.csv',
  'balances.csv',
];

/** A fresh data repo: accounts, categories, rules and settings, and no transactions yet. */
export function emptyDemoFiles(): FileMap {
  const out: FileMap = {};
  for (const [path, text] of Object.entries(demoFiles)) {
    if (path.startsWith('transactions/')) continue;
    out[path] = OWNER_FILLED.includes(path) ? text.slice(0, text.indexOf('\n') + 1) : text;
  }
  return out;
}
