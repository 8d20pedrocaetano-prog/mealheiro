import type { Txn } from '../../core/dataset';
import type { Model } from '../../core/model';

/** Why a transaction has its category (SPEC §4.2): override / rule / suggestion / none. */
export function whyText(source: string, ruleId: string | null, m: Model, t: Txn): string {
  if (source === 'override') return 'You chose it';
  if (source.startsWith('rule:')) {
    const r = m.ds.rules.find((x) => x.row.id === ruleId)?.row;
    const by = r?.source === 'claude' ? ' (added by Claude)' : r?.source === 'user' ? ' (your rule)' : '';
    return `Rule ${ruleId}${by}`;
  }
  if (source === 'suggested:manual') return 'Logged by you';
  if (source.startsWith('suggested:')) {
    const by = source.slice('suggested:'.length);
    return `Suggested by ${by}${t.review_note ? `: “${t.review_note}”` : ''}`;
  }
  return 'Not categorised yet';
}
