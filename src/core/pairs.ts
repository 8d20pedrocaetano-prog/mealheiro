/** Payback and pass-through suggestions (DATA_MODEL §12). Mirrors cmd_pairs in mh.py. */
import type { DataSet, Txn } from './dataset';
import { daysBetween } from './dates';
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
  const ins = txns.filter((t) => t.amount > 0 && cat(t) === 'people-in');
  const out: PairSuggestion[] = [];
  for (const t of ins) {
    const amt = t.amount;
    const exact = txns.find(
      (o) => o.amount === -amt && Math.abs(daysBetween(t.value_date, o.value_date)) <= 1,
    );
    if (exact) {
      out.push({ type: 'pass-through', incoming: t, other: exact });
      continue;
    }
    let best: Txn | null = null;
    for (const o of txns) {
      // o.amount ≤ −1.5 × amt, in integer cents: 2·o ≤ −3·amt
      if (!(2 * o.amount <= -3 * amt)) continue;
      const d = daysBetween(o.value_date, t.value_date);
      if (d < 0 || d > 3) continue;
      if (!PAYBACK_TARGET_CATEGORIES.has(cat(o))) continue;
      if (best === null || -o.amount > -best.amount) best = o;
    }
    if (best) out.push({ type: 'payback', incoming: t, other: best });
  }
  return out;
}
