import { describe, expect, it } from 'vitest';
import type { Model } from '../../src/core/model';
import { comparePeriod, elapsed, type Period } from '../../src/ui/lib/period';

const model = (today: string, events: unknown[] = []) => ({ today, ds: { events } }) as unknown as Model;
const p = (from: string, to: string): Period => ({ id: 'x', label: 'x', from, to });

describe('compare-to periods (SPEC §4.3)', () => {
  it('compares the elapsed part of this month with the same days of last month', () => {
    const m = model('2026-11-25');
    expect(elapsed(p('2026-11-01', '2026-11-30'), m.today)).toMatchObject({ to: '2026-11-25' });
    expect(comparePeriod(p('2026-11-01', '2026-11-30'), 'previous', m)).toMatchObject({
      from: '2026-10-01',
      to: '2026-10-25',
    });
  });

  it('shifts whole months by their count, ending on the last day', () => {
    const m = model('2026-11-25');
    expect(comparePeriod(p('2026-01-01', '2026-03-31'), 'previous', m)).toMatchObject({
      from: '2025-10-01',
      to: '2025-12-31',
    });
    expect(comparePeriod(p('2026-02-01', '2026-02-28'), 'previous', m)).toMatchObject({
      from: '2026-01-01',
      to: '2026-01-31',
    });
  });

  it('same time last year, including a leap day', () => {
    const m = model('2029-01-10');
    expect(comparePeriod(p('2028-02-01', '2028-02-29'), 'last-year', m)).toMatchObject({
      from: '2027-02-01',
      to: '2027-02-28',
    });
  });

  it('custom ranges shift by their length in days', () => {
    const m = model('2026-11-25');
    expect(comparePeriod(p('2026-03-10', '2026-03-19'), 'previous', m)).toMatchObject({
      from: '2026-02-28',
      to: '2026-03-09',
    });
  });

  it('another stage, open-ended up to today', () => {
    const m = model('2026-11-25', [{ id: 'st1', name: 'Old flat', start_date: '2025-01-01', end_date: '' }]);
    expect(comparePeriod(p('2026-01-01', '2026-06-30'), 'stage-st1', m)).toMatchObject({
      label: 'Old flat',
      from: '2025-01-01',
      to: '2026-11-25',
    });
    expect(comparePeriod(p('2026-01-01', '2026-06-30'), '', m)).toBeNull();
  });
});
