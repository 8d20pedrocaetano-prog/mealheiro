import { describe, expect, it } from 'vitest';
import { loadDataSet } from '../../src/core/dataset';
import { suggestPairs } from '../../src/core/pairs';
import { loadDemoFiles } from '../helpers/fixtures';

describe('payback / pass-through suggestions (DATA_MODEL §12)', () => {
  it('matches `mh.py pairs` on the demo data', () => {
    const ds = loadDataSet(loadDemoFiles());
    const got = suggestPairs(ds).map(
      (p) =>
        `${p.type} ${p.incoming.value_date} ${p.incoming.amountStr} ${p.other.value_date} ${p.other.amountStr}`,
    );
    // Output of `python3 reference/mh.py pairs` run in fixtures/demo-data
    expect(got).toEqual([
      'payback 2026-01-02 23.21 2026-01-02 -46.43',
      'payback 2026-01-10 28.16 2026-01-09 -56.32',
      'payback 2026-02-14 35.41 2026-02-13 -70.81',
      'payback 2026-03-14 20.42 2026-03-14 -44.16',
      'payback 2026-03-27 30.84 2026-03-27 -61.69',
      'payback 2026-04-04 24.52 2026-04-04 -79.61',
      'payback 2026-04-18 47.07 2026-04-17 -94.14',
      'payback 2026-04-25 18.38 2026-04-25 -50.46',
      'payback 2026-05-15 41.49 2026-05-15 -82.98',
      'payback 2026-07-18 23.14 2026-07-18 -78.89',
      'payback 2026-07-24 26.70 2026-07-24 -53.40',
      'payback 2026-08-08 41.83 2026-08-07 -83.65',
      'payback 2026-08-29 32.54 2026-08-28 -65.08',
      'payback 2026-10-02 37.55 2026-10-02 -75.10',
      'payback 2026-10-23 45.66 2026-10-23 -91.33',
      'payback 2026-10-31 32.40 2026-10-31 -82.96',
    ]);
  });
});
