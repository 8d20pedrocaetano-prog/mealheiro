import Papa from 'papaparse';

/** A CSV row: every value is a string; empty string = not set (DATA_MODEL §2). */
export type Row = Record<string, string>;

export interface CsvTable {
  /** Column order as found in the file (unknown columns included, so they survive a rewrite). */
  header: string[];
  rows: Row[];
}

/**
 * Parses RFC 4180 CSV with a header row. Mirrors Python's csv.DictReader as used by mh.py:
 * blank lines are skipped, short rows are padded with empty strings, extra cells are dropped.
 */
export function parseCsv(text: string): CsvTable {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (src.trim() === '') return { header: [], rows: [] };
  const res = Papa.parse<string[]>(src, { header: false, skipEmptyLines: true, delimiter: ',' });
  const data = res.data;
  const header = data[0] ?? [];
  const rows: Row[] = [];
  for (let i = 1; i < data.length; i++) {
    const cells = data[i];
    const row: Row = {};
    for (let j = 0; j < header.length; j++) row[header[j]] = cells[j] ?? '';
    rows.push(row);
  }
  return { header, rows };
}

function quote(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * Serialises like Python's csv.DictWriter(lineterminator="\n", QUOTE_MINIMAL): header row, `\n`
 * line endings, quotes only where needed. Byte-identical output keeps git diffs minimal when the
 * app rewrites a file the ingest session wrote.
 */
export function serializeCsv(header: string[], rows: Row[]): string {
  let out = header.map(quote).join(',') + '\n';
  for (const r of rows) out += header.map((h) => quote(r[h] ?? '')).join(',') + '\n';
  return out;
}

/** Known columns in schema order, then any unknown columns from the file in their original order. */
export function mergeHeader(known: readonly string[], existing: readonly string[]): string[] {
  const out = [...known];
  for (const h of existing) if (!out.includes(h)) out.push(h);
  return out;
}
