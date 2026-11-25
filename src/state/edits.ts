/**
 * Every edit the UI can make, as row-level ops (ARCHITECTURE §4). Pure: they read the model and return
 * ops; `useApp().commit(ops)` persists and applies them. Only user-owned files are touched
 * (DATA_MODEL §2), and `transactions/**` never.
 */
import type { Txn } from '../core/dataset';
import { nowLocalTimestamp } from '../core/dates';
import { formatMoneyCsv, type Cents } from '../core/money';
import type { Model } from '../core/model';
import { escapeRegex, newRuleRow, type RuleDraft } from '../core/ruleTools';
import { CASH_CATEGORY, itemisedFor } from '../core/review';
import type { AccountRow, CategoryRow, ManualRow, OverrideRow, RuleRow } from '../core/schema';
import { effOf } from '../core/view';
import type { Op } from '../sync/ops';

export type NewOp = Omit<Op, 'id' | 'at'>;

/** Fields to set; undefined ones are left out. */
export type Patch = { [k: string]: string | undefined };

const clean = (p: Patch): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(p)) if (v !== undefined) out[k] = v;
  return out;
};

const ts = () => nowLocalTimestamp();

export function overrideOp(t: Txn, patch: Patch & Partial<OverrideRow>, label: string): NewOp {
  return {
    file: 'overrides.csv',
    kind: 'upsert',
    key: { txn_id: t.id },
    row: { ...clean(patch), updated_at: ts() },
    label,
  };
}

export const recategorise = (t: Txn, categoryId: string): NewOp[] => [
  overrideOp(t, { category_id: categoryId }, 'recategorise transaction'),
];

/** Keeps the category it has now, as the owner's own choice (answers payback / pass-through / cash cards). */
export const confirmCategory = (m: Model, t: Txn): NewOp[] => [
  overrideOp(t, { category_id: effOf(m.view, t).categoryId }, 'confirm category'),
];

export const setNote = (t: Txn, note: string): NewOp[] => [
  overrideOp(t, { note: note.trim() }, note.trim() ? 'add note' : 'remove note'),
];

export const setExcluded = (t: Txn, excluded: boolean, reason?: string): NewOp[] => [
  overrideOp(
    t,
    excluded ? { excluded: 'true', ...(reason?.trim() ? { note: reason.trim() } : {}) } : { excluded: '' },
    excluded ? 'exclude transaction' : 'include transaction',
  ),
];

export const setEvent = (t: Txn, eventId: string): NewOp[] => [
  overrideOp(t, { event_id: eventId }, eventId ? 'assign to event' : 'remove from event'),
];

/** Payback: copies the expense's category so the pair nets out in it (DATA_MODEL §6). */
export const linkPayback = (m: Model, incoming: Txn, expense: Txn): NewOp[] => [
  overrideOp(
    incoming,
    { reimburses_txn_id: expense.id, category_id: effOf(m.view, expense).categoryId },
    'link payback',
  ),
];

export const unlinkPayback = (incoming: Txn): NewOp[] => [
  overrideOp(incoming, { reimburses_txn_id: '', category_id: '' }, 'unlink payback'),
];

/** Pass-through: both legs in one category, so they cancel out there. */
export const linkPassThrough = (incoming: Txn, outgoing: Txn, categoryId: string): NewOp[] => [
  overrideOp(incoming, { category_id: categoryId }, 'link pass-through'),
  overrideOp(outgoing, { category_id: categoryId }, 'link pass-through'),
];

export function addRule(m: Model, draft: RuleDraft): NewOp[] {
  const row = newRuleRow(m.ds, draft, ts().slice(0, 10));
  return [
    { file: 'rules.csv', kind: 'upsert', key: { id: row.id }, row, label: `add rule /${row.pattern}/` },
  ];
}

export function updateRule(id: string, patch: Patch & Partial<RuleRow>, label = 'edit rule'): NewOp {
  return { file: 'rules.csv', kind: 'upsert', key: { id }, row: clean(patch), label };
}

export function deleteRule(id: string): NewOp {
  return { file: 'rules.csv', kind: 'delete', key: { id }, label: 'delete rule' };
}

/** "Who is this?": a nickname and a default category for one person, as a rule. */
export function namePerson(
  m: Model,
  key: string,
  direction: 'in' | 'out',
  nickname: string,
  categoryId: string,
): NewOp[] {
  return addRule(m, {
    pattern: '^' + escapeRegex(key),
    direction,
    amount_min: '',
    amount_max: '',
    account_id: '',
    merchant: nickname.trim(),
    category_id: categoryId,
  });
}

export interface ManualEntry {
  accountId: string;
  date: string;
  /** Signed: negative = expense. */
  amount: Cents;
  categoryId: string;
  description?: string;
  note?: string;
  eventId?: string;
  linkedTxnId?: string;
}

