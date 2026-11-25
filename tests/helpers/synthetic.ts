/**
 * A synthetic 10-year data repo for the performance pass (SPEC §7: design for 10 years × 1,000
 * transactions). It reuses the demo's accounts, categories, rules and descriptions, so every rule path
 * is exercised; amounts and dates are generated, and the balance chain holds.
 */
import { parseCsv, serializeCsv, type Row } from '../../src/core/csv';
import { formatMoneyCsv } from '../../src/core/money';
import { loadDemoFiles } from './fixtures';

export function syntheticRepo(years = 10, perYear = 1000): Record<string, string> {
  const demo = loadDemoFiles();
  const files: Record<string, string> = {};
  for (const [k, v] of Object.entries(demo)) if (!k.startsWith('transactions/')) files[k] = v;
  const sample = Object.entries(demo)
    .filter(([k]) => k.startsWith('transactions/'))
    .flatMap(([, v]) => parseCsv(v).rows);
  const header = parseCsv(demo['transactions/2026/2026-01.csv']).header;
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  let balance = 500000;
  const startYear = 2026 - years + 1;
  const byMonth = new Map<string, Row[]>();
  let n = 0;
  for (let y = startYear; y <= 2026; y++) {
    for (let i = 0; i < perYear; i++) {
      const s = sample[Math.floor(rnd() * sample.length)];
      const day = Math.floor((i / perYear) * 365);
      const d = new Date(Date.UTC(y, 0, 1 + day)).toISOString().slice(0, 10);
      const amount = Math.round(Number(s.amount) * 100 * (0.6 + rnd() * 0.8));
      balance += amount;
      const ym = d.slice(0, 7);
      const row: Row = {
        ...s,
        id: (n++).toString(16).padStart(16, '0'),
        booking_date: d,
        value_date: d,
        amount: formatMoneyCsv(amount),
        balance_after: formatMoneyCsv(balance),
      };
      let a = byMonth.get(ym);
      if (!a) byMonth.set(ym, (a = []));
      a.push(row);
    }
  }
  for (const [ym, rows] of byMonth)
    files[`transactions/${ym.slice(0, 4)}/${ym}.csv`] = serializeCsv(header, rows);
  // the owner's decisions grow with the data: some overrides on old rows
  const ov = parseCsv(demo['overrides.csv']);
  const extra: Row[] = [];
  for (let k = 0; k < 600; k++) {
    extra.push({
      txn_id: (k * 13).toString(16).padStart(16, '0'),
      category_id: 'groceries',
      event_id: '',
      note: 'x',
      excluded: '',
      reimburses_txn_id: '',
      updated_at: '2026-01-01T00:00:00',
    });
  }
  files['overrides.csv'] = serializeCsv(ov.header, [...ov.rows, ...extra]);
  return files;
}
