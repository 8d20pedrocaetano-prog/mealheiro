/** Category lists for pickers. */
import type { Model } from '../../core/model';
import type { CategoryRow } from '../../core/schema';
import { effOf } from '../../core/view';

/** Groups in a stable order: the palette's groups first, then the rest alphabetically. */
const GROUP_ORDER = ['Food', 'Home', 'Transport', 'Shopping', 'Leisure', 'Bills & subscriptions', 'Travel'];

export function groupedCategories(m: Model, kinds?: string[]): { group: string; cats: CategoryRow[] }[] {
  const by = new Map<string, CategoryRow[]>();
  for (const c of m.ds.categories.values()) {
    if (kinds && !kinds.includes(c.kind)) continue;
    let a = by.get(c.group);
    if (!a) by.set(c.group, (a = []));
    a.push(c);
  }
  const rank = (g: string) => {
    const i = GROUP_ORDER.indexOf(g);
    return i < 0 ? GROUP_ORDER.length : i;
  };
  return [...by.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([group, cats]) => ({ group, cats }));
}

/**
 * The categories used most for this kind of entry: manual entries count triple (they are what Quick add
 * repeats), then recent transactions.
 */
export function mostUsedCategories(m: Model, kind: 'expense' | 'income', n = 8): string[] {
  const score = new Map<string, number>();
  const since = `${Number(m.today.slice(0, 4)) - 1}${m.today.slice(4)}`;
  for (const t of m.ds.txns) {
    if (t.value_date < since) continue;
    const e = effOf(m.view, t);
    const c = m.ds.categories.get(e.categoryId);
    if (!c || c.kind !== kind || c.id === 'uncategorized') continue;
    if (kind === 'expense' && t.amount > 0) continue;
    score.set(c.id, (score.get(c.id) ?? 0) + (t.manual ? 3 : 1));
  }
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const fill = [...m.ds.categories.values()]
    .filter((c) => c.kind === kind && c.id !== 'uncategorized' && !ranked.includes(c.id))
    .map((c) => c.id);
  return [...ranked, ...fill].slice(0, n);
}

export function categoryName(m: Model, id: string): string {
  if (id.startsWith('unitemized-'))
    return `Unitemized · ${m.ds.accounts.get(id.slice(11))?.name ?? id.slice(11)}`;
  return m.ds.categories.get(id)?.name ?? id;
}
