/** Recurring payments (DATA_MODEL §8). */
import type { Cents } from './money';
import type { DataSet, Txn } from './dataset';
import { addDays, dayNum } from './dates';
import { merchantKey } from './normalize';

/** merchant_keys of outflows that occur in at least `minMonths` distinct calendar months. */
export function recurringKeys(ds: DataSet, minMonths = 3): Set<string> {
  const seen = new Map<string, Set<string>>();
  for (const t of ds.txns) {
    if (t.amount < 0) {
      const k = merchantKey(t.descNorm);
      let s = seen.get(k);
      if (!s) seen.set(k, (s = new Set()));
      s.add(t.value_date.slice(0, 7));
    }
  }
  const out = new Set<string>();
  for (const [k, months] of seen) if (months.size >= minMonths) out.add(k);
  return out;
}

export interface RecurringItem {
  key: string;
  txns: Txn[];
  months: number;
  /** Median days between consecutive payments. */
  intervalDays: number;
  /** Median outflow (positive cents). */
  typical: Cents;
  /** Typical amount normalised to a month: typical × 30.44 / interval. */
  monthlyCost: Cents;
  last: string;
  nextExpected: string;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/** App-only details for the Recurring panel (not part of parity). */
export function recurringDetails(ds: DataSet, keys: Set<string> = recurringKeys(ds)): RecurringItem[] {
  const by = new Map<string, Txn[]>();
  for (const t of ds.txns) {
    if (t.amount >= 0) continue;
    const k = merchantKey(t.descNorm);
    if (!keys.has(k)) continue;
    let a = by.get(k);
    if (!a) by.set(k, (a = []));
    a.push(t);
  }
  const out: RecurringItem[] = [];
  for (const [key, txns] of by) {
    const days = [...new Set(txns.map((t) => t.value_date))].sort();
    const gaps: number[] = [];
    for (let i = 1; i < days.length; i++) gaps.push(dayNum(days[i]) - dayNum(days[i - 1]));
    const intervalDays = Math.max(1, median(gaps));
    const typical = median(txns.map((t) => -t.amount));
    const last = days[days.length - 1];
    out.push({
      key,
      txns,
      months: new Set(txns.map((t) => t.value_date.slice(0, 7))).size,
      intervalDays,
      typical,
      monthlyCost: Math.round((typical * 30.44) / intervalDays),
      last,
      nextExpected: addDays(last, intervalDays),
    });
  }
  return out.sort((a, b) => b.monthlyCost - a.monthlyCost);
}
