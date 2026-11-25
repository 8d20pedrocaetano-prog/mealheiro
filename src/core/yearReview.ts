/**
 * Year in review (M6): one calendar year at a glance, from the same month summary as Home (DATA_MODEL §9),
 * so every figure here matches the months it is made of. Only months that have transactions count, and the
 * comparison with the year before is like for like (the same months, all with data) or not shown at all.
 */
import { totalsOf, type Line, type MonthTotals } from './aggregates';
import { addMonths, lastDay } from './dates';
import { tripSummary } from './eventStats';
import { isTripType } from './events';
import { merchantStats, type MerchantStat } from './insights';
import type { Model } from './model';
import type { Cents } from './money';
import { merchantKey } from './normalize';
import type { EventRow } from './schema';

export interface YearTotals {
  income: Cents;
  spent: Cents;
  saved: Cents;
  /** saved / income; null without income. */
  rate: number | null;
}

export interface YearReview {
  year: string;
  /** Months of the year that have transactions, oldest first. */
  months: MonthTotals[];
  /** First and last day covered (the last is today in the current year). */
  from: string;
  to: string;
  /** Fewer than 12 months (a year still running, or data that starts mid-year). */
  partial: boolean;
  totals: YearTotals;
  /** The same months one year earlier, when every one of them has data. */
  prev: (YearTotals & { from: string; to: string }) | null;
  /** Most and least saved month (with two months or more). */
  best: MonthTotals | null;
  worst: MonthTotals | null;
  groups: { group: string; spent: Cents; prev: Cents | null }[];
  merchants: MerchantStat[];
  trips: { event: EventRow; total: Cents; days: number }[];
  /** The five biggest one-off expenses (merchants that don't recur). */
  biggest: Line[];
}

function sum(ms: MonthTotals[]): YearTotals {
  const income = ms.reduce((s, x) => s + x.income, 0);
  const spent = ms.reduce((s, x) => s + x.spent, 0);
  const saved = income - spent;
  return { income, spent, saved, rate: income !== 0 ? saved / income : null };
}

function groupSpend(m: Model, months: string[]): Map<string, Cents> {
  const out = new Map<string, Cents>();
  for (const ym of months)
    for (const [k, v] of Object.entries(m.summary[ym] ?? {}))
      if (k.startsWith('spend:')) out.set(k.slice(6), (out.get(k.slice(6)) ?? 0) - v);
  return out;
}

/** Years with any transaction, newest first. */
export function reviewYears(m: Model): string[] {
  return [...new Set(m.months.map((ym) => ym.slice(0, 4)))].sort().reverse();
}

export function yearReview(m: Model, year: string): YearReview {
  const have = new Set(m.months);
  const yms = m.months.filter((ym) => ym.startsWith(year + '-') && ym <= m.today.slice(0, 7));
  const months = yms.map((ym) => totalsOf(ym, m.summary[ym]));
  const from = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const to = yearEnd < m.today ? yearEnd : m.today;

  const prevMonths = yms.map((ym) => addMonths(ym, -12));
  const prevOk = prevMonths.length > 0 && prevMonths.every((ym) => have.has(ym));
  const prev = prevOk
    ? {
        ...sum(prevMonths.map((ym) => totalsOf(ym, m.summary[ym]))),
        from: `${prevMonths[0]}-01`,
        to: lastDay(prevMonths[prevMonths.length - 1]),
      }
    : null;

  let best: MonthTotals | null = null;
  let worst: MonthTotals | null = null;
  if (months.length >= 2) {
    for (const x of months) {
      if (!best || x.saved > best.saved) best = x;
      if (!worst || x.saved < worst.saved) worst = x;
    }
  }

  const now = groupSpend(m, yms);
  const before = prevOk ? groupSpend(m, prevMonths) : null;
  const groups = [...new Set([...now.keys(), ...(before?.keys() ?? [])])]
    .map((group) => ({ group, spent: now.get(group) ?? 0, prev: before ? (before.get(group) ?? 0) : null }))
    .filter((g) => g.spent !== 0 || (g.prev ?? 0) !== 0)
    .sort((a, b) => b.spent - a.spent);

  const merchants = merchantStats(m.lines, from, to)
    .filter((s) => s.spent > 0)
    .sort((a, b) => b.spent - a.spent)
    .slice(0, 10);

  const trips = m.ds.events
    .filter((e) => isTripType(e) && e.status === 'confirmed' && e.start_date.startsWith(year))
    .sort((a, b) => (a.start_date < b.start_date ? -1 : 1))
    .map((event) => {
      const s = tripSummary(m, event);
      return { event, total: s.total, days: s.days };
    });

  // One-offs: rent, bills and the weekly shop (merchants seen in 3+ months) would fill this list otherwise.
  const biggest = m.lines
    .filter(
      (l) =>
        l.kind === 'expense' &&
        !l.offset &&
        l.amount < 0 &&
        l.date >= from &&
        l.date <= to &&
        !m.recurring.has(merchantKey(l.txn.descNorm)),
    )
    .sort((a, b) => a.amount - b.amount)
    .slice(0, 5);

  return {
    year,
    months,
    from,
    to,
    partial: months.length < 12,
    totals: sum(months),
    prev,
    best,
    worst,
    groups,
    merchants,
    trips,
    biggest,
  };
}
