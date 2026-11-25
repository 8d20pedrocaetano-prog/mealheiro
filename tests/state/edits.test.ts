/**
 * M3 edits against the demo data: each edit is a list of ops; applying them and rebuilding the model must
 * give the totals SPEC §4.2 / §4.6 ask for.
 */
import { describe, expect, it } from 'vitest';
import { totalsOf } from '../../src/core/aggregates';
import { parseTables } from '../../src/core/dataset';
import { buildModel, type Model } from '../../src/core/model';
import { reviewCards } from '../../src/core/review';
import {
  previewRule,
  reorderRules,
  ruleHits,
  suggestPattern,
  validatePattern,
} from '../../src/core/ruleTools';
import { parseSettings, type RuleRow } from '../../src/core/schema';
import { effOf } from '../../src/core/view';
import * as E from '../../src/state/edits';
import { applyOps, type Op } from '../../src/sync/ops';
import { loadDemoFiles } from '../helpers/fixtures';

const files = loadDemoFiles();
const base = parseTables(files);
const settings = parseSettings(files['settings.json']);
const TODAY = '2026-10-31';
const model0 = buildModel(base, settings, TODAY);

function apply(_m: Model, ops: E.NewOp[], prevOps: Op[] = []): { m: Model; ops: Op[] } {
  const all = [...prevOps, ...ops.map((o, i) => ({ ...o, id: `op${prevOps.length + i}`, at: 'x' }))];
  return { m: buildModel(applyOps(base, all), settings, TODAY), ops: all };
}

const bucket = (m: Model, month: string, key: string) => Number(m.summary[month]?.[key] ?? 0);

describe('recategorise', () => {
  it('moves the amount between groups and keeps Spent', () => {
    const t = model0.ds.txns.find(
      (x) => x.value_date.startsWith('2026-10') && effOf(model0.view, x).categoryId === 'groceries',
    )!;
    const { m } = apply(model0, E.recategorise(t, 'restaurants'));
    expect(effOf(m.view, t).categoryId).toBe('restaurants');
    expect(effOf(m.view, t).source).toBe('override');
    expect(totalsOf('2026-10', m.summary['2026-10']).spent).toBe(
      totalsOf('2026-10', model0.summary['2026-10']).spent,
    );
    // groceries and restaurants are both Food: the group total is unchanged too
    expect(bucket(m, '2026-10', 'spend:Food')).toBe(bucket(model0, '2026-10', 'spend:Food'));
  });

  it('moves money between groups when the group changes', () => {
    const t = model0.ds.txns.find(
      (x) => x.value_date.startsWith('2026-10') && effOf(model0.view, x).categoryId === 'groceries',
    )!;
    const { m } = apply(model0, E.recategorise(t, 'clothing'));
    expect(bucket(m, '2026-10', 'spend:Shopping') - bucket(model0, '2026-10', 'spend:Shopping')).toBe(
      t.amount,
    );
    expect(bucket(m, '2026-10', 'spend:Food') - bucket(model0, '2026-10', 'spend:Food')).toBe(-t.amount);
  });
});

describe('cash itemisation (SPEC §4.2 AC)', () => {
  const w = model0.ds.txns.find(
    (x) =>
      effOf(model0.view, x).categoryId === 'cash-withdrawal' &&
      x.amount === -6000 &&
      !x.value_date.startsWith('2026-09'),
  )!;

  it('itemising 15,50 € of a 60 € withdrawal moves it from Unitemized to Restaurants', () => {
    expect(w).toBeTruthy();
    const month = w.value_date.slice(0, 7);
    const { m } = apply(model0, E.itemiseCash(model0, w, [{ categoryId: 'restaurants', amount: 1550 }]));
    const before = totalsOf(month, model0.summary[month]);
    const after = totalsOf(month, m.summary[month]);
    expect(after.spent).toBe(before.spent);
    expect(after.saved).toBe(before.saved);
    const lines = (mm: Model, cat: string) =>
      mm.lines.filter((l) => l.month === month && l.reportCategory === cat).reduce((s, l) => s + l.amount, 0);
    expect(lines(m, 'unitemized-cash') - lines(model0, 'unitemized-cash')).toBe(1550);
    expect(lines(m, 'restaurants') - lines(model0, 'restaurants')).toBe(-1550);
    const entry = m.ds.txns.find((x) => x.manual?.linked_txn_id === w.id)!;
    expect(entry.account_id).toBe('cash');
    expect(entry.value_date).toBe(w.value_date);
    expect(entry.amount).toBe(-1550);
  });

  it('editing the lines updates and removes manual rows', () => {
    const first = apply(model0, E.itemiseCash(model0, w, [{ categoryId: 'restaurants', amount: 1550 }]));
    const id = first.m.ds.txns.find((x) => x.manual?.linked_txn_id === w.id)!.id;
    const second = apply(
      first.m,
      E.itemiseCash(first.m, w, [
        { id, categoryId: 'restaurants', amount: 2000 },
        { categoryId: 'groceries', amount: 1000 },
      ]),
      first.ops,
    );
    const linked = second.m.ds.txns.filter((x) => x.manual?.linked_txn_id === w.id);
    expect(linked.map((x) => x.amount).sort((a, b) => a - b)).toEqual([-2000, -1000]);
    const third = apply(second.m, E.itemiseCash(second.m, w, []), second.ops);
    expect(third.m.ds.txns.filter((x) => x.manual?.linked_txn_id === w.id)).toHaveLength(0);
  });
});

