import { describe, expect, it } from 'vitest';
import { parseCsv } from '../../src/core/csv';
import { seal, unseal } from '../../src/sync/crypto';
import { decodeBase64Utf8, encodeBase64Utf8, isDataPath } from '../../src/sync/github';
import { applyOp, applyOps, commitMessage, serializeTable, type Op } from '../../src/sync/ops';

const op = (p: Partial<Op>): Op => ({
  id: 'x',
  file: 'overrides.csv',
  kind: 'upsert',
  key: { txn_id: 'abc' },
  at: '2026-11-25T10:00:00',
  label: 'recategorise 1 transaction',
  ...p,
});

describe('pending ops', () => {
  it('upserts as a patch, keeping other columns (including unknown ones)', () => {
    const t = parseCsv(
      'txn_id,category_id,event_id,note,excluded,reimburses_txn_id,updated_at,future_col\nabc,,ev-1,hi,,,2026-01-01,keep\n',
    );
    const out = applyOp(t, op({ row: { category_id: 'groceries', updated_at: '2026-11-25T10:00:00' } }));
    expect(serializeTable(out, 'overrides.csv')).toBe(
      'txn_id,category_id,event_id,note,excluded,reimburses_txn_id,updated_at,future_col\nabc,groceries,ev-1,hi,,,2026-11-25T10:00:00,keep\n',
    );
  });

  it('appends a new row when the key is missing, creating the file if needed', () => {
    const out = applyOp(undefined, op({ row: { category_id: 'fuel' } }));
    expect(serializeTable(out, 'overrides.csv')).toBe(
      'txn_id,category_id,event_id,note,excluded,reimburses_txn_id,updated_at\nabc,fuel,,,,,\n',
    );
  });

  it('deletes by composite key', () => {
    const t = parseCsv('date,account_id,balance,note\n2026-10-31,revolut,84.20,\n2026-10-31,cash,10.00,\n');
    const out = applyOp(
      t,
      op({ file: 'balances.csv', kind: 'delete', key: { date: '2026-10-31', account_id: 'cash' } }),
    );
    expect(out.rows).toHaveLength(1);
  });

  it('re-applies the same ops to a newer base deterministically (merge after a concurrent push)', () => {
    const ops = [op({ row: { category_id: 'fuel' } }), op({ key: { txn_id: 'def' }, row: { note: 'n' } })];
    const base1 = new Map([
      ['overrides.csv', parseCsv('txn_id,category_id,event_id,note,excluded,reimburses_txn_id,updated_at\n')],
    ]);
    const base2 = new Map([
      [
        'overrides.csv',
        parseCsv('txn_id,category_id,event_id,note,excluded,reimburses_txn_id,updated_at\nzzz,rent,,,,,\n'),
      ],
    ]);
    const r1 = applyOps(base1, ops).get('overrides.csv')!;
    const r2 = applyOps(base2, ops).get('overrides.csv')!;
    expect(r1.rows.map((r) => r.txn_id)).toEqual(['abc', 'def']);
    expect(r2.rows.map((r) => r.txn_id)).toEqual(['zzz', 'abc', 'def']);
  });

  it('builds one commit message with a Device trailer', () => {
    const msg = commitMessage([op({}), op({}), op({ label: 'add note' })], 'phone');
    expect(msg).toBe('app: recategorise 1 transaction (×2), add note\n\nDevice: phone');
  });
});

describe('token encryption', () => {
  it('round-trips with the right PIN and fails with a wrong one', async () => {
    const s = await seal('github_pat_secret', '1234', 1000);
    expect(s.ct).not.toContain('github_pat');
    expect(await unseal(s, '1234')).toBe('github_pat_secret');
    expect(await unseal(s, '9999')).toBeNull();
  });
});

describe('github helpers', () => {
  it('decodes base64 blobs as UTF-8', () => {
    expect(decodeBase64Utf8(encodeBase64Utf8('Cafés & snacks €'))).toBe('Cafés & snacks €');
    expect(decodeBase64Utf8('Q2Fm\nw6k=\n')).toBe('Café');
  });

  it('reads only data files', () => {
    expect(isDataPath('overrides.csv')).toBe(true);
    expect(isDataPath('transactions/2026/2026-01.csv')).toBe(true);
    expect(isDataPath('settings.json')).toBe(true);
    expect(isDataPath('tools/mh.py')).toBe(false);
    expect(isDataPath('.claude/skills/x/SKILL.md')).toBe(false);
  });
});
