/**
 * PayPal activity CSV, used to enrich (IMPORT_FORMATS §4): each CGD `PayPal Europe S a r l` outflow is
 * matched to a PayPal payment with the same amount within ±3 days, which names the real merchant and lets
 * the rules suggest a category. It never adds spending.
 */
import Papa from 'papaparse';
import { firstMatchingRule } from '../core/categorize';
import type { DataSet, Txn } from '../core/dataset';
import { dayNum } from '../core/dates';
import { parseMoney, type Cents } from '../core/money';
import { norm } from '../core/normalize';
import { ImportError } from './statement';

export interface PaypalPayment {
  date: string;
  name: string;
  /** Positive cents paid out. */
  amount: Cents;
  currency: string;
  ref: string;
}

const COLS = {
  date: ['Date', 'Data'],
  name: ['Name', 'Nome'],
  gross: ['Gross', 'Bruto', 'Valor bruto'],
  currency: ['Currency', 'Moeda'],
  ref: ['Transaction ID', 'ID da transação', 'ID de transação', 'Código da transação'],
  status: ['Status', 'Estado'],
} as const;

const pick = (header: string[], names: readonly string[]) => header.find((h) => names.includes(h.trim()));

export function looksLikePaypal(header: string[]): boolean {
  return !!(pick(header, COLS.date) && pick(header, COLS.name) && pick(header, COLS.gross));
}

/** `-1.234,56`, `-1,234.56`, `-23.99` or `-23,99` → cents; the last separator is the decimal one. */
export function looseMoney(s: string): Cents {
  const t = s.replace(/\s|\u00a0/g, '');
  const dec = Math.max(t.lastIndexOf(','), t.lastIndexOf('.'));
  const digitsAfter = dec >= 0 ? t.length - dec - 1 : 0;
  if (dec >= 0 && digitsAfter > 0 && digitsAfter <= 2) {
    return parseMoney(t.slice(0, dec).replace(/[.,]/g, '') + '.' + t.slice(dec + 1));
  }
  return parseMoney(t.replace(/[.,]/g, ''));
}

/** `dd/mm/yyyy` (European accounts), `dd.mm.yyyy` or `yyyy-mm-dd`. */
function isoDate(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/.exec(t);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

export function parsePaypal(text: string): PaypalPayment[] {
  const res = Papa.parse<Record<string, string>>(text.replace(/^\uFEFF/, ''), {
    header: true,
    skipEmptyLines: true,
  });
  const header = res.meta.fields ?? [];
  if (!looksLikePaypal(header))
    throw new ImportError('Not a PayPal activity CSV: no Date, Name and Gross columns.');
  const c = {
    date: pick(header, COLS.date)!,
    name: pick(header, COLS.name)!,
    gross: pick(header, COLS.gross)!,
    currency: pick(header, COLS.currency),
    ref: pick(header, COLS.ref),
    status: pick(header, COLS.status),
  };
  const out: PaypalPayment[] = [];
  for (const r of res.data) {
    const name = (r[c.name] ?? '').trim();
    const date = isoDate(r[c.date] ?? '');
    if (!name || !date) continue;
    const status = c.status ? (r[c.status] ?? '').toLowerCase() : '';
    if (status && !/(completed|conclu)/.test(status)) continue;
    let gross: Cents;
    try {
      gross = looseMoney(r[c.gross] ?? '');
    } catch {
      continue;
    }
    if (gross >= 0) continue;
    out.push({
      date,
      name,
      amount: -gross,
      currency: (c.currency ? r[c.currency] : 'EUR')?.trim().toUpperCase() || 'EUR',
      ref: c.ref ? (r[c.ref] ?? '').trim() : '',
    });
  }
  return out;
}

export interface PaypalMatch {
  txn: Txn;
  payment: PaypalPayment;
  /** Category the rules give the PayPal name, if any. */
  suggested: string | null;
  /** The owner already chose a category for this transaction (left alone by default). */
  decided: boolean;
}

export const isPaypalOutflow = (t: Txn) => t.amount < 0 && t.descNorm.startsWith('PAYPAL EUROPE');

/** Greedy one-to-one matching, closest date first. */
export function matchPaypal(ds: DataSet, payments: PaypalPayment[]) {
  const eur = payments.filter((p) => p.currency === 'EUR');
  const from = eur.reduce((a, p) => (p.date < a ? p.date : a), '9999');
  const to = eur.reduce((a, p) => (p.date > a ? p.date : a), '0000');
  const cgd = ds.txns.filter((t) => !t.manual && isPaypalOutflow(t));
  const pairs: { t: Txn; p: PaypalPayment; d: number }[] = [];
  for (const t of cgd)
    for (const p of eur) {
      const d = Math.abs(dayNum(t.value_date) - dayNum(p.date));
      if (p.amount === -t.amount && d <= 3) pairs.push({ t, p, d });
    }
  pairs.sort((a, b) => a.d - b.d);
  const usedT = new Set<string>();
  const usedP = new Set<PaypalPayment>();
  const matches: PaypalMatch[] = [];
  for (const { t, p } of pairs) {
    if (usedT.has(t.id) || usedP.has(p)) continue;
    usedT.add(t.id);
    usedP.add(p);
    const rule = firstMatchingRule(ds, { ...t, descNorm: norm(p.name) });
    const o = ds.overrides.get(t.id);
    matches.push({ txn: t, payment: p, suggested: rule?.row.category_id ?? null, decided: !!o?.category_id });
  }
  matches.sort((a, b) => (a.txn.value_date < b.txn.value_date ? 1 : -1));
  const unmatched = cgd.filter((t) => !usedT.has(t.id) && t.value_date >= from && t.value_date <= to);
  return { matches, unmatched, foreign: payments.length - eur.length };
}
