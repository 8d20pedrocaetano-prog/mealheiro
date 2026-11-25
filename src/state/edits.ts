/**
 * Every edit the UI can make, as row-level ops (ARCHITECTURE §4). Pure: they read the model and return
 * ops; `useApp().commit(ops)` persists and applies them. Only user-owned files are touched
 * (DATA_MODEL §2), and `transactions/**` never.
 */
import type { Txn } from '../core/dataset';
import { addMonths, nowLocalTimestamp } from '../core/dates';
import { newEventId } from '../core/eventStats';
import { formatMoneyCsv, parseUserAmount, type Cents } from '../core/money';
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

/* ───────────── Events (SPEC §4.5) ───────────── */

export interface EventDraft {
  id?: string;
  name: string;
  type: 'trip' | 'work-trip' | 'stage' | 'tag';
  start: string;
  end: string;
  budget: string;
  color?: string;
  notes?: string;
}

function eventRow(m: Model, d: EventDraft, status: 'proposed' | 'confirmed' | 'dismissed', source: string) {
  const existing = d.id ? m.ds.events.find((e) => e.id === d.id) : undefined;
  const id = d.id ?? newEventId(m.ds.events, d.start || m.today);
  const budget = parseUserAmount(d.budget);
  return {
    id,
    row: {
      name: d.name.trim(),
      type: d.type,
      status,
      start_date: d.start,
      end_date: d.end,
      budget: budget === null ? '' : formatMoneyCsv(Math.abs(budget)),
      color: d.color ?? existing?.color ?? '',
      source: existing?.source || source,
      notes: d.notes ?? existing?.notes ?? '',
      created_at: existing?.created_at || ts().slice(0, 10),
    },
  };
}

/**
 * Confirm a trip proposal: the event becomes `confirmed` and every ticked transaction gets the event's id;
 * transactions that pointed at it but are no longer ticked lose it.
 */
export function confirmTrip(m: Model, d: EventDraft, ticked: Set<string>): NewOp[] {
  const { id, row } = eventRow(m, d, 'confirmed', 'detector');
  const label = `confirm trip "${row.name}"`;
  const ops: NewOp[] = [{ file: 'events.csv', kind: 'upsert', key: { id }, row, label }];
  for (const t of m.ds.txns) {
    const has = m.ds.overrides.get(t.id)?.event_id === id || t.manual?.event_id === id;
    if (ticked.has(t.id) && !has) ops.push(overrideOp(t, { event_id: id }, label));
    if (!ticked.has(t.id) && has) {
      if (t.manual?.event_id === id)
        ops.push({ file: 'manual.csv', kind: 'upsert', key: { id: t.id }, row: { event_id: '' }, label });
      if (m.ds.overrides.get(t.id)?.event_id === id) ops.push(overrideOp(t, { event_id: '' }, label));
    }
  }
  return ops;
}

/** Dismiss: the detector never proposes this range again (DATA_MODEL §7 filter). */
export function dismissTrip(m: Model, d: EventDraft): NewOp[] {
  const { id, row } = eventRow(m, d, 'dismissed', 'detector');
  return [{ file: 'events.csv', kind: 'upsert', key: { id }, row, label: `dismiss trip "${row.name}"` }];
}

export function saveEvent(m: Model, d: EventDraft): NewOp[] {
  const existing = d.id ? m.ds.events.find((e) => e.id === d.id) : undefined;
  const status = (existing?.status as 'proposed' | 'confirmed' | 'dismissed') || 'confirmed';
  const { id, row } = eventRow(m, d, status, 'user');
  return [
    {
      file: 'events.csv',
      kind: 'upsert',
      key: { id },
      row,
      label: `${existing ? 'edit' : 'add'} event "${row.name}"`,
    },
  ];
}

