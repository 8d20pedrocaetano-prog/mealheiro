/** Payback and pass-through suggestions (DATA_MODEL §12). Mirrors cmd_pairs in mh.py. */
import type { DataSet, Txn } from './dataset';
import { dayNum } from './dates';
import { buildView, effOf, type View } from './view';

export const PAYBACK_TARGET_CATEGORIES = new Set([
  'restaurants',
  'bars-nightlife',
  'entertainment',
  'groceries',
  'delivery',
  'travel-other',
  'accommodation',
  'people-out',
  'online-shopping',
]);

export interface PairSuggestion {
  type: 'pass-through' | 'payback';
  /** The incoming people-in transaction. */
  incoming: Txn;
  /** The outflow it matches. */
  other: Txn;
}

export function suggestPairs(ds: DataSet, view: View = buildView(ds)): PairSuggestion[] {
  const txns = ds.txns.filter((t) => !t.manual);
  const cat = (t: Txn) => effOf(view, t).categoryId;
  // Index by day so each incoming row looks at a few days, not the whole history (10 years × 1,000
  // rows, SPEC §7). Same answers as the full scan: "first" means lowest position in `txns`.
  const day = new Map<Txn, number>();
  const byDay = new Map<number, number[]>();
  txns.forEach((t, i) => {
    const d = dayNum(t.value_date);
    day.set(t, d);
    let a = byDay.get(d);
    if (!a) byDay.set(d, (a = []));
    a.push(i);
  });
  const within = (from: number, to: number) => {
    const idx: number[] = [];
    for (let d = from; d <= to; d++) idx.push(...(byDay.get(d) ?? []));
    return idx.sort((a, b) => a - b).map((i) => txns[i]);
  };
  const ins = txns.filter((t) => t.amount > 0 && cat(t) === 'people-in');
  const out: PairSuggestion[] = [];
  for (const t of ins) {
    const amt = t.amount;
    const d = day.get(t)!;
    const exact = within(d - 1, d + 1).find((o) => o.amount === -amt);
    if (exact) {
      out.push({ type: 'pass-through', incoming: t, other: exact });
      continue;
    }
    let best: Txn | null = null;
    for (const o of within(d - 3, d)) {
      // o.amount ≤ −1.5 × amt, in integer cents: 2·o ≤ −3·amt
      if (!(2 * o.amount <= -3 * amt)) continue;
      if (!PAYBACK_TARGET_CATEGORIES.has(cat(o))) continue;
      if (best === null || -o.amount > -best.amount) best = o;
    }
    if (best) out.push({ type: 'payback', incoming: t, other: best });
  }
  return out;
}