describe('rules', () => {
  it('suggests anchored patterns', () => {
    expect(suggestPattern({ descNorm: 'REPSOL E0123 LISBOA' })).toBe('^REPSOL');
    expect(suggestPattern({ descNorm: 'EDP COMERCIAL' })).toBe('^EDP COMERCIAL');
    expect(suggestPattern({ descNorm: 'TRF MBWAY 912XXX001' })).toBe('^TRF MBWAY 912XXX001');
    expect(suggestPattern({ descNorm: 'TFI JOANA FICTICIA SI' })).toBe('^TFI JOANA FICTICIA SI');
    expect(suggestPattern({ descNorm: 'A.B C*D 12' })).toBe('^A\\.B C\\*D');
  });

  it('validates the shared regex subset', () => {
    expect(validatePattern('^PINGO')).toBeNull();
    expect(validatePattern('')).not.toBeNull();
    expect(validatePattern('(?<=X)Y')).not.toBeNull();
    expect(validatePattern('(?P<n>X)')).not.toBeNull();
    expect(validatePattern('(?i)x')).not.toBeNull();
    expect(validatePattern('([')).not.toBeNull();
  });

  it('previews exactly what saving the rule changes', () => {
    const draft = {
      pattern: '^PINGO',
      direction: 'out' as const,
      amount_min: '',
      amount_max: '',
      account_id: '',
      merchant: 'Pingo Doce',
      category_id: 'home-supplies',
    };
    const p = previewRule(model0.ds, model0.view, draft);
    expect(p.matches.length).toBeGreaterThan(0);
    const { m } = apply(model0, E.addRule(model0, draft));
    const changed = model0.ds.txns.filter(
      (t) => effOf(model0.view, t).categoryId !== effOf(m.view, t).categoryId,
    );
    expect(changed.map((t) => t.id).sort()).toEqual(p.changes.map((t) => t.id).sort());
    const rule = m.ds.rules[0].row;
    expect(rule.id).toMatch(/^u\d{3}$/);
    expect(rule.source).toBe('user');
    expect(effOf(m.view, p.matches[0]).merchant).toBe('Pingo Doce');
    expect(ruleHits(m.ds, m.view).get(rule.id)).toBe(p.matches.length - p.keptByOverride);
  });

  it('reorders by swapping distinct priorities, else renumbers', () => {
    const r = (id: string, priority: string) => ({ id, priority }) as RuleRow;
    expect(reorderRules([r('a', '1'), r('b', '5'), r('c', '9')], 2, 0)).toEqual([
      { id: 'c', priority: '1' },
      { id: 'a', priority: '5' },
      { id: 'b', priority: '9' },
    ]);
    expect(reorderRules([r('a', '1'), r('b', '1'), r('c', '2')], 1, 0)).toEqual([
      { id: 'b', priority: '10' },
      { id: 'a', priority: '20' },
      { id: 'c', priority: '30' },
    ]);
    expect(reorderRules([r('a', '1')], 0, 1)).toEqual([]);
  });
});

