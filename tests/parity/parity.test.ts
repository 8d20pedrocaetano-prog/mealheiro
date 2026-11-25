/**
 * Parity: the TypeScript core must reproduce fixtures/golden/* exactly from fixtures/demo-data
 * (CLAUDE.md non-negotiable #4). These compare bytes, not just parsed values.
 */
import { describe, expect, it } from 'vitest';
import { monthSummary, monthSummaryJson, reportingLines } from '../../src/core/aggregates';
import { serializeCsv } from '../../src/core/csv';
import { loadDataSet } from '../../src/core/dataset';
import { recurringKeys } from '../../src/core/recurring';
import { detectTrips } from '../../src/core/trips';
import { buildView, effOf } from '../../src/core/view';
import { golden, loadDemoFiles } from '../helpers/fixtures';

const ds = loadDataSet(loadDemoFiles());
const view = buildView(ds);

/** Python's json.dumps(x, indent=1, ensure_ascii=False) for the shapes used here. */
const pyJson = (x: unknown) => JSON.stringify(x, null, 1);

describe('parity with reference/mh.py', () => {
  it('loads all 412 imported + 2 manual transactions without problems', () => {
    expect(ds.txns.filter((t) => !t.manual)).toHaveLength(412);
    expect(ds.txns.filter((t) => t.manual)).toHaveLength(2);
    expect(ds.problems).toEqual([]);
  });

  it('categorized.csv', () => {
    const header = [
      'id',
      'category_id',
      'report_category',
      'group',
      'kind',
      'merchant',
      'source',
      'event_id',
    ];
    const rows = ds.txns.map((t) => {
      const e = effOf(view, t);
      return {
        id: t.id,
        category_id: e.categoryId,
        report_category: e.reportCategory,
        group: e.group,
        kind: e.kind,
        merchant: e.merchant,
        source: e.source,
        event_id: e.eventId,
      };
    });
    expect(serializeCsv(header, rows)).toBe(golden('categorized.csv'));
  });

  it('monthly-summary.json', () => {
    const s = monthSummaryJson(monthSummary(reportingLines(view)));
    expect(s).toEqual(JSON.parse(golden('monthly-summary.json')));
    expect(pyJson(s)).toBe(golden('monthly-summary.json'));
  });

  it('recurring-keys.json', () => {
    const keys = [...recurringKeys(ds)].sort();
    expect(pyJson(keys)).toBe(golden('recurring-keys.json'));
  });

  it('trips.json', () => {
    const trips = detectTrips(ds, view);
    expect(trips).toEqual(JSON.parse(golden('trips.json')));
    expect(pyJson(trips)).toBe(golden('trips.json'));
  });
});

describe('trip proposals after the app-side filter (SPEC §4.5 AC)', () => {
  it('shows only the 3–6 Jul proposal, under its proposed event name', async () => {
    const { filterProposals } = await import('../../src/core/trips');
    const proposals = filterProposals(detectTrips(ds, view), ds.events);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ name: 'Trip 2026-07-03', start: '2026-07-03', end: '2026-07-06' });
    expect(proposals[0].event?.id).toBe('ev-2026-07-03');
  });

  it('does not detect the domestic Porto weekend', () => {
    expect(detectTrips(ds, view).some((t) => t.start >= '2026-09-10' && t.start <= '2026-09-14')).toBe(false);
  });
});
