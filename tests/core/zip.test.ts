/** Store-only ZIP writer and "export everything" (SPEC §4.9, M6). */
import { crc32 as zlibCrc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseTables } from '../../src/core/dataset';
import { crc32, zipStore } from '../../src/core/zip';
import { effectiveFiles, exportZip } from '../../src/sync/export';
import type { Op } from '../../src/sync/ops';
import { loadDemoFiles } from '../helpers/fixtures';

/** Reads a stored-only ZIP back through its central directory, checking every CRC. */
function unzip(buf: Uint8Array): Record<string, string> {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const dec = new TextDecoder();
  const eocd = buf.length - 22;
  expect(v.getUint32(eocd, true)).toBe(0x06054b50);
  const n = v.getUint16(eocd + 10, true);
  const cdSize = v.getUint32(eocd + 12, true);
  let p = v.getUint32(eocd + 16, true);
  expect(p + cdSize).toBe(eocd);
  const out: Record<string, string> = {};
  for (let i = 0; i < n; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50);
    const crc = v.getUint32(p + 16, true);
    const size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    expect(v.getUint32(local, true)).toBe(0x04034b50);
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const data = buf.subarray(start, start + size);
    expect(crc32(data)).toBe(crc);
    out[name] = dec.decode(data);
    p += 46 + nameLen;
  }
  return out;
}

describe('zip', () => {
  it('computes the standard CRC-32', () => {
    const b = new TextEncoder().encode('123456789');
    expect(crc32(b)).toBe(0xcbf43926);
    const demo = new TextEncoder().encode(loadDemoFiles()['overrides.csv']);
    expect(crc32(demo)).toBe(zlibCrc32(demo));
  });

  it('round-trips names (UTF-8) and contents', () => {
    const files = { 'a.csv': 'x,y\n1,2\n', 'pasta/ção.txt': 'olá €\n', 'empty.csv': '' };
    const zip = zipStore(
      Object.entries(files).map(([name, data]) => ({ name, data })),
      new Date(2026, 10, 25, 14, 30, 10),
    );
    expect(unzip(zip)).toEqual(files);
  });
});

describe('export everything', () => {
  it('exports the demo repo byte for byte when nothing is pending', () => {
    const files = loadDemoFiles();
    const eff = effectiveFiles(files, parseTables(files), []);
    expect(eff).toEqual(files);
    const z = exportZip(eff, new Date(2026, 10, 25, 9, 0, 0));
    expect(z.name).toBe('mealheiro-data-2026-11-25.zip');
    const back = unzip(z.bytes);
    expect(Object.keys(back)).toHaveLength(Object.keys(files).length);
    for (const [p, text] of Object.entries(files)) expect(back[`mealheiro-data-2026-11-25/${p}`]).toBe(text);
  });

  it('includes edits still waiting to sync, and leaves other files untouched', () => {
    const files = loadDemoFiles();
    const base = parseTables(files);
    const id = base.get('transactions/2026/2026-10.csv')!.rows[0].id;
    const op: Op = {
      id: 'op1',
      file: 'overrides.csv',
      kind: 'upsert',
      key: { txn_id: id },
      row: { category_id: 'groceries', note: 'exported' },
      at: '2026-11-25T09:00:00',
      label: 'recategorise 1 transaction',
    };
    const eff = effectiveFiles(files, base, [op]);
    expect(eff['overrides.csv']).not.toBe(files['overrides.csv']);
    expect(eff['overrides.csv']).toContain(`${id},`);
    expect(eff['overrides.csv']).toContain('exported');
    for (const p of Object.keys(files)) if (p !== 'overrides.csv') expect(eff[p]).toBe(files[p]);
  });
});