/** Removes an event and every assignment to it. */
export function deleteEvent(m: Model, id: string): NewOp[] {
  const label = 'delete event';
  const ops: NewOp[] = [{ file: 'events.csv', kind: 'delete', key: { id }, label }];
  for (const t of m.ds.txns) {
    if (m.ds.overrides.get(t.id)?.event_id === id) ops.push(overrideOp(t, { event_id: '' }, label));
    if (t.manual?.event_id === id)
      ops.push({ file: 'manual.csv', kind: 'upsert', key: { id: t.id }, row: { event_id: '' }, label });
  }
  return ops;
}

/* ───────────── Budgets and goals (SPEC §4.4) ───────────── */

export interface BudgetDraft {
  scope: 'category' | 'group' | 'total';
  target: string;
  limit: Cents;
  excludeEvents: boolean;
}

/**
 * Set a limit from `month` on (SPEC §4.4): a new row starting that month, or the row that already starts
 * that month is updated. Older rows stay, so past months keep their limits.
 */
export function setBudget(m: Model, d: BudgetDraft, month: string): NewOp[] {
  const same = m.ds.budgets.find(
    (b) => b.scope === d.scope && b.target === d.target && b.start_month === month,
  );
  const id = same?.id ?? `b-${crypto.randomUUID().slice(0, 8)}`;
  const label = `set budget ${d.target}`;
  const ops: NewOp[] = [
    {
      file: 'budgets.csv',
      kind: 'upsert',
      key: { id },
      row: {
        scope: d.scope,
        target: d.target,
        monthly_limit: formatMoneyCsv(Math.abs(d.limit)),
        start_month: month,
        end_month: '',
        exclude_events: d.excludeEvents ? 'true' : 'false',
        notes: same?.notes ?? '',
      },
      label,
    },
  ];
  // a row that started later would hide this one from its start on; it was set for a future month
  for (const b of m.ds.budgets)
    if (b.scope === d.scope && b.target === d.target && b.start_month > month)
      ops.push({ file: 'budgets.csv', kind: 'delete', key: { id: b.id }, label });
  return ops;
}

/** Stop a budget from `month` on: rows that started earlier end the month before; later ones go. */
export function stopBudget(m: Model, scope: string, target: string, month: string): NewOp[] {
  const label = `stop budget ${target}`;
  const prev = addMonths(month, -1);
  const ops: NewOp[] = [];
  for (const b of m.ds.budgets) {
    if (b.scope !== scope || b.target !== target) continue;
    if (b.start_month >= month) ops.push({ file: 'budgets.csv', kind: 'delete', key: { id: b.id }, label });
    else if (!b.end_month || b.end_month >= month)
      ops.push({ file: 'budgets.csv', kind: 'upsert', key: { id: b.id }, row: { end_month: prev }, label });
  }
  return ops;
}

export interface GoalDraft {
  id?: string;
  name: string;
  target: Cents;
  targetDate: string;
  basis: string;
  startDate: string;
  startAmount: Cents;
  notes?: string;
}

export function saveGoal(m: Model, d: GoalDraft): NewOp[] {
  const existing = d.id ? m.ds.goals.find((g) => g.id === d.id) : undefined;
  const id = d.id ?? `g-${crypto.randomUUID().slice(0, 8)}`;
  return [
    {
      file: 'goals.csv',
      kind: 'upsert',
      key: { id },
      row: {
        name: d.name.trim(),
        target_amount: formatMoneyCsv(Math.abs(d.target)),
        target_date: d.targetDate,
        basis: d.basis,
        start_date: d.startDate,
        start_amount: formatMoneyCsv(d.startAmount),
        priority: existing?.priority ?? String(m.ds.goals.length + 1),
        notes: d.notes ?? existing?.notes ?? '',
      },
      label: `${existing ? 'edit' : 'add'} goal "${d.name.trim()}"`,
    },
  ];
}

export const deleteGoal = (id: string): NewOp[] => [
  { file: 'goals.csv', kind: 'delete', key: { id }, label: 'delete goal' },
];
