/**
 * Money is integer cents everywhere (CLAUDE.md non-negotiable #3). CSV stores `-12.34`.
 * Never sum floats: parse to cents, add integers, format at the edge.
 */
export type Cents = number;

const MONEY_RE = /^\s*([+-])?(\d*)(?:\.(\d*))?\s*$/;

interface Parts {
  negative: boolean;
  whole: string;
  frac: string;
}

function split(s: string): Parts | null {
  const m = MONEY_RE.exec(s);
  if (!m) return null;
  const whole = m[2] ?? '';
  const frac = m[3] ?? '';
  if (whole === '' && frac === '') return null;
  return { negative: m[1] === '-', whole: whole || '0', frac };
}

/** Rounding used when a value has more than two decimals (only rule bounds may, in theory). */
export type Rounding = 'exact' | 'floor' | 'ceil';

function toCents(p: Parts, rounding: Rounding): Cents {
  const head = p.frac.slice(0, 2).padEnd(2, '0');
  const tail = p.frac.slice(2);
  let cents = Number(p.whole) * 100 + Number(head);
  const hasTail = /[1-9]/.test(tail);
  if (hasTail) {
    if (rounding === 'exact') throw new Error('more than two decimals');
    // floor/ceil on the signed value
    const up = (rounding === 'ceil') !== p.negative;
    if (up) cents += 1;
  }
  if (!Number.isSafeInteger(cents)) throw new Error('amount out of range');
  return p.negative && cents !== 0 ? -cents : cents;
}

/** Parses `-12.34`, `260`, `7.9` to cents. Throws on anything else (no silent fixing). */
export function parseMoney(s: string, rounding: Rounding = 'exact'): Cents {
  const p = split(s);
  if (!p) throw new Error(`invalid amount: ${JSON.stringify(s)}`);
  return toCents(p, rounding);
}

export function tryParseMoney(s: string | undefined | null): Cents | null {
  if (s == null || s.trim() === '') return null;
  try {
    return parseMoney(s);
  } catch {
    return null;
  }
}

/** Strict CSV form: `-12.34` (dot, exactly two decimals). */
export function isCsvMoney(s: string): boolean {
  return /^-?\d+\.\d{2}$/.test(s);
}

/** Cents → CSV string with a dot and exactly two decimals. */
export function formatMoneyCsv(c: Cents): string {
  const neg = c < 0;
  const abs = Math.abs(c);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${neg ? '-' : ''}${whole}.${frac}`;
}

const NBSP = ' ';

function groupThousands(n: number): string {
  const s = String(n);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const fromEnd = s.length - i;
    out += s[i];
    if (fromEnd > 1 && fromEnd % 3 === 1) out += '.';
  }
  return out;
}

export interface FormatOptions {
  /** Show a leading + on positive amounts. */
  plus?: boolean;
  /** Drop the cents when they are zero (for compact chart labels). */
  compact?: boolean;
  /** Omit the € sign. */
  bare?: boolean;
}

/**
 * pt-PT display format from SPEC §4: `1.234,56 €` (dot thousands, comma decimals, € after a
 * no-break space). Written by hand because Intl's pt-PT uses a narrow space for thousands.
 */
export function formatEUR(c: Cents, opts: FormatOptions = {}): string {
  const neg = c < 0;
  const abs = Math.abs(c);
  const whole = Math.floor(abs / 100);
  const cents = abs % 100;
  let body = groupThousands(whole);
  if (!(opts.compact && cents === 0)) body += ',' + String(cents).padStart(2, '0');
  const sign = neg ? '−' : opts.plus && c > 0 ? '+' : '';
  return `${sign}${body}${opts.bare ? '' : NBSP + '€'}`;
}

/** Short form for chart axes: `1,2k €`, `850 €`. */
export function formatEURShort(c: Cents): string {
  const v = Math.abs(c) / 100;
  const sign = c < 0 ? '−' : '';
  if (v >= 1000) {
    const k = Math.round(v / 100) / 10;
    return `${sign}${String(k).replace('.', ',')}k${NBSP}€`;
  }
  return `${sign}${Math.round(v)}${NBSP}€`;
}

/**
 * Parses what a person types on a pt-PT keypad: `12,5`, `1.234,56`, `12.50`, `-3`.
 * Returns null when it is not a number.
 */
export function parseUserAmount(input: string): Cents | null {
  let s = input.trim().replace(/\s|€/g, '');
  if (s === '') return null;
  const neg = s.startsWith('-') || s.startsWith('−');
  s = s.replace(/^[-−+]/, '');
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  if (!/^\d*(\.\d{0,2})?$/.test(s) || s === '' || s === '.') return null;
  const c = parseMoney(s);
  return neg ? -c : c;
}

export function sumCents(values: Iterable<Cents>): Cents {
  let t = 0;
  for (const v of values) t += v;
  return t;
}
