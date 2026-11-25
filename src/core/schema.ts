/**
 * Typed rows for every file in DATA_MODEL §3. Rows stay string records (so unknown columns are
 * preserved on rewrite); these types name the known columns.
 */
import type { Row } from './csv';

export const SCHEMA_VERSION = 1;

export const TXN_FIELDS = [
  'id',
  'account_id',
  'booking_date',
  'value_date',
  'description_raw',
  'amount',
  'currency',
  'balance_after',
  'import_id',
  'category_suggested',
  'suggested_by',
  'review_note',
] as const;
export const ACCOUNT_FIELDS = [
  'id',
  'name',
  'institution',
  'type',
  'currency',
  'tracked',
  'opening_date',
  'notes',
] as const;
export const CATEGORY_FIELDS = [
  'id',
  'name',
  'group',
  'kind',
  'counterparty_account',
  'budgetable',
  'icon',
] as const;
export const RULE_FIELDS = [
  'id',
  'priority',
  'pattern',
  'direction',
  'amount_min',
  'amount_max',
  'account_id',
  'merchant',
  'category_id',
  'source',
  'created_at',
] as const;
export const EVENT_FIELDS = [
  'id',
  'name',
  'type',
  'status',
  'start_date',
  'end_date',
  'budget',
  'color',
  'source',
  'notes',
  'created_at',
] as const;
export const OVERRIDE_FIELDS = [
  'txn_id',
  'category_id',
  'event_id',
  'note',
  'excluded',
  'reimburses_txn_id',
  'updated_at',
] as const;
export const MANUAL_FIELDS = [
  'id',
  'account_id',
  'date',
  'description',
  'amount',
  'currency',
  'category_id',
  'event_id',
  'note',
  'created_at',
  'linked_txn_id',
] as const;
export const BUDGET_FIELDS = [
  'id',
  'scope',
  'target',
  'monthly_limit',
  'start_month',
  'end_month',
  'exclude_events',
  'notes',
] as const;
export const GOAL_FIELDS = [
  'id',
  'name',
  'target_amount',
  'target_date',
  'basis',
  'start_date',
  'start_amount',
  'priority',
  'notes',
] as const;
export const BALANCE_FIELDS = ['date', 'account_id', 'balance', 'note'] as const;
export const IMPORT_FIELDS = [
  'id',
  'imported_at',
  'account_id',
  'source_type',
  'file_name',
  'file_sha256',
  'period_start',
  'period_end',
  'rows_in_file',
  'rows_added',
  'rows_duplicate',
  'closing_balance',
  'checks',
  'by',
] as const;

type RowOf<F extends readonly string[]> = Record<F[number], string> & Row;

export type TxnRow = RowOf<typeof TXN_FIELDS>;
export type AccountRow = RowOf<typeof ACCOUNT_FIELDS>;
export type CategoryRow = RowOf<typeof CATEGORY_FIELDS>;
export type RuleRow = RowOf<typeof RULE_FIELDS>;
export type EventRow = RowOf<typeof EVENT_FIELDS>;
export type OverrideRow = RowOf<typeof OVERRIDE_FIELDS>;
export type ManualRow = RowOf<typeof MANUAL_FIELDS>;
export type BudgetRow = RowOf<typeof BUDGET_FIELDS>;
export type GoalRow = RowOf<typeof GOAL_FIELDS>;
export type BalanceRow = RowOf<typeof BALANCE_FIELDS>;
export type ImportRow = RowOf<typeof IMPORT_FIELDS>;

export type Kind = 'expense' | 'income' | 'transfer';
export type EventType = 'trip' | 'work-trip' | 'stage' | 'tag';
export type EventStatus = 'proposed' | 'confirmed' | 'dismissed';

/** Files at the data repo root, their columns and the key used for row-level upserts. */
export const ROOT_FILES = {
  'accounts.csv': { fields: ACCOUNT_FIELDS, key: ['id'] },
  'categories.csv': { fields: CATEGORY_FIELDS, key: ['id'] },
  'rules.csv': { fields: RULE_FIELDS, key: ['id'] },
  'events.csv': { fields: EVENT_FIELDS, key: ['id'] },
  'overrides.csv': { fields: OVERRIDE_FIELDS, key: ['txn_id'] },
  'manual.csv': { fields: MANUAL_FIELDS, key: ['id'] },
  'budgets.csv': { fields: BUDGET_FIELDS, key: ['id'] },
  'goals.csv': { fields: GOAL_FIELDS, key: ['id'] },
  'balances.csv': { fields: BALANCE_FIELDS, key: ['date', 'account_id'] },
  'imports.csv': { fields: IMPORT_FIELDS, key: ['id'] },
} as const satisfies Record<string, { fields: readonly string[]; key: readonly string[] }>;

export type RootFile = keyof typeof ROOT_FILES;

/** Files the app may write (DATA_MODEL §2). `transactions/**` is append-only and only via import (M5). */
export const APP_WRITABLE: readonly RootFile[] = [
  'overrides.csv',
  'manual.csv',
  'budgets.csv',
  'goals.csv',
  'balances.csv',
  'rules.csv',
  'events.csv',
  'accounts.csv',
  'categories.csv',
];

export const TXN_PATH_RE = /^transactions\/\d{4}\/\d{4}-\d{2}\.csv$/;

export function fieldsFor(path: string): readonly string[] | null {
  if (path in ROOT_FILES) return ROOT_FILES[path as RootFile].fields;
  if (TXN_PATH_RE.test(path)) return TXN_FIELDS;
  return null;
}

export interface TripDetectionSettings {
  away_day_score: number;
  max_gap_days: number;
  min_trip_score: number;
  pre_trip_window_days: number;
}

export interface Settings {
  schema_version: number;
  home_currency: string;
  locale: string;
  ui_language: string;
  week_starts_on: string;
  home_area: string[];
  trip_detection: Partial<TripDetectionSettings>;
  budgets: { exclude_confirmed_trips?: boolean };
  [key: string]: unknown;
}

export const DEFAULT_SETTINGS: Settings = {
  schema_version: SCHEMA_VERSION,
  home_currency: 'EUR',
  locale: 'pt-PT',
  ui_language: 'en',
  week_starts_on: 'monday',
  home_area: [],
  trip_detection: { away_day_score: 3, max_gap_days: 2, min_trip_score: 6, pre_trip_window_days: 120 },
  budgets: { exclude_confirmed_trips: false },
};

export function parseSettings(text: string | undefined): Settings {
  if (!text || text.trim() === '') return { ...DEFAULT_SETTINGS };
  const raw = JSON.parse(text) as Partial<Settings>;
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    trip_detection: { ...(raw.trip_detection ?? {}) },
    budgets: { ...DEFAULT_SETTINGS.budgets, ...(raw.budgets ?? {}) },
  } as Settings;
}

export const isTrue = (v: string | undefined): boolean => (v ?? '').toLowerCase() === 'true';
