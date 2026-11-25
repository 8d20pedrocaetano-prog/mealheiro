/**
 * Helpers for rules the owner creates in the app (SPEC §4.2 "Apply to all like this", §4.9 Rules).
 * A new user rule goes ahead of every existing rule, so it wins for every transaction it matches
 * (an override still wins over it, DATA_MODEL §6).
 */
import type { CompiledRule, DataSet, Txn } from './dataset';
import { compileRule } from './dataset';
import { categorize, ruleMatches } from './categorize';
import type { RuleRow } from './schema';
import type { View } from './view';

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Words that say what kind of movement it is, not who it is with. */
const GENERIC = new Set([
  'TRF',
  'TFI',
  'MBWAY',
  'MB',
  'WAY',
  'PAG',
  'PAGAMENTO',
  'DD',
  'SEPA',
  'LEV',
  'TRANSF',
]);

/** A pre-filled, anchored pattern for "all like this": `^REPSOL`, `^EDP COMERCIAL`, `^TRF MBWAY 912XXX001`. */
export function suggestPattern(t: Pick<Txn, 'descNorm'>): string {
  const tokens = t.descNorm.split(' ').filter(Boolean);
  if (!tokens.length) return '';
  if (GENERIC.has(tokens[0])) {
    // movements with a person or a phone number: keep the whole description (that is who it is)
    return '^' + escapeRegex(tokens.join(' '));
  }
  // the first word names the merchant; a short one (EDP, BP) needs the next word too
  const words = tokens.slice(0, tokens[0].length <= 3 ? 2 : 1);
  while (words.length > 1 && /\d/.test(words[words.length - 1])) words.pop();
  return '^' + escapeRegex(words.join(' '));
}

/** The regex subset both Python `re` and JavaScript agree on (DATA_MODEL §3). */
export function validatePattern(p: string): string | null {
  if (!p.trim()) return 'Enter a pattern.';
  if (/\(\?[<P]/.test(p)) return 'Named groups and lookbehind are not supported.';
  if (/\(\?[aiLmsux-]+[):]/.test(p))
    return 'Inline flags are not supported (matching is already case-insensitive).';
  try {
    new RegExp(p, 'i');
  } catch {
    return 'This is not a valid pattern.';
  }
  return null;
}

export interface RuleDraft {
  pattern: string;
  direction: '' | 'in' | 'out';
  amount_min: string;
  amount_max: string;
  account_id: string;
  merchant: string;
  category_id: string;
}

export interface RulePreview {
  /** Transactions the pattern matches. */
  matches: Txn[];
  /** Matches whose category would change. */
  changes: Txn[];
  /** Matches kept as they are because the owner set their category by hand. */
  keptByOverride: number;
}

function draftRow(d: RuleDraft): RuleRow {
  return {
    id: 'draft',
    priority: '0',
    pattern: d.pattern,
    direction: d.direction,
    amount_min: d.amount_min,
    amount_max: d.amount_max,
    account_id: d.account_id,
    merchant: d.merchant,
    category_id: d.category_id,
    source: 'user',
    created_at: '',
  };
}

export function previewRule(ds: DataSet, view: View, d: RuleDraft): RulePreview {
  const empty = { matches: [], changes: [], keptByOverride: 0 };
  if (validatePattern(d.pattern)) return empty;
  const rule: CompiledRule = compileRule(draftRow(d));
  const matches: Txn[] = [];
  const changes: Txn[] = [];
  let keptByOverride = 0;
  for (const t of ds.txns) {
    if (!ruleMatches(rule, t, t.descNorm)) continue;
    matches.push(t);
    if (ds.overrides.get(t.id)?.category_id) {
      keptByOverride++;
      continue;
    }
    const cur = view.eff.get(t.id)?.categoryId ?? categorize(ds, t).categoryId;
    if (cur !== d.category_id) changes.push(t);
  }
  return { matches, changes, keptByOverride };
}

/**
 * Preview of editing (or deleting, with `draft` null) an existing rule in place, keeping its priority:
 * every transaction is re-categorised with the edited rule list.
 */
export function previewEdit(ds: DataSet, view: View, id: string, draft: RuleDraft | null): RulePreview {
  const old = ds.rules.find((r) => r.row.id === id);
  if (!old || (draft && validatePattern(draft.pattern)))
    return { matches: [], changes: [], keptByOverride: 0 };
  const edited = draft ? compileRule({ ...old.row, ...draft }) : null;
  const rules = ds.rules.flatMap((r) => (r === old ? (edited ? [edited] : []) : [r]));
  const ds2: DataSet = { ...ds, rules };
  const matches: Txn[] = [];
  const changes: Txn[] = [];
  let keptByOverride = 0;
  for (const t of ds.txns) {
    const hit = edited ? ruleMatches(edited, t, t.descNorm) : ruleMatches(old, t, t.descNorm);
    if (hit) {
      matches.push(t);
      if (ds.overrides.get(t.id)?.category_id) keptByOverride++;
    }
    if (!hit && !ruleMatches(old, t, t.descNorm)) continue;
    const cur = view.eff.get(t.id)?.categoryId ?? categorize(ds, t).categoryId;
    if (categorize(ds2, t).categoryId !== cur) changes.push(t);
  }
  return { matches, changes, keptByOverride };
}

/** `u042`: one past the highest number used by any rule, with the user prefix. */
export function nextRuleId(rules: CompiledRule[], prefix = 'u'): string {
  let max = 0;
  for (const r of rules) {
    const n = Number(r.row.id.slice(1));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

/** Ahead of every rule: newest owner decision first. */
export function firstPriority(rules: CompiledRule[]): number {
  let min = Infinity;
  for (const r of rules) {
    const p = Number(r.row.priority);
    if (Number.isFinite(p) && p < min) min = p;
  }
  return min === Infinity ? 10 : min - 1;
}

export function newRuleRow(ds: DataSet, d: RuleDraft, createdAt: string): RuleRow {
  return {
    ...draftRow(d),
    id: nextRuleId(ds.rules),
    priority: String(firstPriority(ds.rules)),
    created_at: createdAt,
  };
}

/** How many transactions each rule currently decides the category of. */
export function ruleHits(ds: DataSet, view: View): Map<string, number> {
  const hits = new Map<string, number>();
  for (const t of ds.txns) {
    const e = view.eff.get(t.id);
    if (e?.source.startsWith('rule:')) hits.set(e.source.slice(5), (hits.get(e.source.slice(5)) ?? 0) + 1);
  }
  return hits;
}

/**
 * New priorities after moving the rule at `from` to `to` in priority order. Returns only the rows whose
 * priority changes. Swaps two values when they differ; otherwise renumbers everything in steps of 10.
 */
export function reorderRules(
  sorted: RuleRow[],
  from: number,
  to: number,
): { id: string; priority: string }[] {
  if (from === to || to < 0 || to >= sorted.length) return [];
  const order = [...sorted];
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved);
  const old = sorted.map((r) => Number(r.priority));
  const strictly = old.every((p, i) => i === 0 || p > old[i - 1]);
  const next = strictly ? old : sorted.map((_, i) => (i + 1) * 10);
  const out: { id: string; priority: string }[] = [];
  order.forEach((r, i) => {
    if (String(next[i]) !== r.priority) out.push({ id: r.id, priority: String(next[i]) });
  });
  return out;
}
