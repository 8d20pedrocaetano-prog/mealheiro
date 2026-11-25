/**
 * Budgets and goals (DATA_MODEL §9–10) against hand-calculated values for the demo data.
 * The expected figures were worked out independently from fixtures/golden/categorized.csv and the raw
 * amounts (see the arithmetic in each comment), not by running this code.
 */
import { describe, expect, it } from 'vitest';
import { reportingLines } from '../../src/core/aggregates';
import { activeBudgets, budgetStatuses, suggestLimit } from '../../src/core/budgets';
import { loadDataSet } from '../../src/core/dataset';
import { wholeMonthsBetween } from '../../src/core/dates';
import { accountBalance, goalStatus, netWorth } from '../../src/core/goals';
import type { BudgetRow } from '../../src/core/schema';
import { buildView } from '../../src/core/view';
import { loadDemoFiles } from '../helpers/fixtures';

const ds = loadDataSet(loadDemoFiles());
const view = buildView(ds);
const lines = reportingLines(view);

const byId = (month: string, today: string) =>
  Object.fromEntries(budgetStatuses(view, lines, month, today).map((s) => [s.row.id, s]));

describe('budgets (DATA_MODEL §9)', () => {
  it('picks the active row per (scope, target)', () => {
    const rows = [
      {
        id: 'a',
        scope: 'category',
        target: 'groceries',
        monthly_limit: '200',
        start_month: '2026-01',
        end_month: '',
      },
      {
        id: 'b',
        scope: 'category',
        target: 'groceries',
        monthly_limit: '300',
        start_month: '2026-06',
        end_month: '',
      },
      {
        id: 'c',
        scope: 'category',
        target: 'fuel',
        monthly_limit: '50',
        start_month: '2026-01',
        end_month: '2026-03',
      },
    ] as BudgetRow[];
    expect(activeBudgets(rows, '2026-05').map((r) => r.id)).toEqual(['a']);
    expect(activeBudgets(rows, '2026-06').map((r) => r.id)).toEqual(['b']);
    expect(
      activeBudgets(rows, '2026-02')
        .map((r) => r.id)
        .sort(),
    ).toEqual(['a', 'c']);
  });

  it('October 2026 seen from November (past month)', () => {
    const s = byId('2026-10', '2026-11-25');
    // groceries: 22 rows in Oct, net 479.43 > 260 → over
    expect(s.b01.spent).toBe(47943);
    expect(s.b01.state).toBe('over');
    expect(s.b02.spent).toBe(33669); // restaurants 336.69 (no paybacks linked in Oct)
    expect(s.b03.spent).toBe(3885); // cafés 38.85 of 40 → 1.15 left
    expect(s.b03.left).toBe(115);
    expect(s.b03.state).toBe('ok');
    expect(s.b04.spent).toBe(9572); // Transport group: fuel + tolls + parking… 95.72
    expect(s.b05.spent).toBe(4000); // unitemized-cash: one 40.00 withdrawal
    expect(s.b06.spent).toBe(173494); // total = golden spent for 2026-10
    expect(s.b06.pace).toBe(150000);
    expect(s.b06.projected).toBe(173494);
  });

  it('a manual cash entry moves money out of unitemized-cash (Sep: 60.00 − 15.50 = 44.50)', () => {
    expect(byId('2026-09', '2026-11-25').b05.spent).toBe(4450);
  });

  it('exclude_events drops confirmed trip members (April: 1639.58 − Edinburgh 298.50 = 1341.08)', () => {
    const s = byId('2026-04', '2026-11-25');
    expect(s.b06.spent).toBe(134108);
    expect(s.b06.state).toBe('ok');
  });

  it('pace and projection in the current month after 7 days', () => {
    // today 10 Oct: cafés pace = 40.00 × 10 / 31 = 12.90; projection = 38.85 / 10 × 31 = 120.435 → 120.44
    const s = byId('2026-10', '2026-10-10').b03;
    expect(s.pace).toBe(1290);
    expect(s.projected).toBe(12044);
    expect(s.state).toBe('over-pace');
  });

  it('projection before day 7 uses max(spent, trailing 3-month average)', () => {
    // unitemized-cash Jul 0 + Aug 80.00 + Sep 44.50 = 124.50 / 3 = 41.50 > Oct spent 40.00
    expect(byId('2026-10', '2026-10-03').b05.projected).toBe(4150);
    // groceries: avg (408.93 + 343.95 + 458.73) / 3 = 403.87 < spent 479.43
    expect(byId('2026-10', '2026-10-03').b01.projected).toBe(47943);
  });

  it('suggests a limit from the trailing 6-month average rounded up to €5', () => {
    // groceries May–Oct: 367.43 + 489.06 + 408.93 + 343.95 + 458.73 + 479.43 = 2547.53 / 6 = 424.59 → 425
    const b01 = ds.budgets.find((b) => b.id === 'b01')!;
    expect(suggestLimit(view, lines, b01, '2026-11')).toBe(42500);
  });
});

describe('balances, net worth, goals (DATA_MODEL §10)', () => {
  const today = '2026-11-25';

  it('account balances: last imported balance_after, else latest snapshot, else unknown', () => {
    expect(accountBalance(ds, 'cgd-main')).toMatchObject({ balance: 555292, source: 'import' });
    expect(accountBalance(ds, 'revolut')).toMatchObject({ balance: 8420, source: 'snapshot' });
    expect(accountBalance(ds, 'cash')).toBeNull();
  });

  it('net worth = 5552.92 + 84.20 = 5637.12, with three unknown accounts', () => {
    const nw = netWorth(ds);
    expect(nw.total).toBe(563712);
    expect(nw.unknown).toEqual(['paypal', 'cash', 'savings']);
  });

  it('whole months left', () => {
    expect(wholeMonthsBetween('2026-11-25', '2027-06-30')).toBe(7);
    expect(wholeMonthsBetween('2026-11-25', '2027-04-01')).toBe(4);
  });

  it('emergency fund (net-worth basis)', () => {
    const g = goalStatus(ds, lines, ds.goals.find((x) => x.id === 'g-emergency')!, today);
    expect(g.value).toBe(563712);
    expect(g.progress).toBeCloseTo(5637.12 / 6000, 10);
    // (6000 − 5637.12) / 7 months = 51.84
    expect(g.requiredPerMonth).toBe(5184);
    // 2430.25 + (6000 − 2430.25) × 328/545 days = 2430.25 + 2148.40 = 4578.65 → on track
    expect(g.expected).toBe(457865);
    expect(g.onTrack).toBe(true);
  });

  it('Japan trip (savings since 2026-06-01, whole months Jun–Oct)', () => {
    const g = goalStatus(ds, lines, ds.goals.find((x) => x.id === 'g-japan')!, today);
    expect(g.months).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    // saved: 82.12 + 1178.18 + 621.03 + 226.22 + 155.06 = 2262.61
    expect(g.value).toBe(226261);
    // (2500 − 2262.61) / 4 = 59.3475 → 59.35
    expect(g.requiredPerMonth).toBe(5935);
    // 2500 × 177/304 days = 1455.59 → on track
    expect(g.expected).toBe(145559);
    expect(g.onTrack).toBe(true);
  });
});
