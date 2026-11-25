/** Budget progress, pace and projection (DATA_MODEL §9, SPEC §4.4). */
import { filterLines, netSpent, type Line } from './aggregates';
import { addMonths, daysInMonth, monthOf } from './dates';
import { confirmedTripMemberIds } from './events';
import { parseMoney, type Cents } from './money';
import { isTrue, type BudgetRow } from './schema';
import type { View } from './view';

export type BudgetState = 'ok' | 'over-pace' | 'projected-over' | 'over';

export interface BudgetStatus {
  row: BudgetRow;
  month: string;
  limit: Cents;
  spent: Cents;
  left: Cents;
  /** Where spending "should" be today on a straight line (limit × day / days_in_month). */
  pace: Cents;
  /** Projected month-end spend (current month); equals spent for past months. */
  projected: Cents;
  state: BudgetState;
  /** The lines behind `spent`, for drill-down. */
  lines: Line[];
}

/** Active row per (scope, target) for month M: latest start_month ≤ M with end_month empty or ≥ M. */
export function activeBudgets(rows: BudgetRow[], month: string): BudgetRow[] {
  const best = new Map<string, BudgetRow>();
  for (const r of rows) {
    if (!r.start_month || r.start_month > month) continue;
    if (r.end_month && r.end_month < month) continue;
    const k = `${r.scope}\u0000${r.target}`;
    const cur = best.get(k);
    if (!cur || r.start_month >= cur.start_month) best.set(k, r);
  }
  return [...best.values()];
}

export function budgetExcludesTrips(view: View, row: BudgetRow): boolean {
  return isTrue(row.exclude_events) || view.ds.settings.budgets?.exclude_confirmed_trips === true;
}

/** Expense lines in `month` that count towards a budget row. */
export function budgetLines(
  view: View,
  lines: Line[],
  row: BudgetRow,
  month: string,
  tripMembers?: Set<string>,
): Line[] {
  const exclude = budgetExcludesTrips(view, row) ? (tripMembers ?? confirmedTripMemberIds(view)) : undefined;
  const base = filterLines(lines, { months: new Set([month]), kind: 'expense', excludeTxnIds: exclude });
  if (row.scope === 'category') return base.filter((l) => l.reportCategory === row.target);
  if (row.scope === 'group') return base.filter((l) => l.group === row.target);
  return base; // total: all expense
}

export function budgetSpent(
  view: View,
  lines: Line[],
  row: BudgetRow,
  month: string,
  tripMembers?: Set<string>,
): Cents {
  return netSpent(budgetLines(view, lines, row, month, tripMembers));
}

/**
 * Status of every active budget in `month`, as seen on `today`.
 * - Past month: pace = limit, projection = spent.
 * - Current month: pace = limit × day / days; projection = spent / day × days once 7+ days have
 *   elapsed, else max(spent, trailing 3-month average).
 * - Future month: pace 0, projection = spent.
 */
export function budgetStatuses(view: View, lines: Line[], month: string, today: string): BudgetStatus[] {
  const tripMembers = confirmedTripMemberIds(view);
  const dim = daysInMonth(month);
  const curMonth = monthOf(today);
  const out: BudgetStatus[] = [];
  for (const row of activeBudgets(view.ds.budgets, month)) {
    let limit = 0;
    try {
      limit = parseMoney(row.monthly_limit);
    } catch {
      continue;
    }
    const bl = budgetLines(view, lines, row, month, tripMembers);
    const spent = netSpent(bl);
    let pace: Cents;
    let projected: Cents;
    if (month < curMonth) {
      pace = limit;
      projected = spent;
    } else if (month > curMonth) {
      pace = 0;
      projected = spent;
    } else {
      const day = Number(today.slice(8, 10));
      pace = Math.round((limit * day) / dim);
      if (day >= 7) {
        projected = Math.round((spent / day) * dim);
      } else {
        projected = Math.max(spent, trailingAverage(view, lines, row, month, 3, tripMembers));
      }
    }
    let state: BudgetState = 'ok';
    if (spent > limit) state = 'over';
    else if (month === curMonth && spent > pace) state = 'over-pace';
    else if (month === curMonth && projected > limit) state = 'projected-over';
    out.push({ row, month, limit, spent, left: limit - spent, pace, projected, state, lines: bl });
  }
  return out;
}

/** Average net spend over the `n` months before `month` (rounded to the cent). */
export function trailingAverage(
  view: View,
  lines: Line[],
  row: BudgetRow,
  month: string,
  n: number,
  tripMembers?: Set<string>,
): Cents {
  let total = 0;
  for (let i = 1; i <= n; i++) total += budgetSpent(view, lines, row, addMonths(month, -i), tripMembers);
  return Math.round(total / n);
}

/** "Suggest budgets": trailing 6-month average rounded up to €5 (SPEC §4.4). */
export function suggestLimit(
  view: View,
  lines: Line[],
  row: BudgetRow,
  month: string,
  tripMembers?: Set<string>,
): Cents {
  const avg = trailingAverage(view, lines, row, month, 6, tripMembers);
  if (avg <= 0) return 0;
  return Math.ceil(avg / 500) * 500;
}
