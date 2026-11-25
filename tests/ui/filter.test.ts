import { describe, expect, it } from 'vitest';
import { activityHref, parseFilter } from '../../src/ui/lib/filter';

describe('activity filter links', () => {
  it('keeps merchant, search text and label out of the URL (ARCHITECTURE §7)', () => {
    const f = {
      from: '2026-10-01',
      to: '2026-10-31',
      kind: 'expense' as const,
      cat: 'groceries',
      merchant: 'Pingo Doce',
      q: '12,50',
      label: 'Pingo Doce · October 2026',
    };
    const l = activityHref(f);
    expect(l.to).toBe('/activity?from=2026-10-01&to=2026-10-31&kind=expense&cat=groceries');
    expect(l.to).not.toMatch(/Pingo|12/);
    const back = parseFilter(new URLSearchParams(l.to.split('?')[1]), l.state);
    expect(back).toEqual(f);
  });

  it('has no state when nothing private is set, and ignores junk state', () => {
    expect(activityHref({ acct: 'cgd', review: true }).state).toBeNull();
    expect(parseFilter(new URLSearchParams('acct=cgd&review=1'), { pf: { merchant: 3 } })).toEqual({
      acct: 'cgd',
      review: true,
    });
  });
});
