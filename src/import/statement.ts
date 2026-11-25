/**
 * What every importer produces (IMPORT_FORMATS intro): rows in the `transactions` schema with ids per
 * DATA_MODEL §4, plus what the statement says about itself. Pure TS, no DOM.
 */
import { formatMoneyCsv, type Cents } from '../core/money';

export interface StatementRow {
  id: string;
  account_id: string;
  booking_date: string;
  value_date: string;
  description_raw: string;
  amount: Cents;
  currency: string;
  /** Running balance after the row; null when the source has none. */
  balance_after: Cents | null;
  /** Optional suggestion the importer can make (e.g. Revolut fees → bank-fees). */
  category_suggested?: string;
}

export interface ParsedStatement {
  sourceType: 'cgd-pdf' | 'revolut-csv';
  account: string;
  /** Oldest first, statement order within a day. */
  rows: StatementRow[];
  /** From the statement header; empty when it has none (the preview falls back to the rows). */
  periodStart: string;
  periodEnd: string;
  closingBalance: Cents | null;
  /** Balance chain / closing balance failures. Any error aborts the import (DATA_MODEL §4). */
  errors: string[];
  /** Rows left out on purpose, with why (e.g. Revolut rows still pending). Shown in the preview. */
  skipped: { reason: string; count: number }[];
}

export class ImportError extends Error {}

/** `sha1(...)[:16]` hex, async (Web Crypto works in the browser, workers and Node). */
export async function sha1Hex16(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

type Unidentified = Omit<StatementRow, 'id'>;

/**
 * DATA_MODEL §4: `sha1("{account}|{booking}|{value}|{description}|{amount}|{balance}|{n}")[:16]`, where n
 * counts identical prefixes within the same statement, so re-importing an overlapping statement gives
 * the same ids.
 */
export async function assignIds(rows: Unidentified[]): Promise<StatementRow[]> {
  const seen = new Map<string, number>();
  const out: StatementRow[] = [];
  for (const r of rows) {
    const bal = r.balance_after === null ? '' : formatMoneyCsv(r.balance_after);
    const base = `${r.account_id}|${r.booking_date}|${r.value_date}|${r.description_raw}|${formatMoneyCsv(r.amount)}|${bal}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.push({ ...r, id: await sha1Hex16(`${base}|${n}`) });
  }
  return out;
}

/** Balance chain in statement order (DATA_MODEL §4): previous balance + amount = balance. */
export function chainErrors(
  rows: Pick<StatementRow, 'amount' | 'balance_after' | 'booking_date' | 'description_raw'>[],
): string[] {
  const errors: string[] = [];
  let prev: Cents | null = null;
  rows.forEach((r, i) => {
    if (r.balance_after === null) return;
    if (prev !== null && prev + r.amount !== r.balance_after) {
      errors.push(
        `Balance chain broken at row ${i + 1} (${r.booking_date}): ${formatMoneyCsv(prev)} + ${formatMoneyCsv(r.amount)} ≠ ${formatMoneyCsv(r.balance_after)}`,
      );
    }
    prev = r.balance_after;
  });
  return errors;
}
