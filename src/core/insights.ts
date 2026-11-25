/** Aggregations behind Home and Insights. Pure functions over reporting lines (DATA_MODEL §9). */
import { netSpent, type Line } from './aggregates';
import { addMonths, daysInMonth, dayNum, monthRange } from './dates';
import type { Cents } from './money';

/** Cumulative net spend per day of `month` (index 0 = day 1). */
export function cumulativeByDay(lines: Line[], month: string): Cents[] {
  const dim = daysInMonth(month);
  const perDay = new Array<Cents>(dim).fill(0);
  for (const l of lines) {
    if (l.month !== month || l.kind !== 'expense') continue;
    perDay[Number(l.date.slice(8, 10)) - 1] -= l.amount;
  }
  let run = 0;
  return perDay.map((v) => (run += v));
}

export interface CategoryTotal {
  key: string;
  spent: Cents;
  /** Average over the 3 months before. */
  avg3: Cents;
  lines: Line[];
}

/** Net spend per key in a month, with the trailing 3-month average for comparison. */
export function totalsBy(lines: Line[], month: string, key: (l: Line) => string): CategoryTotal[] {
  const prev = new Set([1, 2, 3].map((i) => addMonths(month, -i)));
  const cur = new Map<string, Line[]>();
  const before = new Map<string, Cents>();
  for (const l of lines) {
    if (l.kind !== 'expense') continue;
    const k = key(l);
    if (l.month === month) {
      let a = cur.get(k);
      if (!a) cur.set(k, (a = []));
      a.push(l);
    } else if (prev.has(l.month)) {
      before.set(k, (before.get(k) ?? 0) - l.amount);
    }
  }
  return [...cur.entries()]
    .map(([k, ls]) => ({
      key: k,
      spent: netSpent(ls),
      avg3: Math.round((before.get(k) ?? 0) / 3),
      lines: ls,
    }))
    .sort((a, b) => b.spent - a.spent);
}

export interface PeriodMonth {
  month: string;
  income: Cents;
  spent: Cents;
  saved: Cents;
  byGroup: Map<string, Cents>;
}

/** Month by month income / spent / saved and spend by group for a list of months. */
export function monthlySeries(
  lines: Line[],
  months: string[],
  groupOf: (l: Line) => string = (l) => l.group,
): PeriodMonth[] {
  const idx = new Map(months.map((m, i) => [m, i]));
  const out: PeriodMonth[] = months.map((month) => ({
    month,
    income: 0,
    spent: 0,
    saved: 0,
    byGroup: new Map(),
  }));
  for (const l of lines) {
    const i = idx.get(l.month);
    if (i === undefined) continue;
    const pm = out[i];
    if (l.kind === 'income') pm.income += l.amount;
    else {
      pm.spent -= l.amount;
      const g = groupOf(l);
      pm.byGroup.set(g, (pm.byGroup.get(g) ?? 0) - l.amount);
    }
  }
  for (const pm of out) pm.saved = pm.income - pm.spent;
  return out;
}

export interface MerchantStat {
  merchant: string;
  spent: Cents;
  count: number;
  /** Visits per month over the period. */
  perMonth: number;
  group: string;
}

export function merchantStats(lines: Line[], from: string, to: string): MerchantStat[] {
  const months = Math.max(1, monthRange(from.slice(0, 7), to.slice(0, 7)).length);
  const by = new Map<string, { spent: Cents; ids: Set<string>; group: string }>();
  for (const l of lines) {
    if (l.kind !== 'expense' || l.offset || l.date < from || l.date > to) continue;
    const k = l.eff.merchant;
    let s = by.get(k);
    if (!s) by.set(k, (s = { spent: 0, ids: new Set(), group: l.group }));
    s.spent -= l.amount;
    if (l.amount < 0) s.ids.add(l.txn.id);
  }
  return [...by.entries()].map(([merchant, s]) => ({
    merchant,
    spent: s.spent,
    count: s.ids.size,
    perMonth: s.ids.size / months,
    group: s.group,
  }));
}

/** Net spend per day in [from, to] (for the calendar heatmap). */
export function dailySpend(lines: Line[], from: string, to: string): Map<string, Cents> {
  const out = new Map<string, Cents>();
  for (const l of lines) {
    if (l.kind !== 'expense' || l.date < from || l.date > to) continue;
    out.set(l.date, (out.get(l.date) ?? 0) - l.amount);
  }
  return out;
}

export function daysSince(from: string, to: string): number {
  return dayNum(to) - dayNum(from);
}
