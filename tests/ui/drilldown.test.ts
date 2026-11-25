/**
 * "Every number on screen can be tapped through to the transactions behind it" (CLAUDE.md #8) and
 * "every KPI equals the golden figure for that month" (SPEC §4.1 AC), checked for every demo month.
 */
import { describe, expect, it } from 'vitest';
import { totalsOf } from '../../src/core/aggregates';
import { parseTables } from '../../src/core/dataset';
import { buildModel } from '../../src/core/model';
import { parseMoney } from '../../src/core/money';
import { parseSettings } from '../../src/core/schema';
import { applyFilter, monthRangeFilter } from '../../src/ui/lib/filter';
import { golden, loadDemoFiles } from '../helpers/fixtures';

const files = loadDemoFiles();
const m = buildModel(parseTables(files), parseSettings(files['settings.json']), '2026-10-31');
const gold = JSON.parse(golden('monthly-summary.json')) as Record<string, Record<string, string>>;

const goldTotals = (month: string) => {
  const b = gold[month];
  const income = b.income ? parseMoney(b.income) : 0;
  const spent = -Object.entries(b)
    .filter(([k]) => k.startsWith('spend:'))
    .reduce((s, [, v]) => s + parseMoney(v), 0);
  return { income, spent, saved: income - spent };
};

describe('Home KPIs and their drill-down', () => {
  for (const month of Object.keys(gold)) {
    it(`${month}: KPIs equal golden and the filtered transactions add up to each KPI`, () => {
      const t = totalsOf(month, m.summary[month]);
      const g = goldTotals(month);
      expect({ income: t.income, spent: t.spent, saved: t.saved }).toEqual(g);

      const range = monthRangeFilter(month);
      const spentLines = applyFilter(m, { ...range, kind: 'expense' }).lines;
      expect(-spentLines.reduce((s, l) => s + l.amount, 0)).toBe(g.spent);
      const incomeLines = applyFilter(m, { ...range, kind: 'income' }).lines;
      expect(incomeLines.reduce((s, l) => s + l.amount, 0)).toBe(g.income);
      const savedLines = applyFilter(m, { ...range, kind: 'reporting' }).lines;
      expect(savedLines.reduce((s, l) => s + l.amount, 0)).toBe(g.saved);
    });
  }

  it('group drill-down equals the golden group bucket', () => {
    for (const [month, b] of Object.entries(gold)) {
      for (const [k, v] of Object.entries(b)) {
        if (!k.startsWith('spend:')) continue;
        const r = applyFilter(m, { ...monthRangeFilter(month), kind: 'expense', group: k.slice(6) });
        expect(r.lines.reduce((s, l) => s + l.amount, 0)).toBe(parseMoney(v));
      }
    }
  });

  it('Insights period totals equal the sum of the golden months (SPEC §4.3 AC)', () => {
    const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
    const sum = months.map(goldTotals).reduce((a, b) => ({
      income: a.income + b.income,
      spent: a.spent + b.spent,
      saved: a.saved + b.saved,
    }));
    const r = applyFilter(m, { from: '2026-05-01', to: '2026-10-31', kind: 'reporting' });
    const income = r.lines.filter((l) => l.kind === 'income').reduce((s, l) => s + l.amount, 0);
    const spent = -r.lines.filter((l) => l.kind === 'expense').reduce((s, l) => s + l.amount, 0);
    expect({ income, spent, saved: income - spent }).toEqual(sum);
  });

  it('itemised cash shows its offset in the Unitemized drill-down', () => {
    const r = applyFilter(m, { ...monthRangeFilter('2026-09'), kind: 'expense', cat: 'unitemized-cash' });
    expect(r.contribution.get('m-0002')).toBe(1550);
    expect(-r.lines.reduce((s, l) => s + l.amount, 0)).toBe(4450);
  });

  it('search matches merchant text and pt-PT amounts', () => {
    expect(applyFilter(m, { q: 'francesinha' }).txns.map((t) => t.id)).toEqual(['m-0002']);
    expect(applyFilter(m, { q: '15,5' }).txns.some((t) => t.id === 'm-0002')).toBe(true);
  });

  it('recomputes 414 transactions well inside the 100 ms budget', () => {
    expect(m.computeMs).toBeLessThan(100);
  });
});
