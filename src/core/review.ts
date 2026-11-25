/**
 * The review inbox (SPEC §4.6): things that need the owner, one card at a time. Event proposals
 * come in M4 and PayPal unknowns in M5.
 *
 * Without a column for "dismissed", a card stays answered through the owner's own data: setting a
 * category by hand (an override) answers "is this a payback?", "pass-through?" and the cash card.
 */
import { addDays } from './dates';
import type { DataSet, Txn } from './dataset';
import type { Model } from './model';
import type { Cents } from './money';
import { effOf } from './view';

export const PEOPLE_CATEGORIES = new Set(['people-in', 'people-out']);
export const CASH_CATEGORY = 'cash-withdrawal';

export type ReviewCard =
  | { type: 'uncategorised'; id: string; txn: Txn; suggestion: string | null }
  | {
      type: 'person';
      id: string;
      /** The normalised description shared by every transaction in the group. */
      key: string;
      direction: 'in' | 'out';
      txns: Txn[];
      total: Cents;
      categoryId: string;
    }
  | { type: 'payback'; id: string; incoming: Txn; expense: Txn }
  | { type: 'pass-through'; id: string; incoming: Txn; outgoing: Txn }
  | { type: 'cash'; id: string; txn: Txn; unlinked: Txn[] };

/** Cash cards are optional: they never count towards the badge or block "inbox clear". */
export const countsForBadge = (c: ReviewCard) => c.type !== 'cash';

const hasCategoryOverride = (ds: DataSet, t: Txn) => !!ds.overrides.get(t.id)?.category_id;

export function needsCategory(m: Model, t: Txn): boolean {
  const e = effOf(m.view, t);
  return e.source === 'none' || (e.source.startsWith('suggested:') && !t.manual);
}

/** Withdrawals in the latest import of each account (SPEC §4.6 card 7). */
function latestImportIds(ds: DataSet): Set<string> {
  const latest = new Map<string, { id: string; at: string }>();
  for (const i of ds.imports) {
    const cur = latest.get(i.account_id);
    if (!cur || i.imported_at > cur.at) latest.set(i.account_id, { id: i.id, at: i.imported_at });
  }
  return new Set([...latest.values()].map((x) => x.id));
}

/** Cash entries on the withdrawal's account, not linked to anything, dated from the day to 7 days later. */
export function unlinkedCashEntries(m: Model, withdrawal: Txn): Txn[] {
  const acct = m.ds.categories.get(CASH_CATEGORY)?.counterparty_account || 'cash';
  const until = addDays(withdrawal.value_date, 7);
  return m.ds.txns.filter(
    (t) =>
      t.manual &&
      t.account_id === acct &&
      !t.manual.linked_txn_id &&
      t.value_date >= withdrawal.value_date &&
      t.value_date <= until,
  );
}

export function itemisedFor(m: Model, withdrawal: Txn): Txn[] {
  return m.ds.txns.filter((t) => t.manual?.linked_txn_id === withdrawal.id);
}

export function reviewCards(m: Model): ReviewCard[] {
  const { ds } = m;
  const cards: ReviewCard[] = [];

  // 1. Uncategorised (or only suggested)
  for (const t of ds.txns) {
    if (!needsCategory(m, t)) continue;
    const e = effOf(m.view, t);
    cards.push({
      type: 'uncategorised',
      id: `u:${t.id}`,
      txn: t,
      suggestion: e.source.startsWith('suggested:') ? e.categoryId : null,
    });
  }

  // 2. Who is this? People reached only by a generic seed rule, grouped by description and direction
  const people = new Map<string, Txn[]>();
  for (const t of ds.txns) {
    if (t.manual || hasCategoryOverride(ds, t)) continue;
    const e = effOf(m.view, t);
    if (!PEOPLE_CATEGORIES.has(e.categoryId) || !e.source.startsWith('rule:')) continue;
    const rule = ds.rules.find((r) => r.row.id === e.ruleId);
    if (!rule || rule.row.source !== 'seed') continue;
    const k = `${t.amount > 0 ? 'in' : 'out'}|${t.descNorm}`;
    let a = people.get(k);
    if (!a) people.set(k, (a = []));
    a.push(t);
  }
  for (const [k, txns] of [...people.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const [direction, key] = k.split('|') as ['in' | 'out', string];
    cards.push({
      type: 'person',
      id: `p:${k}`,
      key,
      direction,
      txns,
      total: txns.reduce((s, t) => s + t.amount, 0),
      categoryId: effOf(m.view, txns[0]).categoryId,
    });
  }

  // 3–4. Paybacks and pass-throughs the owner hasn't answered
  for (const p of m.pairs) {
    if (hasCategoryOverride(ds, p.incoming) || ds.overrides.get(p.incoming.id)?.reimburses_txn_id) continue;
    if (p.type === 'payback') {
      cards.push({ type: 'payback', id: `b:${p.incoming.id}`, incoming: p.incoming, expense: p.other });
    } else if (!hasCategoryOverride(ds, p.other)) {
      cards.push({ type: 'pass-through', id: `t:${p.incoming.id}`, incoming: p.incoming, outgoing: p.other });
    }
  }

  // 7. Cash (optional): withdrawals from the latest import, not itemised, not skipped
  const latest = latestImportIds(ds);
  for (const t of ds.txns) {
    if (t.manual || !latest.has(t.import_id) || t.amount >= 0) continue;
    if (effOf(m.view, t).categoryId !== CASH_CATEGORY || hasCategoryOverride(ds, t)) continue;
    if (itemisedFor(m, t).length) continue;
    cards.push({ type: 'cash', id: `c:${t.id}`, txn: t, unlinked: unlinkedCashEntries(m, t) });
  }
  return cards;
}
