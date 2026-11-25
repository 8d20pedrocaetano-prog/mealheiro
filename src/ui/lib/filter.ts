/**
 * Activity filters, so every total can link to exactly the transactions behind it (SPEC principle 1).
 * Ids, dates and kinds go in the URL (shareable between tabs, survive a reload). Anything that can carry a
 * description or an amount (merchant, search text, the label) goes in `history.state` instead, which is
 * never sent to a server or synced with browser history (ARCHITECTURE §7: no amounts or descriptions in URLs).
 */
import type { NavigateFunction } from 'react-router-dom';
import type { Line } from '../../core/aggregates';
import type { Txn } from '../../core/dataset';
import type { Model } from '../../core/model';
import { parseUserAmount, type Cents } from '../../core/money';
import { effOf } from '../../core/view';
import { assignedEventId } from '../../core/events';
import { formatEUR } from './format';

export interface TxnFilter {
  /** `YYYY-MM-DD` inclusive range on value date. */
  from?: string;
  to?: string;
  /**
   * expense | income: transactions with a reporting line of that kind (what Spent / Income sum);
   * reporting: every reporting line (Saved); transfer: neutral transfers.
   */
  kind?: 'expense' | 'income' | 'reporting' | 'transfer';
  group?: string;
  cat?: string;
  acct?: string;
  event?: string;
  merchant?: string;
  review?: boolean;
  note?: boolean;
  /** Exclude confirmed-trip members (budgets with exclude_events). */
  notrips?: boolean;
  /** Gross view: only negative expense lines. */
  gross?: boolean;
  q?: string;
  /** Label for the active filter shown above the list (e.g. "Spent · October 2026"). */
  label?: string;
}

const URL_KEYS = [
  'from',
  'to',
  'kind',
  'group',
  'cat',
  'acct',
  'event',
  'review',
  'note',
  'notrips',
  'gross',
] as const;
const PRIVATE_KEYS = ['merchant', 'q', 'label'] as const;
const KEYS = [...URL_KEYS, ...PRIVATE_KEYS];

export type PrivateFilter = Partial<Pick<TxnFilter, (typeof PRIVATE_KEYS)[number]>>;
/** What Activity keeps in `history.state`. */
export interface ActivityState {
  pf?: PrivateFilter;
}

export function parseFilter(sp: URLSearchParams, state?: unknown): TxnFilter {
  const f: TxnFilter = {};
  for (const k of URL_KEYS) {
    const v = sp.get(k);
    if (v === null || v === '') continue;
    if (k === 'review' || k === 'note' || k === 'notrips' || k === 'gross') f[k] = v === '1';
    else (f as Record<string, string>)[k] = v;
  }
  const pf = (state as ActivityState | null | undefined)?.pf;
  if (pf && typeof pf === 'object')
    for (const k of PRIVATE_KEYS) if (typeof pf[k] === 'string' && pf[k]) f[k] = pf[k];
  return f;
}

