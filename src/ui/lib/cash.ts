/** How much of each cash withdrawal has been itemised (SPEC §4.2 "€25 of €40 itemised"), once per model. */
import type { Model } from '../../core/model';
import type { Cents } from '../../core/money';

const cache = new WeakMap<Model, Map<string, Cents>>();

export function itemisedSums(m: Model): Map<string, Cents> {
  let sums = cache.get(m);
  if (!sums) {
    sums = new Map();
    for (const t of m.ds.txns) {
      const w = t.manual?.linked_txn_id;
      if (w) sums.set(w, (sums.get(w) ?? 0) - t.amount);
    }
    cache.set(m, sums);
  }
  return sums;
}
