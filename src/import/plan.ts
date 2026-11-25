/**
 * Import preview and the op that commits it (SPEC §4.8, M5): new vs duplicate rows, the checks, and how
 * many new rows no rule covers. Same dedup and continuity rules as `mh.py ingest` (DATA_MODEL §4).
 */
import type { Row } from '../core/csv';
import { firstMatchingRule } from '../core/categorize';
import { norm } from '../core/normalize';
import type { DataSet, Txn } from '../core/dataset';
import { formatMoneyCsv, tryParseMoney } from '../core/money';
import type { ImportRow } from '../core/schema';
import type { Op } from '../sync/ops';
import type { ParsedStatement, StatementRow } from './statement';

export interface ImportPlan {
  statement: ParsedStatement;
  fileName: string;
  sha256: string;
  /** The same file (by sha256) was imported before: nothing to do. */
  alreadyImported: ImportRow | null;
  newRows: StatementRow[];
  duplicates: number;
  /** "Missing transactions?" warning from the continuity check, or null. */
  gap: string | null;
  /** New rows that no rule matches and that carry no suggestion: they will land in Review. */
  needCategory: number;
  /** First and last booking date of the rows (for statements whose header has no period). */
  from: string;
  to: string;
}

const asTxn = (r: StatementRow): Txn => ({
  id: r.id,
  account_id: r.account_id,
  booking_date: r.booking_date,
  value_date: r.value_date,
  description_raw: r.description_raw,
  amountStr: formatMoneyCsv(r.amount),
  amount: r.amount,
  currency: r.currency,
  balance_after: r.balance_after === null ? '' : formatMoneyCsv(r.balance_after),
  import_id: '',
  category_suggested: r.category_suggested ?? '',
  suggested_by: '',
  review_note: '',
  descNorm: norm(r.description_raw),
});

export function planImport(
  ds: DataSet,
  parsed: ParsedStatement,
  file: { name: string; sha256: string },
): ImportPlan {
  // An importer's suggestion only stands if the category exists in this repo.
  const s: ParsedStatement = {
    ...parsed,
    rows: parsed.rows.map((r) =>
      r.category_suggested && !ds.categories.has(r.category_suggested)
        ? { ...r, category_suggested: undefined }
        : r,
    ),
  };
  const alreadyImported = ds.imports.find((i) => i.file_sha256 === file.sha256) ?? null;
  const existing = new Set(ds.txns.map((t) => t.id));
  const newRows = s.rows.filter((r) => !existing.has(r.id));

  // Continuity (DATA_MODEL §4 gap check): the first new row's opening balance should be the closing
  // balance of one of the last 30 rows we already have on or before that day.
  let gap: string | null = null;
  const first = newRows[0];
  if (first && first.balance_after !== null) {
    const acct = ds.txns.filter((t) => !t.manual && t.account_id === s.account && t.balance_after !== '');
    const opening = first.balance_after - first.amount;
    const before = acct.filter((t) => t.booking_date <= first.booking_date);
    if (before.length && !before.slice(-30).some((t) => tryParseMoney(t.balance_after) === opening)) {
      gap = `GAP? opening balance ${formatMoneyCsv(opening)} of first new row (${first.booking_date}) matches no earlier closing balance`;
    }
  }
  const needCategory = newRows.filter(
    (r) => !r.category_suggested && !firstMatchingRule(ds, asTxn(r)),
  ).length;
  return {
    statement: s,
    fileName: file.name,
    sha256: file.sha256,
    alreadyImported,
    newRows,
    duplicates: s.rows.length - newRows.length,
    gap,
    needCategory,
    from: s.rows[0]?.booking_date ?? '',
    to: s.rows[s.rows.length - 1]?.booking_date ?? '',
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `imp-YYYYMMDD-HHMMSS` in local time, like mh.py. */
export function importId(now: Date): string {
  return `imp-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(
    now.getMinutes(),
  )}${pad(now.getSeconds())}`;
}

export function localTimestamp(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(
    now.getMinutes(),
  )}:${pad(now.getSeconds())}`;
}

/**
 * The pending op for an import. All rows of the file travel with it (not only the new ones), so that
 * re-applied on a newer base (an ingest session pushed meanwhile) the dedup is decided then.
 */
export function importOp(plan: ImportPlan, by: string, now: Date): Omit<Op, 'id' | 'at'> {
  const s = plan.statement;
  const id = importId(now);
  const txns: Row[] = s.rows.map((r) => ({
    id: r.id,
    account_id: r.account_id,
    booking_date: r.booking_date,
    value_date: r.value_date,
    description_raw: r.description_raw,
    amount: formatMoneyCsv(r.amount),
    currency: r.currency,
    balance_after: r.balance_after === null ? '' : formatMoneyCsv(r.balance_after),
    import_id: id,
    category_suggested: r.category_suggested ?? '',
    suggested_by: r.category_suggested ? 'import' : '',
    review_note: '',
  }));
  const row: Row = {
    imported_at: localTimestamp(now),
    account_id: s.account,
    source_type: s.sourceType,
    file_name: plan.fileName,
    file_sha256: plan.sha256,
    period_start: s.periodStart,
    period_end: s.periodEnd,
    rows_in_file: String(s.rows.length),
    rows_added: String(plan.newRows.length),
    rows_duplicate: String(plan.duplicates),
    closing_balance: s.closingBalance === null ? '' : formatMoneyCsv(s.closingBalance),
    checks: 'ok' + (plan.gap ? '; ' + plan.gap : ''),
    by,
  };
  return {
    file: 'imports.csv',
    kind: 'import',
    key: { id },
    row,
    txns,
    label: `import ${plan.newRows.length} transaction${plan.newRows.length === 1 ? '' : 's'}`,
  };
}
