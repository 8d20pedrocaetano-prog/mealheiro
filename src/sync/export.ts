/**
 * "Export everything" (SPEC §4.9): the data repo's files as this device sees them, including edits that
 * are still waiting to sync, as one ZIP of CSVs (plus settings.json).
 */
import type { CsvTable } from '../core/csv';
import type { FileMap } from '../core/dataset';
import { zipStore } from '../core/zip';
import { applyOps, serializePath, type Op } from './ops';

/** Base files with pending ops applied; files no op touched are passed through byte for byte. */
export function effectiveFiles(files: FileMap, base: Map<string, CsvTable>, ops: Op[]): FileMap {
  const tables = applyOps(base, ops);
  const out: FileMap = { ...files };
  for (const [path, t] of tables) if (t !== base.get(path)) out[path] = serializePath(t, path);
  return out;
}

const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function exportZip(files: FileMap, now: Date): { name: string; bytes: Uint8Array<ArrayBuffer> } {
  const folder = `mealheiro-data-${stamp(now)}`;
  const paths = Object.keys(files).sort();
  return {
    name: `${folder}.zip`,
    bytes: zipStore(
      paths.map((p) => ({ name: `${folder}/${p}`, data: files[p] })),
      now,
    ),
  };
}
