/**
 * CGD "Consultar saldos e movimentos à ordem" PDF (IMPORT_FORMATS §1). A port of reference/parse_cgd.py
 * that works on positioned text (pdf.js `getTextContent()` in the app, any extractor in tests), so it
 * produces the same rows and ids as the ingest session.
 */
import { formatMoneyCsv, parseMoney, type Cents } from '../core/money';
import { assignIds, chainErrors, ImportError, type ParsedStatement } from './statement';

/** One text run as pdf.js gives it: x = transform[4], y = transform[5] (baseline, origin bottom-left). */
export interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
}

export type PageItems = TextItem[];

const DATE = /^\d{2}-\d{2}-\d{4}$/;
const AMOUNT = /^-?\d{1,3}(\.\d{3})*,\d{2}$/;
/** Column boundaries (pt) from parse_cgd.py DEFAULT_COLS. */
const COLS = { value_date: 130, description: 205, amount: 380, balance: 440 };

interface Word {
  text: string;
  x0: number;
  x1: number;
}

/** pt-PT `-1.234,56` → cents (no floats). */
export function ptMoney(s: string): Cents {
  return parseMoney(s.replace(/\./g, '').replace(',', '.'));
}

const iso = (d: string) => `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)}`;

/** Lines top to bottom: items whose baselines are within 2 pt (pdfplumber groups by top / 2). */
function lines(items: PageItems): TextItem[][] {
  const sorted = items.filter((i) => i.str !== '').sort((a, b) => b.y - a.y || a.x - b.x);
  const out: TextItem[][] = [];
  for (const it of sorted) {
    const cur = out[out.length - 1];
    if (cur && Math.abs(cur[0].y - it.y) <= 2) cur.push(it);
    else out.push([it]);
  }
  for (const l of out) l.sort((a, b) => a.x - b.x);
  return out;
}

/**
 * Words like pdfplumber's `extract_words`: split runs on whitespace (positions proportional to the
 * characters), and join runs that touch with no space between them.
 */
function words(line: TextItem[]): Word[] {
  const out: Word[] = [];
  let joinable = false;
  for (const it of line) {
    const n = it.str.length || 1;
    const per = it.width / n;
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    let first = true;
    while ((m = re.exec(it.str))) {
      const w = { text: m[0], x0: it.x + m.index * per, x1: it.x + (m.index + m[0].length) * per };
      const prev = out[out.length - 1];
      if (first && m.index === 0 && joinable && prev && w.x0 - prev.x1 <= 1) {
        prev.text += w.text;
        prev.x1 = w.x1;
      } else out.push(w);
      first = false;
    }
    joinable = !/\s$/.test(it.str) && /\S/.test(it.str);
  }
  return out;
}

/** The page as text lines (for the header regexes). */
export function pageText(items: PageItems): string {
  return lines(items)
    .map((l) =>
      words(l)
        .map((w) => w.text)
        .join(' '),
    )
    .join('\n');
}

export function headerInfo(page1: PageItems): { closing: Cents | null; start: string; end: string } {
  const text = pageText(page1);
  const c = /Saldo contabil\S*\s+([\d.]+,\d{2})\s+EUR/.exec(text);
  const p = /Intervalo de\s+(\d{2}-\d{2}-\d{4})\s+a\s+(\d{2}-\d{2}-\d{4})/.exec(text);
  return { closing: c ? ptMoney(c[1]) : null, start: p ? iso(p[1]) : '', end: p ? iso(p[2]) : '' };
}

interface RawRow {
  booking_date: string;
  value_date: string;
  description: string;
  amount: string;
  balance: string;
}

export function rowsFromPage(items: PageItems, pageNumber: number): RawRow[] {
  const out: RawRow[] = [];
  for (const l of lines(items)) {
    const ws = words(l);
    if (!ws.length || !DATE.test(ws[0].text)) continue;
    const cols: Record<keyof RawRow, string[]> = {
      booking_date: [],
      value_date: [],
      description: [],
      amount: [],
      balance: [],
    };
    for (const w of ws) {
      if (w.x0 < COLS.value_date) cols.booking_date.push(w.text);
      else if (w.x0 < COLS.description) cols.value_date.push(w.text);
      else if (w.x1 <= COLS.amount + 50 && w.x0 < COLS.amount && !AMOUNT.test(w.text))
        cols.description.push(w.text);
      else if (w.x1 <= COLS.balance) cols.amount.push(w.text);
      else cols.balance.push(w.text);
    }
    const row = {
      booking_date: cols.booking_date.join(' '),
      value_date: cols.value_date.join(' '),
      description: cols.description.join(' '),
      amount: cols.amount.join(' '),
      balance: cols.balance.join(' '),
    };
    if (
      !DATE.test(row.booking_date) ||
      !DATE.test(row.value_date) ||
      !AMOUNT.test(row.amount) ||
      !AMOUNT.test(row.balance)
    ) {
      throw new ImportError(
        `Unparseable row on page ${pageNumber}: the columns didn't line up (${ws.length} pieces of text).`,
      );
    }
    out.push(row);
  }
  return out;
}

/** Same rows, ids and checks as `parse_cgd.parse()`. Throws ImportError when a row can't be read. */
export async function parseCgd(pages: PageItems[], account = 'cgd-main'): Promise<ParsedStatement> {
  if (!pages.length) throw new ImportError('The PDF has no pages.');
  const info = headerInfo(pages[0]);
  const raw = pages.flatMap((p, i) => rowsFromPage(p, i + 1));
  if (!raw.length) throw new ImportError('No movements found. Is this a CGD "saldos e movimentos" PDF?');
  raw.reverse(); // the PDF lists newest first
  const rows = await assignIds(
    raw.map((r) => ({
      account_id: account,
      booking_date: iso(r.booking_date),
      value_date: iso(r.value_date),
      description_raw: r.description,
      amount: ptMoney(r.amount),
      currency: 'EUR',
      balance_after: ptMoney(r.balance),
    })),
  );
  const errors = chainErrors(rows);
  const last = rows[rows.length - 1];
  if (info.closing !== null && last.balance_after !== info.closing) {
    errors.push(
      `Closing balance mismatch: last row ${formatMoneyCsv(last.balance_after!)} vs header ${formatMoneyCsv(info.closing)}`,
    );
  }
  return {
    sourceType: 'cgd-pdf',
    account,
    rows,
    periodStart: info.start,
    periodEnd: info.end,
    closingBalance: info.closing,
    errors,
    skipped: [],
  };
}
