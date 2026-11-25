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
