/** Categorisation precedence and the reporting view (DATA_MODEL §6). Mirrors categorize/effective in mh.py. */
import type { CompiledRule, DataSet, Txn } from './dataset';
import { isTrue, type Kind } from './schema';
import { titleCase } from './normalize';

export function ruleMatches(
  rule: CompiledRule,
  t: Pick<Txn, 'account_id' | 'amount'>,
  descNorm: string,
): boolean {
  const r = rule.row;
  if (r.account_id && r.account_id !== t.account_id) return false;
  if (r.direction === 'in' && t.amount <= 0) return false;
  if (r.direction === 'out' && t.amount >= 0) return false;
  const a = Math.abs(t.amount);
  if (rule.min !== null && a < rule.min) return false;
  if (rule.max !== null && a > rule.max) return false;
  if (!rule.re) return false;
  rule.re.lastIndex = 0;
  return rule.re.test(descNorm);
}

export function firstMatchingRule(ds: DataSet, t: Txn): CompiledRule | null {
  for (const r of ds.rules) if (ruleMatches(r, t, t.descNorm)) return r;
  return null;
}

export interface Categorized {
  categoryId: string;
  merchant: string;
  /** `override` | `rule:<id>` | `suggested:<by>` | `none` */
  source: string;
  ruleId: string | null;
}

/** Precedence: override > rule > suggestion > uncategorized. */
export function categorize(ds: DataSet, t: Txn): Categorized {
  const o = ds.overrides.get(t.id);
  const rule = firstMatchingRule(ds, t);
  const merchant = (rule && rule.row.merchant ? rule.row.merchant : null) || titleCase(t.descNorm);
  const ruleId = rule ? rule.row.id : null;
  if (o && o.category_id) return { categoryId: o.category_id, merchant, source: 'override', ruleId };
  if (rule) return { categoryId: rule.row.category_id, merchant, source: 'rule:' + rule.row.id, ruleId };
  if (t.category_suggested)
    return {
      categoryId: t.category_suggested,
      merchant,
      source: 'suggested:' + (t.suggested_by || '?'),
      ruleId,
    };
  return { categoryId: 'uncategorized', merchant, source: 'none', ruleId };
}

export interface Effective extends Categorized {
  reportCategory: string;
  group: string;
  kind: Kind;
  excluded: boolean;
  /** From overrides only (as in mh.py). */
  eventId: string;
}

export const UNITEMIZED_GROUP = 'Unitemized';

/** Reporting view: transfers to untracked accounts become unitemized spending. */
export function effective(ds: DataSet, t: Txn, c: Categorized = categorize(ds, t)): Effective {
  const cat = ds.categories.get(c.categoryId) ?? ds.categories.get('uncategorized')!;
  let kind = cat.kind as Kind;
  let reportCategory = c.categoryId;
  let group = cat.group;
  if (kind === 'transfer' && cat.counterparty_account) {
    const acct = ds.accounts.get(cat.counterparty_account);
    if (!acct || !isTrue(acct.tracked)) {
      kind = 'expense';
      reportCategory = 'unitemized-' + cat.counterparty_account;
      group = UNITEMIZED_GROUP;
    }
  }
  const o = ds.overrides.get(t.id);
  return {
    ...c,
    reportCategory,
    group,
    kind,
    excluded: isTrue(o?.excluded),
    eventId: o?.event_id ?? '',
  };
}
