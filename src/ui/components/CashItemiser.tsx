import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import type { Txn } from '../../core/dataset';
import { formatMoneyCsv, parseUserAmount } from '../../core/money';
import { itemisedFor } from '../../core/review';
import { itemiseCash } from '../../state/edits';
import { useApp, useModel } from '../../state/store';
import { categoryName, mostUsedCategories } from '../lib/categories';
import { fmtDate, formatEUR } from '../lib/format';
import { CategoryGrid } from './CategoryGrid';
import { Button, inputCls } from './ui';

interface Line {
  id?: string;
  categoryId: string;
  amount: string;
  note: string;
}

const toInput = (cents: number) => formatMoneyCsv(cents).replace('.', ',');

/**
 * "What was this cash for?" (SPEC §4.2): one line pre-filled with the full amount; pick a category and save.
 * "Split" adds lines; whatever isn't assigned stays unitemized cash.
 */
export function CashItemiser({ t, onDone }: { t: Txn; onDone: () => void }) {
  const m = useModel();
  const commit = useApp((s) => s.commit);
  const total = -t.amount;
  const existing = itemisedFor(m, t);
  const [lines, setLines] = useState<Line[]>(() =>
    existing.length
      ? existing.map((x) => ({
          id: x.id,
          categoryId: x.manual!.category_id,
          amount: toInput(-x.amount),
          note: x.manual!.note,
        }))
      : [{ categoryId: '', amount: toInput(total), note: '' }],
  );
  const [active, setActive] = useState<number | null>(existing.length ? null : 0);
  const cents = lines.map((l) => parseUserAmount(l.amount));
  const assigned = cents.reduce<number>((s, c) => s + (c && c > 0 ? c : 0), 0);
  const invalid =
    cents.some((c) => c === null || c <= 0) || lines.some((l) => !l.categoryId) || assigned > total;
  const top = mostUsedCategories(m, 'expense');

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const save = async (out: Line[]) => {
    await commit(
      itemiseCash(
        m,
        t,
        out.map((l) => ({
          id: l.id,
          categoryId: l.categoryId,
          amount: parseUserAmount(l.amount) ?? 0,
          note: l.note,
        })),
      ),
    );
    onDone();
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-2">
        {formatEUR(total)} withdrawn on {fmtDate(t.value_date)}. Whatever you don't assign stays unitemized
        cash.
      </p>

      <ul className="flex flex-col gap-2">
        {lines.map((l, i) => (
          <li key={i} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActive(active === i ? null : i)}
              className={`flex h-11 min-w-0 flex-1 items-center rounded-xl border px-3 text-left text-sm ${
                active === i ? 'border-accent' : 'border-line'
              } ${l.categoryId ? '' : 'text-ink-3'}`}
            >
              <span className="truncate">
                {l.categoryId ? categoryName(m, l.categoryId) : 'Pick a category'}
              </span>
            </button>
            <input
              value={l.amount}
              onChange={(e) => setLine(i, { amount: e.target.value })}
              inputMode="decimal"
              aria-label={`Amount for line ${i + 1}`}
              className={`${inputCls} num w-28 text-right`}
            />
            {lines.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  setLines((ls) => ls.filter((_, j) => j !== i));
                  setActive(null);
                }}
                className="flex size-11 shrink-0 items-center justify-center rounded-full text-ink-2"
                aria-label={`Remove line ${i + 1}`}
              >
                <X size={18} />
              </button>
            )}
          </li>
        ))}
      </ul>

      {active !== null && lines[active] && (
        <CategoryGrid
          value={lines[active].categoryId}
          top={top}
          kinds={['expense']}
          onPick={(id) => {
            setLine(active, { categoryId: id });
            setActive(null);
          }}
        />
      )}

      <div className="flex items-center justify-between text-sm">
        <span className={`num ${assigned > total ? 'text-bad' : 'text-ink-2'}`}>
          {formatEUR(assigned)} of {formatEUR(total)} itemised
          {assigned > total ? ' (more than withdrawn)' : ''}
        </span>
        <Button
          variant="ghost"
          onClick={() => {
            setLines((ls) => [
              ...ls,
              { categoryId: '', amount: toInput(Math.max(0, total - assigned)), note: '' },
            ]);
            setActive(lines.length);
          }}
        >
          <Plus size={16} /> Split
        </Button>
      </div>

      <div className="flex gap-2">
        {existing.length > 0 && (
          <Button variant="danger" onClick={() => save([])}>
            Remove all
          </Button>
        )}
        <Button variant="primary" className="flex-1" disabled={invalid} onClick={() => save(lines)}>
          Save
        </Button>
      </div>
    </div>
  );
}