export function manualRow(m: Model, e: ManualEntry, id = `m-${crypto.randomUUID()}`): ManualRow {
  const name = m.ds.categories.get(e.categoryId)?.name ?? e.categoryId;
  return {
    id,
    account_id: e.accountId,
    date: e.date,
    description: e.description?.trim() || name,
    amount: formatMoneyCsv(e.amount),
    currency: m.ds.accounts.get(e.accountId)?.currency || 'EUR',
    category_id: e.categoryId,
    event_id: e.eventId ?? '',
    note: e.note?.trim() ?? '',
    created_at: ts(),
    linked_txn_id: e.linkedTxnId ?? '',
  };
}

export function addManual(m: Model, e: ManualEntry): NewOp[] {
  const row = manualRow(m, e);
  return [
    {
      file: 'manual.csv',
      kind: 'upsert',
      key: { id: row.id },
      row,
      label: e.amount < 0 ? 'add expense' : 'add income',
    },
  ];
}

export function deleteManual(id: string): NewOp {
  return { file: 'manual.csv', kind: 'delete', key: { id }, label: 'delete manual entry' };
}

export function balanceSnapshot(accountId: string, date: string, balance: Cents, note = ''): NewOp[] {
  return [
    {
      file: 'balances.csv',
      kind: 'upsert',
      key: { date, account_id: accountId },
      row: { balance: formatMoneyCsv(balance), note },
      label: 'add balance snapshot',
    },
  ];
}

export interface CashLine {
  /** Existing manual row id when editing. */
  id?: string;
  categoryId: string;
  /** Positive cents spent. */
  amount: Cents;
  note?: string;
  eventId?: string;
}

/**
 * "What was this cash for?" (SPEC §4.2): one manual row per line on the cash account, dated the withdrawal's
 * value date and linked to it. Lines removed from the sheet are deleted; whatever isn't assigned stays
 * unitemized.
 */
export function itemiseCash(m: Model, withdrawal: Txn, lines: CashLine[]): NewOp[] {
  const acct = m.ds.categories.get(CASH_CATEGORY)?.counterparty_account || 'cash';
  const existing = itemisedFor(m, withdrawal);
  const keep = new Set(lines.map((l) => l.id).filter(Boolean));
  const ops: NewOp[] = existing
    .filter((t) => !keep.has(t.id))
    .map((t) => ({ ...deleteManual(t.id), label: 'itemise cash' }));
  for (const l of lines) {
    if (l.amount <= 0) continue;
    const prev = l.id ? existing.find((t) => t.id === l.id)?.manual : undefined;
    const row = manualRow(
      m,
      {
        accountId: acct,
        date: withdrawal.value_date,
        amount: -l.amount,
        categoryId: l.categoryId,
        note: l.note,
        eventId: l.eventId,
        linkedTxnId: withdrawal.id,
      },
      l.id,
    );
    if (prev) row.created_at = prev.created_at;
    ops.push({ file: 'manual.csv', kind: 'upsert', key: { id: row.id }, row, label: 'itemise cash' });
  }
  return ops;
}

/** Links cash entries logged on the spot to the withdrawal that paid for them (display only). */
export const linkCashEntries = (entries: Txn[], withdrawal: Txn): NewOp[] =>
  entries.map((t) => ({
    file: 'manual.csv' as const,
    kind: 'upsert' as const,
    key: { id: t.id },
    row: { linked_txn_id: withdrawal.id },
    label: 'link cash entry',
  }));

export function updateAccount(id: string, patch: Patch & Partial<AccountRow>): NewOp {
  return { file: 'accounts.csv', kind: 'upsert', key: { id }, row: clean(patch), label: 'edit account' };
}

export function upsertCategory(
  id: string,
  patch: Patch & Partial<CategoryRow>,
  label = 'edit category',
): NewOp {
  return { file: 'categories.csv', kind: 'upsert', key: { id }, row: clean(patch), label };
}

/**
 * Merge category `from` into `to`: rules, overrides, manual entries and budgets move over; transactions
 * whose category only came from a suggestion get an override (transaction files are never rewritten);
 * then `from` is removed.
 */
export function mergeCategory(m: Model, from: string, to: string): NewOp[] {
  const label = `merge category ${from} into ${to}`;
  const ops: NewOp[] = [];
  for (const r of m.ds.rules)
    if (r.row.category_id === from) ops.push(updateRule(r.row.id, { category_id: to }, label));
  for (const [txnId, o] of m.ds.overrides)
    if (o.category_id === from)
      ops.push({
        file: 'overrides.csv',
        kind: 'upsert',
        key: { txn_id: txnId },
        row: { category_id: to, updated_at: ts() },
        label,
      });
  for (const t of m.ds.txns) {
    if (t.manual?.category_id === from)
      ops.push({ file: 'manual.csv', kind: 'upsert', key: { id: t.id }, row: { category_id: to }, label });
    else if (!t.manual && t.category_suggested === from && !m.ds.overrides.get(t.id)?.category_id)
      ops.push(overrideOp(t, { category_id: to }, label));
  }
  for (const b of m.ds.budgets)
    if (b.scope === 'category' && b.target === from)
      ops.push({ file: 'budgets.csv', kind: 'upsert', key: { id: b.id }, row: { target: to }, label });
  ops.push({ file: 'categories.csv', kind: 'delete', key: { id: from }, label });
  return ops;
}
