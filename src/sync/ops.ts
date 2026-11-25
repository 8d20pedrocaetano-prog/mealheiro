/**
 * Pending operations (ARCHITECTURE §4). Every edit is a row-level op on a user-owned file; ops are
 * persisted before the UI updates and re-applied to whatever base the repo has (deterministic merge).
 */
import { mergeHeader, serializeCsv, type CsvTable, type Row } from '../core/csv';
import { ROOT_FILES, type RootFile } from '../core/schema';

export interface Op {
  id: string;
  file: RootFile;
  kind: 'upsert' | 'delete';
  /** Key columns → values, e.g. { txn_id: 'abc' } or { date, account_id }. */
  key: Record<string, string>;
  /** Fields to set (a patch: other columns of an existing row are kept). */
  row?: Row;
  at: string;
  /** Human label for the commit message, e.g. "recategorise 1 transaction". */
  label: string;
}

const matches = (r: Row, key: Record<string, string>) => Object.entries(key).every(([k, v]) => r[k] === v);

export function applyOp(table: CsvTable | undefined, op: Op): CsvTable {
  const known = ROOT_FILES[op.file].fields;
  const header = mergeHeader(known, table?.header ?? []);
  const rows = [...(table?.rows ?? [])];
  if (op.kind === 'delete') {
    return { header, rows: rows.filter((r) => !matches(r, op.key)) };
  }
  const i = rows.findIndex((r) => matches(r, op.key));
  if (i >= 0) {
    rows[i] = { ...rows[i], ...op.row, ...op.key };
  } else {
    const fresh: Row = {};
    for (const h of header) fresh[h] = '';
    rows.push({ ...fresh, ...op.row, ...op.key });
  }
  return { header, rows };
}

/** Copy-on-write: only tables touched by ops are replaced. */
export function applyOps(tables: Map<string, CsvTable>, ops: Op[]): Map<string, CsvTable> {
  if (!ops.length) return tables;
  const out = new Map(tables);
  for (const op of ops) out.set(op.file, applyOp(out.get(op.file), op));
  return out;
}

export function serializeTable(table: CsvTable, file: RootFile): string {
  return serializeCsv(mergeHeader(ROOT_FILES[file].fields, table.header), table.rows);
}

/** One commit message for a batch of ops (ARCHITECTURE §4), with a Device trailer. */
export function commitMessage(ops: Op[], device: 'phone' | 'desktop'): string {
  const counts = new Map<string, number>();
  for (const o of ops) counts.set(o.label, (counts.get(o.label) ?? 0) + 1);
  const parts = [...counts.entries()].map(([label, n]) => (n > 1 ? `${label} (×${n})` : label));
  const subject = `app: ${parts.slice(0, 3).join(', ')}${parts.length > 3 ? `, +${parts.length - 3} more` : ''}`;
  return `${subject}\n\nDevice: ${device}`;
}

export function newId(prefix = ''): string {
  return prefix + crypto.randomUUID();
}
