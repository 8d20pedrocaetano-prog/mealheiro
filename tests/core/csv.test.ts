import { describe, expect, it } from 'vitest';
import { mergeHeader, parseCsv, serializeCsv } from '../../src/core/csv';

describe('csv', () => {
  it('round-trips quoting, commas, quotes and newlines (RFC 4180)', () => {
    const text = 'id,note\n1,"a, b"\n2,"say ""hi"""\n3,"two\nlines"\n4,\n';
    const t = parseCsv(text);
    expect(t.rows.map((r) => r.note)).toEqual(['a, b', 'say "hi"', 'two\nlines', '']);
    expect(serializeCsv(t.header, t.rows)).toBe(text);
  });

  it('preserves unknown columns on rewrite', () => {
    const t = parseCsv('id,name,extra\n1,A,keep me\n');
    const header = mergeHeader(['id', 'name', 'new_col'], t.header);
    expect(header).toEqual(['id', 'name', 'new_col', 'extra']);
    expect(serializeCsv(header, t.rows)).toBe('id,name,new_col,extra\n1,A,,keep me\n');
  });

  it('pads short rows, skips blank lines and strips a BOM', () => {
    const t = parseCsv('﻿a,b,c\n1,2\n\n3,4,5\n');
    expect(t.header).toEqual(['a', 'b', 'c']);
    expect(t.rows).toEqual([
      { a: '1', b: '2', c: '' },
      { a: '3', b: '4', c: '5' },
    ]);
  });

  it('handles CRLF input and writes LF', () => {
    const t = parseCsv('a,b\r\n1,2\r\n');
    expect(serializeCsv(t.header, t.rows)).toBe('a,b\n1,2\n');
  });

  it('parses an empty file', () => {
    expect(parseCsv('')).toEqual({ header: [], rows: [] });
  });
});