describe('review inbox', () => {
  const cards = reviewCards(model0);

  it('groups unknown people by description and direction', () => {
    const people = cards.filter((c) => c.type === 'person');
    expect(people.map((c) => c.type === 'person' && c.key)).toEqual(
      expect.arrayContaining(['TFI JOANA FICTICIA SI', 'TFI TIAGO TESTE NUNES']),
    );
    // Ana has a user rule already: not unknown
    expect(people.some((c) => c.type === 'person' && c.key.startsWith('TFI ANA'))).toBe(false);
  });

  it('naming a person removes their card and keeps their category', () => {
    const joana = cards.find((c) => c.type === 'person' && c.key === 'TFI JOANA FICTICIA SI')!;
    if (joana.type !== 'person') throw new Error();
    const { m } = apply(model0, E.namePerson(model0, joana.key, joana.direction, 'Joana', joana.categoryId));
    expect(reviewCards(m).some((c) => c.id === joana.id)).toBe(false);
    expect(effOf(m.view, joana.txns[0]).merchant).toBe('Joana');
    expect(effOf(m.view, joana.txns[0]).categoryId).toBe('people-in');
  });

  it('answers payback and pass-through cards through overrides', () => {
    for (const c of cards) {
      if (c.type === 'payback') {
        const linked = apply(model0, E.linkPayback(model0, c.incoming, c.expense)).m;
        expect(effOf(linked.view, c.incoming).categoryId).toBe(effOf(model0.view, c.expense).categoryId);
        expect(reviewCards(linked).some((x) => x.id === c.id)).toBe(false);
        const no = apply(model0, E.confirmCategory(model0, c.incoming)).m;
        expect(reviewCards(no).some((x) => x.id === c.id)).toBe(false);
      }
      if (c.type === 'pass-through') {
        const linked = apply(model0, E.linkPassThrough(c.incoming, c.outgoing, 'groceries')).m;
        expect(reviewCards(linked).some((x) => x.id === c.id)).toBe(false);
      }
    }
  });

  it('confirming a suggestion clears an uncategorised card', () => {
    const u = cards.find((c) => c.type === 'uncategorised');
    if (!u || u.type !== 'uncategorised') return;
    const { m } = apply(model0, E.recategorise(u.txn, u.suggestion ?? 'groceries'));
    expect(reviewCards(m).some((x) => x.id === u.id)).toBe(false);
  });
});

describe('quick add and snapshots', () => {
  it('adds a cash expense as a manual row and a balance snapshot', () => {
    const add = E.addManual(model0, {
      accountId: 'cash',
      date: '2026-10-30',
      amount: -450,
      categoryId: 'cafes-snacks',
      note: 'bica',
    });
    expect(add[0].row!.id).toMatch(/^m-[0-9a-f-]{36}$/);
    const { m } = apply(model0, [...add, ...E.balanceSnapshot('revolut', '2026-10-31', 12345)]);
    const t = m.ds.txns.find((x) => x.id === add[0].row!.id)!;
    expect(t.amount).toBe(-450);
    expect(effOf(m.view, t).categoryId).toBe('cafes-snacks');
    expect(m.ds.balances.some((b) => b.account_id === 'revolut' && b.balance === '123.45')).toBe(true);
  });

  it('links on-the-spot cash entries to a withdrawal', () => {
    const w = model0.ds.txns.find((x) => effOf(model0.view, x).categoryId === 'cash-withdrawal')!;
    const add = E.addManual(model0, {
      accountId: 'cash',
      date: w.value_date,
      amount: -300,
      categoryId: 'cafes-snacks',
    });
    const a = apply(model0, add);
    const entry = a.m.ds.txns.find((x) => x.id === add[0].row!.id)!;
    const b = apply(a.m, E.linkCashEntries([entry], w), a.ops);
    expect(b.m.ds.txns.find((x) => x.id === entry.id)!.manual!.linked_txn_id).toBe(w.id);
  });
});

describe('merge categories', () => {
  it('moves everything from one category to another and removes it', () => {
    const before = bucket(model0, '2026-10', 'spend:Food');
    const { m } = apply(model0, E.mergeCategory(model0, 'cafes-snacks', 'restaurants'));
    expect(m.ds.categories.has('cafes-snacks')).toBe(false);
    expect(m.ds.txns.some((t) => effOf(m.view, t).categoryId === 'cafes-snacks')).toBe(false);
    expect(bucket(m, '2026-10', 'spend:Food')).toBe(before);
  });
});

describe('editing rules in place', () => {
  it('previews an edit exactly', async () => {
    const { previewEdit } = await import('../../src/core/ruleTools');
    const r = model0.ds.rules.find((x) => x.row.category_id === 'groceries')!.row;
    const draft = { ...r, category_id: 'restaurants' } as unknown as Parameters<typeof previewEdit>[3];
    const p = previewEdit(model0.ds, model0.view, r.id, draft);
    const { m } = apply(model0, [E.updateRule(r.id, { category_id: 'restaurants' })]);
    const changed = model0.ds.txns.filter(
      (t) => effOf(model0.view, t).categoryId !== effOf(m.view, t).categoryId,
    );
    expect(changed.length).toBeGreaterThan(0);
    expect(p.changes.map((t) => t.id).sort()).toEqual(changed.map((t) => t.id).sort());
    const del = previewEdit(model0.ds, model0.view, r.id, null);
    const { m: m2 } = apply(model0, [E.deleteRule(r.id)]);
    const changed2 = model0.ds.txns.filter(
      (t) => effOf(model0.view, t).categoryId !== effOf(m2.view, t).categoryId,
    );
    expect(del.changes.map((t) => t.id).sort()).toEqual(changed2.map((t) => t.id).sort());
  });
});
