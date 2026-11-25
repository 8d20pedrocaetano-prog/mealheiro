/**
 * Builds the in-memory model from the data repo's raw files (path → text), like load() in mh.py.
 */
import { parseCsv, type CsvTable } from './csv';
import { parseMoney, type Cents } from './money';
import { norm } from './normalize';
import {
  parseSettings,
  TXN_PATH_RE,
  type AccountRow,
  type BalanceRow,
  type BudgetRow,
  type CategoryRow,
  type EventRow,
  type GoalRow,
  type ImportRow,
  type ManualRow,
  type OverrideRow,
  type RuleRow,
  type Settings,
} from './schema';

/** One transaction: an imported row or a manual entry (DATA_MODEL §3 manual.csv). */
export interface Txn {
  id: string;
  account_id: string;
  booking_date: string;
  value_date: string;
  description_raw: string;
  /** Exactly as stored, e.g. `-12.34`. */
  amountStr: string;
  amount: Cents;
  currency: string;
  balance_after: string;
  import_id: string;
  category_suggested: string;
  suggested_by: string;
  review_note: string;
  /** description_norm (DATA_MODEL §5), computed once. */
  descNorm: string;
  /** Source file for imported rows (`transactions/2026/2026-01.csv`). */
  file?: string;
  /** Set for manual entries. */
  manual?: ManualRow;
}

export interface CompiledRule {
  row: RuleRow;
  re: RegExp | null;
  min: Cents | null;
  max: Cents | null;
}

export interface DataSet {
  accounts: Map<string, AccountRow>;
  categories: Map<string, CategoryRow>;
  /** Sorted by priority (stable), regexes compiled. */
  rules: CompiledRule[];
  overrides: Map<string, OverrideRow>;
  events: EventRow[];
  manual: ManualRow[];
  budgets: BudgetRow[];
  goals: GoalRow[];
  balances: BalanceRow[];
  imports: ImportRow[];
  settings: Settings;
  /** Imported (file order) then manual, sorted by (value_date, booking_date), stable. */
  txns: Txn[];
  byId: Map<string, Txn>;
  /** Raw parsed tables by path (header + rows), kept for rewrites that preserve unknown columns. */
  tables: Map<string, CsvTable>;
  /** Paths of transaction month files, sorted. */
  txnFiles: string[];
  /** Problems found while loading (bad amounts, bad regexes); shown in the app, never thrown. */
  problems: string[];
}

export type FileMap = Record<string, string>;

function rows<T>(tables: Map<string, CsvTable>, path: string): T[] {
  return (tables.get(path)?.rows ?? []) as T[];
}

/** Rule regexes: case-insensitive, unanchored unless the pattern anchors itself (DATA_MODEL §3). */
export function compileRule(row: RuleRow): CompiledRule {
  let re: RegExp | null = null;
  try {
    re = new RegExp(row.pattern, 'i');
  } catch {
    re = null;
  }
  const bound = (s: string, rounding: 'floor' | 'ceil'): Cents | null => {
    if (!s || s.trim() === '') return null;
    try {
      // |amount| < min  ⇔  cents < ceil(min);  |amount| > max  ⇔  cents > floor(max)
      return parseMoney(s, rounding);
    } catch {
      return null;
    }
  };
  return { row, re, min: bound(row.amount_min, 'ceil'), max: bound(row.amount_max, 'floor') };
}

export function sortRules(rules: RuleRow[]): RuleRow[] {
  return [...rules].sort((a, b) => (parseInt(a.priority, 10) || 0) - (parseInt(b.priority, 10) || 0));
}

export function manualToTxn(m: ManualRow, problems?: string[]): Txn {
  let amount = 0;
  try {
    amount = parseMoney(m.amount);
  } catch {
    problems?.push(`manual ${m.id}: bad amount ${m.amount}`);
  }
  return {
    id: m.id,
    account_id: m.account_id,
    booking_date: m.date,
    value_date: m.date,
    description_raw: m.description,
    amountStr: m.amount,
    amount,
    currency: m.currency || 'EUR',
    balance_after: '',
    import_id: '',
    category_suggested: m.category_id ?? '',
    suggested_by: 'manual',
    review_note: '',
    descNorm: norm(m.description ?? ''),
    manual: m,
  };
}

export function sortTxns(txns: Txn[]): Txn[] {
  return txns.sort((a, b) =>
    a.value_date < b.value_date
      ? -1
      : a.value_date > b.value_date
        ? 1
        : a.booking_date < b.booking_date
          ? -1
          : a.booking_date > b.booking_date
            ? 1
            : 0,
  );
}

export function parseTables(files: FileMap): Map<string, CsvTable> {
  const tables = new Map<string, CsvTable>();
  for (const [path, text] of Object.entries(files)) {
    if (path.endsWith('.csv')) tables.set(path, parseCsv(text));
  }
  return tables;
}

export function loadDataSet(files: FileMap): DataSet {
  return buildDataSet(parseTables(files), parseSettings(files['settings.json']));
}

/** Builds the model from already-parsed tables (the app re-uses parsed tables between edits). */
export function buildDataSet(tables: Map<string, CsvTable>, settings: Settings): DataSet {
  const problems: string[] = [];

  const accounts = new Map(rows<AccountRow>(tables, 'accounts.csv').map((a) => [a.id, a]));
  const categories = new Map(rows<CategoryRow>(tables, 'categories.csv').map((c) => [c.id, c]));
  if (!categories.has('uncategorized')) {
    categories.set('uncategorized', {
      id: 'uncategorized',
      name: 'Uncategorized',
      group: 'Other',
      kind: 'expense',
      counterparty_account: '',
      budgetable: 'false',
      icon: 'help-circle',
    });
  }
  const rules = sortRules(rows<RuleRow>(tables, 'rules.csv')).map(compileRule);
  for (const r of rules) if (!r.re) problems.push(`rule ${r.row.id}: bad regex ${r.row.pattern}`);
  const overrides = new Map(rows<OverrideRow>(tables, 'overrides.csv').map((o) => [o.txn_id, o]));
  const manual = rows<ManualRow>(tables, 'manual.csv');

  const txnFiles = [...tables.keys()].filter((p) => TXN_PATH_RE.test(p)).sort();
  const txns: Txn[] = [];
  for (const file of txnFiles) {
    for (const r of tables.get(file)!.rows) {
      let amount = 0;
      try {
        amount = parseMoney(r.amount);
      } catch {
        problems.push(`${r.id}: bad amount ${r.amount}`);
      }
      txns.push({
        id: r.id,
        account_id: r.account_id,
        booking_date: r.booking_date,
        value_date: r.value_date,
        description_raw: r.description_raw,
        amountStr: r.amount,
        amount,
        currency: r.currency,
        balance_after: r.balance_after,
        import_id: r.import_id,
        category_suggested: r.category_suggested,
        suggested_by: r.suggested_by,
        review_note: r.review_note,
        descNorm: norm(r.description_raw ?? ''),
        file,
      });
    }
  }
  for (const m of manual) txns.push(manualToTxn(m, problems));
  sortTxns(txns);
  const byId = new Map(txns.map((t) => [t.id, t]));

  return {
    accounts,
    categories,
    rules,
    overrides,
    events: rows<EventRow>(tables, 'events.csv'),
    manual,
    budgets: rows<BudgetRow>(tables, 'budgets.csv'),
    goals: rows<GoalRow>(tables, 'goals.csv'),
    balances: rows<BalanceRow>(tables, 'balances.csv'),
    imports: rows<ImportRow>(tables, 'imports.csv'),
    settings,
    txns,
    byId,
    tables,
    txnFiles,
    problems,
  };
}
