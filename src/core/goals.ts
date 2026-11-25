/** Balances, net worth and goals (DATA_MODEL §10). */
import { monthSummary, totalsOf, type Line } from './aggregates';
import type { DataSet } from './dataset';
import { daysBetween, monthOf, wholeMonthsBetween } from './dates';
import { parseMoney, type Cents } from './money';
import type { GoalRow } from './schema';

export interface Balance {
  accountId: string;
  balance: Cents;
  asOf: string;
  source: 'import' | 'snapshot';
}

/**
 * Last balance_after in statement order if the account has imported rows with balances, else the
 * latest balances.csv snapshot, else null (unknown).
 */
export function accountBalance(ds: DataSet, accountId: string): Balance | null {
  let found: Balance | null = null;
  for (const file of ds.txnFiles) {
    for (const r of ds.tables.get(file)!.rows) {
      if (r.account_id !== accountId || !r.balance_after) continue;
      try {
        found = { accountId, balance: parseMoney(r.balance_after), asOf: r.booking_date, source: 'import' };
      } catch {
        /* ignore malformed */
      }
    }
  }
  if (found) return found;
  for (const s of ds.balances) {
    if (s.account_id !== accountId || !s.balance) continue;
    if (found && s.date < found.asOf) continue;
    try {
      found = { accountId, balance: parseMoney(s.balance), asOf: s.date, source: 'snapshot' };
    } catch {
      /* ignore malformed */
    }
  }
  return found;
}

export interface NetWorth {
  total: Cents;
  known: Balance[];
  /** Accounts with no balance: shown as "—", excluded from net worth with a warning. */
  unknown: string[];
}

export function netWorth(ds: DataSet): NetWorth {
  const known: Balance[] = [];
  const unknown: string[] = [];
  for (const id of ds.accounts.keys()) {
    const b = accountBalance(ds, id);
    if (b) known.push(b);
    else unknown.push(id);
  }
  return { total: known.reduce((s, b) => s + b.balance, 0), known, unknown };
}

export interface GoalStatus {
  goal: GoalRow;
  value: Cents | null;
  target: Cents;
  startAmount: Cents;
  /** 0–1, clamped. */
  progress: number;
  monthsLeft: number;
  requiredPerMonth: Cents;
  /** Where the value should be today on a straight line from start to target. */
  expected: Cents;
  onTrack: boolean;
  /** For savings-since-start: the months summed (whole months from the start month, before today's month). */
  months?: string[];
}

const money = (s: string | undefined): Cents => {
  try {
    return s ? parseMoney(s) : 0;
  } catch {
    return 0;
  }
};

/**
 * savings-since-start = start_amount + Σ saved for whole months from start_date's month up to (not
 * including) the current month, which is still in progress.
 */
export function goalValue(
  ds: DataSet,
  lines: Line[],
  goal: GoalRow,
  today: string,
): { value: Cents | null; months?: string[] } {
  const basis = goal.basis;
  if (basis === 'net-worth') {
    const nw = netWorth(ds);
    return { value: nw.total };
  }
  if (basis.startsWith('account:')) {
    const b = accountBalance(ds, basis.slice('account:'.length));
    return { value: b ? b.balance : null };
  }
  if (basis === 'savings-since-start') {
    const from = monthOf(goal.start_date);
    const to = monthOf(today);
    const summary = monthSummary(lines);
    const months = Object.keys(summary).filter((m) => m >= from && m < to);
    let v = money(goal.start_amount);
    for (const m of months) v += totalsOf(m, summary[m]).saved;
    return { value: v, months };
  }
  return { value: null };
}

export function goalStatus(ds: DataSet, lines: Line[], goal: GoalRow, today: string): GoalStatus {
  const target = money(goal.target_amount);
  const startAmount = money(goal.start_amount);
  const { value, months } = goalValue(ds, lines, goal, today);
  const v = value ?? 0;
  const progress = target > 0 ? Math.min(1, Math.max(0, v / target)) : 0;
  const monthsLeft = Math.max(1, wholeMonthsBetween(today, goal.target_date));
  const requiredPerMonth = Math.round(Math.max(0, target - v) / monthsLeft);
  const total = daysBetween(goal.start_date, goal.target_date);
  const elapsed = daysBetween(goal.start_date, today);
  const share = total > 0 ? Math.min(1, Math.max(0, elapsed / total)) : 1;
  const expected = Math.round(startAmount + (target - startAmount) * share);
  return {
    goal,
    value,
    target,
    startAmount,
    progress,
    monthsLeft,
    requiredPerMonth,
    expected,
    onTrack: value !== null && v >= expected,
    months,
  };
}
