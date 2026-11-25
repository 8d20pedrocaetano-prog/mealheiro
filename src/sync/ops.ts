/**
 * Pending operations (ARCHITECTURE §4). Every edit is a row-level op on a user-owned file; ops are
 * persisted before the UI updates and re-applied to whatever base the repo has (deterministic merge).
 */
import { mergeHeader, serializeCsv, type CsvTable, type Row } from '../core/csv';
import { fieldsFor, ROOT_FILES, TXN_FIELDS, TXN_PATH_RE, type RootFile } from '../core/schema';

export interface Op {
  id: string;
  file: RootFile;
  /**
   * `import` (M5): append statement rows to `transactions/**` and log the file in `imports.csv`
   * (file = imports.csv, key = { id }, row = the import row, txns = the rows). Append-only, see applyImport.
   */
  kind: 'upsert' | 'delete' | 'import';
  /** Key columns → values, e.g. { txn_id: 'abc' } or { date, account_id }. */
  key: Record<string, string>;
  /** Fields to set (a patch: other columns of an existing row are kept). */
  row?: Row;
  at: string;
  /** Human label for the commit message, e.g. "recategorise 1 transaction". */
  label: string;
  /** `import` only: rows in the transactions schema, oldest first, statement order. */
  txns?: Row[];
}

export const txnPath = (bookingDate: string) =>
  `transactions/${bookingDate.slice(0, 4)}/${bookingDate.slice(0, 7)}.csv`;

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

/**
 * The in-app import, applied to whatever base the repo has now (so an ingest session that pushed the same
 * statement first wins, and nothing is added twice). Mirrors `mh.py ingest`:
 * - a file whose sha256 is already in imports.csv adds nothing;
 * - rows whose id already exists are skipped;
 * - new rows go into their booking month file, stable-sorted on booking_date (existing rows first, then
 *   new rows in statement order), which keeps the balance chain in file order. Existing rows are never
 *   changed (DATA_MODEL §2: transactions are append-only).
 * Returns the paths it changed.
 */
export function applyImport(out: Map<string, CsvTable>, op: Op): string[] {
  const imports = out.get('imports.csv');
  const sha = op.row?.file_sha256;
  if (imports?.rows.some((r) => r.id === op.key.id || (sha && r.file_sha256 === sha))) return [];
  const existing = new Set<string>();
  for (const [path, t] of out) if (TXN_PATH_RE.test(path)) for (const r of t.rows) existing.add(r.id);
  const byPath = new Map<string, Row[]>();
  for (const r of op.txns ?? []) {
    if (existing.has(r.id)) continue;
    existing.add(r.id);
    const path = txnPath(r.booking_date);
    let a = byPath.get(path);
    if (!a) byPath.set(path, (a = []));
    a.push(r);
  }
  let added = 0;
  for (const [path, rows] of byPath) {
    const old = out.get(path);
    const header = mergeHeader(TXN_FIELDS, old?.header ?? []);
    const fresh = rows.map((r) => {
      const full: Row = {};
      for (const h of header) full[h] = r[h] ?? '';
      return full;
    });
    // Array.prototype.sort is stable: old rows keep their order, new rows follow within a day.
    const merged = [...(old?.rows ?? []), ...fresh].sort((a, b) =>
      a.booking_date < b.booking_date ? -1 : a.booking_date > b.booking_date ? 1 : 0,
    );
    out.set(path, { header, rows: merged });
    added += fresh.length;
  }
  const inFile = Number(op.row?.rows_in_file ?? op.txns?.length ?? 0);
  const row = { ...op.row, rows_added: String(added), rows_duplicate: String(inFile - added) };
  out.set('imports.csv', applyOp(imports, { ...op, kind: 'upsert', row }));
  return [...byPath.keys(), 'imports.csv'];
}

/** Copy-on-write: only tables touched by ops are replaced. */
export function applyOps(tables: Map<string, CsvTable>, ops: Op[]): Map<string, CsvTable> {
  if (!ops.length) return tables;
  const out = new Map(tables);
  for (const op of ops) {
    if (op.kind === 'import') applyImport(out, op);
    else out.set(op.file, applyOp(out.get(op.file), op));
  }
  return out;
}

export function serializeTable(table: CsvTable, file: RootFile): string {
  return serializeCsv(mergeHeader(ROOT_FILES[file].fields, table.header), table.rows);
}

/** Any data file (root files and transaction months), keeping unknown columns. */
export function serializePath(table: CsvTable, path: string): string {
  const known = fieldsFor(path);
  if (!known) throw new Error(`not a data file: ${path}`);
  return serializeCsv(mergeHeader(known, table.header), table.rows);
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
