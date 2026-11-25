/** M4: confirming trips gives the right totals; budgets set for next month; goals; stage compare. */
import { describe, expect, it } from 'vitest';
import { parseTables } from '../../src/core/dataset';
import { activeBudgets, budgetStatuses } from '../../src/core/budgets';
import { defaultTicks, stageAverages, tripSummary } from '../../src/core/eventStats';
import { goalStatus } from '../../src/core/goals';
import { buildModel, type Model } from '../../src/core/model';
import { parseMoney } from '../../src/core/money';
import { parseSettings } from '../../src/core/schema';
import * as E from '../../src/state/edits';
import { applyOps } from '../../src/sync/ops';
import { loadDemoFiles } from '../helpers/fixtures';

const files = loadDemoFiles();
const base = parseTables(files);
const settings = parseSettings(files['settings.json']);
const m0 = buildModel(base, settings, '2026-10-31');
const apply = (ops: E.NewOp[]): Model =>
  buildModel(
    applyOps(
      base,
      ops.map((o, i) => ({ ...o, id: `o${i}`, at: 'x' })),
    ),
    settings,
    '2026-10-31',
  );

describe('trip proposals', () => {
  const p = m0.proposals[0];

  it('confirming the July proposal with default ticks gives the detector total', () => {
    expect(m0.proposals).toHaveLength(1);
    const ticks = defaultTicks(p.candidate.members, p.candidate.unticked);
    const m = apply(
      E.confirmTrip(
        m0,
        { id: p.event!.id, name: 'Madrid', type: 'trip', start: p.start, end: p.end, budget: '200' },
        ticks,
      ),
    );
    const ev = m.ds.events.find((e) => e.id === p.event!.id)!;
    expect(ev.status).toBe('confirmed');
    expect(ev.name).toBe('Madrid');
    expect(ev.budget).toBe('200.00');
    const s = tripSummary(m, ev);
    expect(s.total).toBe(parseMoney(p.candidate.total));
    expect(s.members.sort()).toEqual([...ticks].sort());
    expect(s.byDay.reduce((a, b) => a + b, 0) + s.preTrip).toBe(s.total);
    expect(m.proposals).toHaveLength(0);
  });

  it('ticking a pre-trip booking adds it as pre-trip cost', () => {
    const pre = p.candidate.pre_trip_suggestions;
    if (!pre.length) return;
    const ticks = new Set([...defaultTicks(p.candidate.members, p.candidate.unticked), ...pre]);
    const m = apply(
      E.confirmTrip(
        m0,
        { id: p.event!.id, name: p.name, type: 'trip', start: p.start, end: p.end, budget: '' },
        ticks,
      ),
    );
    const s = tripSummary(m, m.ds.events.find((e) => e.id === p.event!.id)!);
    expect(s.preTrip).toBeGreaterThan(0);
    expect(s.total).toBe(parseMoney(p.candidate.total) + s.preTrip);
  });

  it('dismissing hides the proposal for good', () => {
    const m = apply(
      E.dismissTrip(m0, {
        id: p.event!.id,
        name: p.name,
        type: 'trip',
        start: p.start,
        end: p.end,
        budget: '',
      }),
    );
    expect(m.proposals).toHaveLength(0);
    expect(m.ds.events.find((e) => e.id === p.event!.id)!.status).toBe('dismissed');
  });

  it('a detector-only candidate gets a new event id', () => {
    const d = {
      name: 'Somewhere',
      type: 'trip' as const,
      start: '2026-02-01',
      end: '2026-02-03',
      budget: '',
    };
    const ops = E.confirmTrip(m0, d, new Set());
    expect(ops[0].key.id).toBe('ev-2026-02-01');
  });

  it('Edinburgh: trip page figures', () => {
    const ev = m0.ds.events.find((e) => e.id === 'ev-edinburgh')!;
    const s = tripSummary(m0, ev);
    expect(s.days).toBe(5);
    expect(s.budget).toBe(60000);
    expect(s.total).toBeGreaterThan(0);
    expect(s.byCategory.reduce((a, c) => a + c.spent, 0)).toBe(s.total);
    expect(s.fxFees).toBeGreaterThan(0);
  });
});

describe('budgets for next month', () => {
  it('a new limit applies from its month on and keeps history', () => {
    const before = activeBudgets(m0.ds.budgets, '2026-10');
    const groceries = before.find((b) => b.target === 'groceries')!;
    const m = apply(
      E.setBudget(
        m0,
        { scope: 'category', target: 'groceries', limit: 50000, excludeEvents: false },
        '2026-11',
      ),
    );
    expect(activeBudgets(m.ds.budgets, '2026-11').find((b) => b.target === 'groceries')!.monthly_limit).toBe(
      '500.00',
    );
    expect(activeBudgets(m.ds.budgets, '2026-10').find((b) => b.target === 'groceries')!.monthly_limit).toBe(
      groceries.monthly_limit,
    );
    // setting it again for the same month updates that row instead of adding one
    const m2 = buildModel(
      applyOps(
        base,
        [
          ...E.setBudget(
            m0,
            { scope: 'category', target: 'groceries', limit: 50000, excludeEvents: false },
            '2026-11',
          ),
        ].map((o, i) => ({ ...o, id: `o${i}`, at: 'x' })),
      ),
      settings,
      '2026-10-31',
    );
    const again = E.setBudget(
      m2,
      { scope: 'category', target: 'groceries', limit: 45000, excludeEvents: false },
      '2026-11',
    );
    expect(again[0].key.id).toBe(m2.ds.budgets.find((b) => b.start_month === '2026-11')!.id);
  });

  it('stopping a budget ends it the month before', () => {
    const m = apply(E.stopBudget(m0, 'category', 'groceries', '2026-11'));
    expect(activeBudgets(m.ds.budgets, '2026-11').some((b) => b.target === 'groceries')).toBe(false);
    expect(activeBudgets(m.ds.budgets, '2026-10').some((b) => b.target === 'groceries')).toBe(true);
    expect(
      budgetStatuses(m.view, m.lines, '2026-10', m.today).some((s) => s.row.target === 'groceries'),
    ).toBe(true);
  });
});

describe('goals and stages', () => {
  it('a saved goal gets a status', () => {
    const m = apply(
      E.saveGoal(m0, {
        name: 'Bike',
        target: 120000,
        targetDate: '2027-06-30',
        basis: 'savings-since-start',
        startDate: '2026-06-01',
        startAmount: 0,
      }),
    );
    const g = m.ds.goals.find((x) => x.name === 'Bike')!;
    const st = goalStatus(m.ds, m.lines, g, m.today);
    expect(st.target).toBe(120000);
    expect(st.months).toEqual(['2026-06', '2026-07', '2026-08', '2026-09']);
  });

  it('stage averages are per month', () => {
    const stage = m0.ds.events.find((e) => e.type === 'stage')!;
    const a = stageAverages(m0, stage);
    expect(a.months).toBe(5);
    expect(a.total).toBe([...a.byGroup.values()].reduce((s, v) => s + v, 0));
  });
});