/** The query string part of a filter: ids, dates and flags only. */
export function filterSearch(f: TxnFilter): string {
  const sp = new URLSearchParams();
  for (const k of URL_KEYS) {
    const v = f[k];
    if (v === undefined || v === '' || v === false) continue;
    sp.set(k, v === true ? '1' : String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/** The `history.state` part of a filter. */
export function filterState(f: TxnFilter): ActivityState | null {
  const pf: PrivateFilter = {};
  for (const k of PRIVATE_KEYS) if (f[k]) pf[k] = f[k];
  return Object.keys(pf).length ? { pf } : null;
}

export interface ActivityLink {
  to: string;
  state: ActivityState | null;
}

/** Spread onto a `<Link>`: `<Link {...activityHref(f)}>`. */
export function activityHref(f: TxnFilter): ActivityLink {
  return { to: `/activity${filterSearch(f)}`, state: filterState(f) };
}

export function openActivity(navigate: NavigateFunction, f: TxnFilter): void {
  const l = activityHref(f);
  void navigate(l.to, { state: l.state });
}

export function monthRangeFilter(month: string): Pick<TxnFilter, 'from' | 'to'> {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

export function noteOf(t: Txn, m: Model): string {
  return m.ds.overrides.get(t.id)?.note || t.manual?.note || '';
}

export function needsReview(m: Model, t: Txn): boolean {
  const e = effOf(m.view, t);
  return e.source === 'none' || (e.source.startsWith('suggested:') && !t.manual);
}

function matchesQuery(m: Model, t: Txn, q: string): boolean {
  const amount = parseUserAmount(q);
  if (amount !== null && /^[-−]?[\d.,]+$/.test(q.trim())) {
    const abs = Math.abs(t.amount);
    if (abs === Math.abs(amount)) return true;
    return formatEUR(abs, { bare: true }).startsWith(q.trim().replace(/^[-−]/, ''));
  }
  const needle = q.trim().toUpperCase();
  const e = effOf(m.view, t);
  const cat = m.ds.categories.get(e.categoryId)?.name ?? '';
  return [e.merchant, t.description_raw, t.descNorm, noteOf(t, m), cat].some((s) =>
    s.toUpperCase().includes(needle),
  );
}

export interface FilterResult {
  txns: Txn[];
  /** The reporting lines that matched (for totals); empty when the filter is not line-based. */
  lines: Line[];
  /** Contribution per transaction id when it differs from its amount (offsets, excluded, transfers). */
  contribution: Map<string, Cents>;
  lineBased: boolean;
}

const lineFilterKeys = (f: TxnFilter) => !!(f.kind && f.kind !== 'transfer') || !!f.group || !!f.cat;

export function applyFilter(m: Model, f: TxnFilter): FilterResult {
  const inRange = (d: string) => (!f.from || d >= f.from) && (!f.to || d <= f.to);
  const txnOk = (t: Txn) => {
    if (!inRange(t.value_date)) return false;
    if (f.acct && t.account_id !== f.acct) return false;
    if (f.event && assignedEventId(m.view, t) !== f.event) return false;
    if (f.merchant && effOf(m.view, t).merchant !== f.merchant) return false;
    if (f.review && !needsReview(m, t)) return false;
    if (f.note && !noteOf(t, m)) return false;
    if (f.kind === 'transfer' && effOf(m.view, t).kind !== 'transfer') return false;
    if (f.q && !matchesQuery(m, t, f.q)) return false;
    return true;
  };

  if (lineFilterKeys(f)) {
    let tripMembers: Set<string> | null = null;
    if (f.notrips) {
      const confirmed = new Set(
        m.ds.events
          .filter((e) => (e.type === 'trip' || e.type === 'work-trip') && e.status === 'confirmed')
          .map((e) => e.id),
      );
      tripMembers = new Set(
        m.ds.txns.filter((t) => confirmed.has(assignedEventId(m.view, t))).map((t) => t.id),
      );
    }
    const lines = m.lines.filter(
      (l) =>
        (f.kind === 'reporting' || !f.kind || l.kind === f.kind) &&
        (!f.group || l.group === f.group) &&
        (!f.cat || l.reportCategory === f.cat) &&
        (!f.gross || (l.kind === 'expense' && (l.offset || l.amount < 0))) &&
        (!tripMembers || !tripMembers.has(l.txn.id)) &&
        txnOk(l.txn),
    );
    const contribution = new Map<string, Cents>();
    const seen = new Set<string>();
    const txns: Txn[] = [];
    for (const l of lines) {
      contribution.set(l.txn.id, (contribution.get(l.txn.id) ?? 0) + l.amount);
      if (!seen.has(l.txn.id)) {
        seen.add(l.txn.id);
        txns.push(l.txn);
      }
    }
    return { txns, lines, contribution, lineBased: true };
  }

  const txns = m.ds.txns.filter(txnOk);
  const ids = new Set(txns.map((t) => t.id));
  const lines = m.lines.filter((l) => ids.has(l.txn.id));
  const contribution = new Map<string, Cents>();
  for (const l of lines) contribution.set(l.txn.id, (contribution.get(l.txn.id) ?? 0) + l.amount);
  return { txns, lines, contribution, lineBased: false };
}

export function isEmptyFilter(f: TxnFilter): boolean {
  return KEYS.every((k) => k === 'label' || f[k] === undefined || f[k] === false || f[k] === '');
}
