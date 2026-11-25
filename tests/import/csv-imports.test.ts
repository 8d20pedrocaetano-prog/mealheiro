import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildDataSet, loadDataSet } from '../../src/core/dataset';
import { parseSettings } from '../../src/core/schema';
import { formatMoneyCsv } from '../../src/core/money';
import { looseMoney, matchPaypal, parsePaypal } from '../../src/import/paypal';
import { importOp, planImport } from '../../src/import/plan';
import { parseRevolut } from '../../src/import/revolut';
import { applyOps } from '../../src/sync/ops';
import { parseTables } from '../../src/core/dataset';
import { loadDemoFiles } from '../helpers/fixtures';

const revolut = readFileSync('fixtures/revolut/synthetic.csv', 'utf8');
const paypal = readFileSync('fixtures/paypal/synthetic.csv', 'utf8');

describe('Revolut CSV (IMPORT_FORMATS §3)', () => {
  it('imports completed EUR rows, fees as their own row, with an intact balance chain', async () => {
    const s = await parseRevolut(revolut, 'revolut');
    expect(s.errors).toEqual([]);
    expect(s.skipped).toEqual([
      { reason: 'not completed (pending, reverted or declined)', count: 1 },
      { reason: 'in another currency (Mealheiro needs the EUR amount)', count: 1 },
    ]);
    expect(
      s.rows.map((r) => [
        r.booking_date,
        r.value_date,
        r.description_raw,
        formatMoneyCsv(r.amount),
        r.balance_after && formatMoneyCsv(r.balance_after),
        r.category_suggested ?? '',
      ]),
    ).toEqual([
      ['2026-10-02', '2026-10-02', 'Top-up by *1234', '100.00', '100.00', 'transfer-revolut'],
      ['2026-10-04', '2026-10-03', 'Padaria Exemplo', '-4.35', '95.65', ''],
      ['2026-10-06', '2026-10-05', 'Cinema Ficticio', '-13.50', '82.15', ''],
      ['2026-10-09', '2026-10-09', 'Cash at ATM Exemplo', '-40.00', '42.15', ''],
      ['2026-10-09', '2026-10-09', 'FEE Cash at ATM Exemplo', '-1.00', '41.15', 'bank-fees'],
      ['2026-10-11', '2026-10-10', 'Cafe Teste', '-2.80', '38.35', ''],
      ['2026-10-15', '2026-10-15', 'Cafe Teste', '-2.80', '35.55', ''],
    ]);
    expect(new Set(s.rows.map((r) => r.id)).size).toBe(7);
    expect(s.closingBalance).toBe(3555);
  });

  it('adds to the demo repo once, with suggestions; the second time adds nothing', async () => {
    const files = loadDemoFiles();
    const s = await parseRevolut(revolut, 'revolut');
    const plan = planImport(loadDataSet(files), s, { name: 'r.csv', sha256: '1'.repeat(64) });
    expect(plan.newRows).toHaveLength(7);
    const t1 = applyOps(parseTables(files), [
      { ...importOp(plan, 'app-phone', new Date(2026, 9, 31, 12, 0, 0)), id: 'a', at: 'x' },
    ]);
    const oct = t1.get('transactions/2026/2026-10.csv')!.rows.filter((r) => r.account_id === 'revolut');
    expect(oct.map((r) => r.category_suggested)).toEqual([
      'transfer-revolut',
      '',
      '',
      '',
      'bank-fees',
      '',
      '',
    ]);
    expect(oct.every((r) => r.suggested_by === (r.category_suggested ? 'import' : ''))).toBe(true);
    const again = planImport(buildDataSet(t1, parseSettings(files['settings.json'])), s, {
      name: 'r2.csv',
      sha256: '2'.repeat(64),
    });
    expect(again.newRows).toHaveLength(0);
    expect(again.duplicates).toBe(7);
  });

  it('refuses a file with a broken balance chain', async () => {
    const bad = revolut.replace('Padaria Exemplo,-4.35', 'Padaria Exemplo,-4.53');
    const s = await parseRevolut(bad, 'revolut');
    expect(s.errors[0]).toMatch(/Balance chain broken at row 2/);
  });

  it('rejects files that are not Revolut statements', async () => {
    await expect(parseRevolut('a,b\n1,2\n')).rejects.toThrow(/Not a Revolut statement/);
  });
});

describe('PayPal CSV enrichment (IMPORT_FORMATS §4)', () => {
  it('reads Portuguese headers and amounts', () => {
    const p = parsePaypal(paypal);
    expect(p.map((x) => [x.date, x.name, x.amount, x.currency])).toEqual([
      ['2026-01-17', 'Loja Online Exemplo', 5988, 'EUR'],
      ['2026-02-16', 'Spotify AB', 4361, 'EUR'],
      ['2026-05-17', 'Livraria Ficticia', 4007, 'EUR'],
      ['2026-08-20', 'Jogos Exemplo Lda', 4623, 'EUR'],
      ['2026-09-25', 'Loja Americana', 1500, 'USD'],
    ]);
    expect(looseMoney('-1.234,56')).toBe(-123456);
    expect(looseMoney('-1,234.56')).toBe(-123456);
    expect(looseMoney('7')).toBe(700);
  });

  it('matches CGD PayPal outflows by amount within 3 days and suggests from the rules', () => {
    const ds = loadDataSet(loadDemoFiles());
    const r = matchPaypal(ds, parsePaypal(paypal));
    expect(r.matches.map((x) => [x.txn.id, x.payment.name, x.suggested])).toEqual([
      ['8cea89b87bd5f284', 'Jogos Exemplo Lda', null],
      ['8775ac0041a4a040', 'Livraria Ficticia', null],
      ['23b332cadb26f797', 'Spotify AB', 'streaming'],
      ['f456204b92db6f8b', 'Loja Online Exemplo', null],
    ]);
    expect(r.unmatched.map((t) => t.id)).toEqual([]);
    expect(r.foreign).toBe(1);
  });
});
