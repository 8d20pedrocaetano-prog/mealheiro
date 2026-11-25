/**
 * Revolut account statement CSV (IMPORT_FORMATS §3). Columns as Revolut exports them:
 * `Type, Product, Started Date, Completed Date, Description, Amount, Fee, Currency, State, Balance`.
 * Written against the documented format; adjust against the owner's first real export.
 */
import Papa from 'papaparse';
import { parseMoney, type Cents } from '../core/money';
import { assignIds, chainErrors, ImportError, type ParsedStatement, type StatementRow } from './statement';

const REQUIRED = [
  'Type',
  'Started Date',
  'Completed Date',
  'Description',
  'Amount',
  'Fee',
  'Currency',
  'State',
  'Balance',
];

export function looksLikeRevolut(header: string[]): boolean {
  return REQUIRED.every((h) => header.includes(h));
}

const datePart = (s: string) => s.trim().slice(0, 10);
const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

function money(s: string, what: string, line: number): Cents {
  try {
    return parseMoney(s.trim() === '' ? '0' : s.trim());
  } catch {
    throw new ImportError(
      `Line ${line}: can't read the ${what} ${JSON.stringify(s)} (expected e.g. -12.34).`,
    );
  }
}

export async function parseRevolut(text: string, account = 'revolut'): Promise<ParsedStatement> {
  const res = Papa.parse<Record<string, string>>(text.replace(/^\uFEFF/, ''), {
    header: true,
    skipEmptyLines: true,
  });
  const header = res.meta.fields ?? [];
  if (!looksLikeRevolut(header)) {
    throw new ImportError(
      `Not a Revolut statement: missing ${REQUIRED.filter((h) => !header.includes(h)).join(', ')}.`,
    );
  }
  let pending = 0;
  let foreign = 0;
  const kept: { r: Record<string, string>; line: number }[] = [];
  res.data.forEach((r, i) => {
    if ((r.State ?? '').trim().toUpperCase() !== 'COMPLETED') pending++;
    else if ((r.Currency ?? '').trim().toUpperCase() !== 'EUR') foreign++;
    else kept.push({ r, line: i + 2 });
  });
  // The balance moves when a movement completes: put rows in completion order (stable for ties).
  kept.sort((a, b) =>
    a.r['Completed Date'] < b.r['Completed Date']
      ? -1
      : a.r['Completed Date'] > b.r['Completed Date']
        ? 1
        : 0,
  );

  const rows: Omit<StatementRow, 'id'>[] = [];
  for (const { r, line } of kept) {
    const amount = money(r.Amount, 'amount', line);
    const fee = Math.abs(money(r.Fee, 'fee', line));
    const balance = r.Balance.trim() === '' ? null : money(r.Balance, 'balance', line);
    const description = collapse(r.Description);
    const base = {
      account_id: account,
      booking_date: datePart(r['Completed Date']),
      value_date: datePart(r['Started Date']),
      currency: 'EUR',
    };
    // amount = Amount − Fee, with the fee as its own row so it lands in Bank fees.
    rows.push({
      ...base,
      description_raw: description,
      amount,
      balance_after: balance === null ? null : balance + fee,
      ...(r.Type.trim().toUpperCase() === 'TOPUP' ? { category_suggested: 'transfer-revolut' } : {}),
    });
    if (fee !== 0) {
      rows.push({
        ...base,
        description_raw: collapse(`FEE ${description}`),
        amount: -fee,
        balance_after: balance,
        category_suggested: 'bank-fees',
      });
    }
  }
  if (!rows.length) throw new ImportError('No completed EUR movements in this file.');
  const withIds = await assignIds(rows);
  const skipped = [
    ...(pending ? [{ reason: 'not completed (pending, reverted or declined)', count: pending }] : []),
    ...(foreign ? [{ reason: 'in another currency (Mealheiro needs the EUR amount)', count: foreign }] : []),
  ];
  const dates = withIds.map((r) => r.booking_date).sort();
  const last = withIds[withIds.length - 1];
  return {
    sourceType: 'revolut-csv',
    account,
    rows: withIds,
    periodStart: dates[0],
    periodEnd: dates[dates.length - 1],
    closingBalance: last.balance_after,
    errors: chainErrors(withIds),
    skipped,
  };
}
