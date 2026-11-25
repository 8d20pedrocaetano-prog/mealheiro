/**
 * Reporting lines and the monthly summary (DATA_MODEL §6 and §9). Mirrors month_summary in mh.py.
 *
 * Every number on screen is a sum over reporting lines, and every line points at its transaction,
 * so any total can be drilled down to the transactions behind it (SPEC principle 1).
 */
import type { Effective } from './categorize';
import { UNITEMIZED_GROUP } from './categorize';
import type { Txn } from './dataset';
import { formatMoneyCsv, type Cents } from './money';
import { isTracked, effOf, type View } from './view';

export interface Line {
  txn: Txn;
  eff: Effective;
  /** value_date month `YYYY-MM` (all analysis uses value date). */
  month: string;
  date: string;
  /** Signed contribution: negative = spending, positive = income or money back. */
  amount: Cents;
  kind: 'income' | 'expense';
  reportCategory: string;
  group: string;
  /**
   * True for the manual-entry offset: a manual expense on an untracked account itemises money that
   * was already counted as unitemized, so the opposite amount goes back to Unitemized (§6).
   */
  offset: boolean;
}

/** Lines for every transaction that is not excluded and whose reporting kind is not transfer. */
export function reportingLines(view: View): Line[] {
  const { ds } = view;
  const out: Line[] = [];
  for (const t of ds.txns) {
    const e = effOf(view, t);
    if (e.excluded || e.kind === 'transfer') continue;
    const month = t.value_date.slice(0, 7);
    out.push({
      txn: t,
      eff: e,
      month,
      date: t.value_date,
      amount: t.amount,
      kind: e.kind === 'income' ? 'income' : 'expense',
      reportCategory: e.reportCategory,
      group: e.group,
      offset: false,
    });
    if (t.manual && e.kind === 'expense' && !isTracked(ds, t.account_id)) {
      out.push({
        txn: t,
        eff: e,
        month,
        date: t.value_date,
        amount: -t.amount,
        kind: 'expense',
        reportCategory: 'unitemized-' + t.account_id,
        group: UNITEMIZED_GROUP,
        offset: true,
      });
    }
  }
  return out;
}

export type MonthBuckets = Record<string, Cents>;

/** `{ "2026-01": { "spend:Food": -69770, "income": 189000, ... } }`, months sorted. */
export function monthSummary(lines: Line[]): Record<string, MonthBuckets> {
  const agg = new Map<string, MonthBuckets>();
  for (const l of lines) {
    let m = agg.get(l.month);
    if (!m) agg.set(l.month, (m = {}));
    const key = l.kind === 'income' ? 'income' : 'spend:' + l.group;
    m[key] = (m[key] ?? 0) + l.amount;
  }
  const out: Record<string, MonthBuckets> = {};
  for (const k of [...agg.keys()].sort()) out[k] = agg.get(k)!;
  return out;
}

/** The golden-file form: amounts as strings with two decimals. */
export function monthSummaryJson(s: Record<string, MonthBuckets>): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [ym, m] of Object.entries(s)) {
    out[ym] = {};
    for (const [k, v] of Object.entries(m)) out[ym][k] = formatMoneyCsv(v);
  }
  return out;
}

export interface MonthTotals {
  month: string;
  income: Cents;
  /** Positive number: −Σ spend groups. */
  spent: Cents;
  saved: Cents;
  /** saved / income, null when income is 0. */
  savingsRate: number | null;
}

export function totalsOf(month: string, b: MonthBuckets | undefined): MonthTotals {
  let income = 0;
  let spend = 0;
  for (const [k, v] of Object.entries(b ?? {})) {
    if (k === 'income') income += v;
    else if (k.startsWith('spend:')) spend += v;
  }
  const spent = -spend;
  const saved = income - spent;
  return { month, income, spent, saved, savingsRate: income !== 0 ? saved / income : null };
}

/** Filters for drill-down and totals. */
export interface LineFilter {
  from?: string;
  to?: string;
  months?: Set<string>;
  kind?: 'income' | 'expense';
  group?: string;
  reportCategory?: string;
  eventIds?: Set<string>;
  excludeTxnIds?: Set<string>;
}

export function filterLines(lines: Line[], f: LineFilter): Line[] {
  return lines.filter(
    (l) =>
      (!f.from || l.date >= f.from) &&
      (!f.to || l.date <= f.to) &&
      (!f.months || f.months.has(l.month)) &&
      (!f.kind || l.kind === f.kind) &&
      (!f.group || l.group === f.group) &&
      (!f.reportCategory || l.reportCategory === f.reportCategory) &&
      (!f.excludeTxnIds || !f.excludeTxnIds.has(l.txn.id)),
  );
}

export function sumLines(lines: Line[]): Cents {
  let t = 0;
  for (const l of lines) t += l.amount;
  return t;
}

/** Net spending of expense lines as a positive number (refunds and paybacks reduce it). */
export function netSpent(lines: Line[]): Cents {
  let t = 0;
  for (const l of lines) if (l.kind === 'expense') t -= l.amount;
  return t;
}

/**
 * Gross spending (SPEC §4.3): negative amounts only, so refunds and paybacks are not netted. Manual
 * offsets still apply (they are not refunds; without them cash would be counted twice).
 */
export function isGrossLine(l: Line): boolean {
  return l.kind === 'expense' && (l.offset || l.amount < 0);
}

export function grossSpent(lines: Line[]): Cents {
  let t = 0;
  for (const l of lines) if (isGrossLine(l)) t -= l.amount;
  return t;
}

export function groupBy<K>(lines: Line[], key: (l: Line) => K): Map<K, Line[]> {
  const m = new Map<K, Line[]>();
  for (const l of lines) {
    const k = key(l);
    let a = m.get(k);
    if (!a) m.set(k, (a = []));
    a.push(l);
  }
  return m;
}
