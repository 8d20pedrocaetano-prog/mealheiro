import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCsv } from '../../src/core/csv';
import { formatMoneyCsv } from '../../src/core/money';
import { parseCgd, type PageItems } from '../../src/import/cgd';
import { sha256Hex } from '../../src/import/statement';
import { pdfItems } from '../helpers/pdfItems';

const PDF = 'fixtures/cgd/synthetic-statement.pdf';

describe('CGD PDF import (SPEC §4.8 AC, M5)', () => {
  it('produces rows identical to fixtures/cgd/expected.csv', async () => {
    const { pages } = await pdfItems(PDF);
    const s = await parseCgd(pages, 'cgd-main');
    expect(s.errors).toEqual([]);
    const expected = parseCsv(readFileSync('fixtures/cgd/expected.csv', 'utf8'));
    const got = s.rows.map((r) => ({
      id: r.id,
      account_id: r.account_id,
      booking_date: r.booking_date,
      value_date: r.value_date,
      description_raw: r.description_raw,
      amount: formatMoneyCsv(r.amount),
      currency: r.currency,
      balance_after: r.balance_after === null ? '' : formatMoneyCsv(r.balance_after),
    }));
    expect(got).toEqual(expected.rows);
    expect(s.periodStart).toBe('2026-01-01');
    expect(s.periodEnd).toBe('2026-10-31');
    expect(s.closingBalance).toBe(555292);
  });

  it('has the sha256 the demo imports.csv recorded', async () => {
    const { bytes } = await pdfItems(PDF);
    expect(await sha256Hex(bytes)).toBe('5da821979845d593260c73d34a9ddbd3957d1fc694c4d57c22f0d9aab5b32789');
  });

  it('reports a broken balance chain instead of fixing numbers', async () => {
    const { pages } = await pdfItems(PDF);
    // change one amount on page 2: the chain breaks there
    const p2 = pages[1].map((it) => (it.str === '-46,06' ? { ...it, str: '-46,60' } : it));
    const s = await parseCgd([pages[0], p2, ...pages.slice(2)]);
    expect(s.errors.length).toBeGreaterThan(0);
    expect(s.errors[0]).toMatch(/Balance chain broken/);
  });

  it('refuses a row whose columns do not line up', async () => {
    const page: PageItems = [
      { str: '01-02-2026', x: 63.5, y: 400, width: 38 },
      { str: '01-02-2026', x: 139.3, y: 400, width: 38 },
      { str: 'SOMETHING', x: 215, y: 400, width: 40 },
      { str: '12,00', x: 403, y: 400, width: 19 },
    ];
    await expect(parseCgd([page])).rejects.toThrow(/Unparseable row on page 1/);
  });

  it('joins runs that touch and splits runs on spaces, like pdfplumber words', async () => {
    const page: PageItems = [
      { str: '02-02-2026', x: 63.5, y: 400, width: 38.36 },
      { str: '02-02-2026', x: 139.3, y: 400, width: 38.36 },
      { str: 'COMPRA PINGO', x: 215, y: 400, width: 55 },
      { str: ' DOCE', x: 270, y: 400.5, width: 22 },
      { str: 'ARE', x: 294, y: 400, width: 15 },
      { str: '-1.234,50', x: 388, y: 400, width: 34.2 },
      { str: '5.000,00', x: 502.5, y: 400, width: 29.2 },
    ];
    const s = await parseCgd([page]);
    expect(s.rows[0].description_raw).toBe('COMPRA PINGO DOCE ARE');
    expect(s.rows[0].amount).toBe(-123450);
    expect(s.rows[0].balance_after).toBe(500000);
  });
});
