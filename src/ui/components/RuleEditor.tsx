import { useDeferredValue, useMemo, useState } from 'react';
import { formatMoneyCsv, parseUserAmount } from '../../core/money';
import { previewEdit, previewRule, validatePattern, type RuleDraft } from '../../core/ruleTools';
import { effOf } from '../../core/view';
import { addRule, deleteRule, updateRule } from '../../state/edits';
import { useApp, useModel } from '../../state/store';
import { categoryName } from '../lib/categories';
import { fmtDate, formatEUR, plural } from '../lib/format';
import { CategoryGrid } from './CategoryGrid';
import { Button, Field, Segmented, inputCls } from './ui';

const bound = (s: string) => {
  const c = parseUserAmount(s);
  return c === null ? '' : formatMoneyCsv(Math.abs(c));
};
/** Amount bounds as the CSV stores them (`12.50`), whatever the owner typed (`12,5`). */
const normalise = (d: RuleDraft): RuleDraft => ({
  ...d,
  amount_min: bound(d.amount_min),
  amount_max: bound(d.amount_max),
});

/**
 * Create or edit a rule, with a live preview of how many past transactions it changes before saving
 * (SPEC §4.2 "Apply to all like this?", §4.9 Rules).
 */
export function RuleEditor({
  initial,
  ruleId,
  onDone,
}: {
  initial: RuleDraft;
  /** Editing an existing rule (keeps its place in the order). */
  ruleId?: string;
  onDone: () => void;
}) {
  const m = useModel();
  const commit = useApp((s) => s.commit);
  const [d, setD] = useState<RuleDraft>(initial);
  const [picking, setPicking] = useState(false);
  const [more, setMore] = useState(!!(initial.amount_min || initial.amount_max || initial.account_id));
  const deferred = useDeferredValue(d);
  const draft = useMemo(() => normalise(deferred), [deferred]);
  const error = validatePattern(d.pattern);
  const preview = useMemo(
    () => (ruleId ? previewEdit(m.ds, m.view, ruleId, draft) : previewRule(m.ds, m.view, draft)),
    [m, ruleId, draft],
  );
  const set = (patch: Partial<RuleDraft>) => setD((x) => ({ ...x, ...patch }));

  const save = async () => {
    if (error || !d.category_id) return;
    const row = normalise(d);
    await commit(ruleId ? [updateRule(ruleId, { ...row })] : addRule(m, row));
    onDone();
  };
  const remove = async () => {
    if (!ruleId) return;
    await commit([deleteRule(ruleId)]);
    onDone();
  };

  if (picking)
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-ink-2">Which category should these get?</p>
        <CategoryGrid
          value={d.category_id}
          onPick={(id) => {
            set({ category_id: id });
            setPicking(false);
          }}
        />
      </div>
    );

  return (
    <div className="flex flex-col gap-3">
      <Field
        label="Description starts with / matches"
        hint="A pattern on the normalised description. ^ means “starts with”. Case doesn't matter."
      >
        <input
          value={d.pattern}
          onChange={(e) => set({ pattern: e.target.value })}
          className={`${inputCls} font-mono`}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={!!error}
        />
      </Field>
      {error && d.pattern && <p className="-mt-2 text-sm text-bad">{error}</p>}

      <Segmented
        label="Direction"
        value={d.direction}
        onChange={(direction) => set({ direction })}
        options={[
          { value: '', label: 'In and out' },
          { value: 'out', label: 'Money out' },
          { value: 'in', label: 'Money in' },
        ]}
      />

      <div className="flex items-center justify-between gap-3 rounded-xl border border-line p-3">
        <div className="min-w-0">
          <div className="text-xs text-ink-2">Category</div>
          <div className={`truncate font-medium ${d.category_id ? '' : 'text-ink-3'}`}>
            {d.category_id ? categoryName(m, d.category_id) : 'Pick a category'}
          </div>
        </div>
        <Button variant="ghost" onClick={() => setPicking(true)}>
          {d.category_id ? 'Change' : 'Pick'}
        </Button>
      </div>

      <Field label="Show as (optional)" hint="A friendly merchant name, e.g. “Pingo Doce”.">
        <input value={d.merchant} onChange={(e) => set({ merchant: e.target.value })} className={inputCls} />
      </Field>

      {more ? (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Amount from (€)">
            <input
              value={d.amount_min}
              onChange={(e) => set({ amount_min: e.target.value })}
              inputMode="decimal"
              className={inputCls}
            />
          </Field>
          <Field label="Amount up to (€)">
            <input
              value={d.amount_max}
              onChange={(e) => set({ amount_max: e.target.value })}
              inputMode="decimal"
              className={inputCls}
            />
          </Field>
          <div className="col-span-2">
            <Field label="Only on account">
              <select
                value={d.account_id}
                onChange={(e) => set({ account_id: e.target.value })}
                className={inputCls}
              >
                <option value="">Any account</option>
                {[...m.ds.accounts.values()].map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setMore(true)} className="self-start text-sm text-accent">
          More conditions (amount, account)
        </button>
      )}

      <div className="rounded-xl bg-surface-2 p-3 text-sm" aria-live="polite" data-testid="rule-preview">
        {error ? (
          <span className="text-ink-2">Enter a valid pattern to see what it matches.</span>
        ) : (
          <>
            <div className="font-medium">
              Matches {plural(preview.matches.length, 'transaction')}; changes {preview.changes.length}.
            </div>
            {preview.keptByOverride > 0 && (
              <div className="text-ink-2">
                {preview.keptByOverride === 1
                  ? '1 transaction you set by hand stays as it is.'
                  : `${preview.keptByOverride} transactions you set by hand stay as they are.`}
              </div>
            )}
            <ul className="mt-2 flex flex-col gap-1">
              {preview.changes.slice(0, 5).map((t) => (
                <li key={t.id} className="flex justify-between gap-2 text-xs text-ink-2">
                  <span className="truncate">
                    {fmtDate(t.value_date)} · {t.description_raw} ·{' '}
                    {categoryName(m, effOf(m.view, t).categoryId)}
                  </span>
                  <span className="num shrink-0">{formatEUR(t.amount)}</span>
                </li>
              ))}
              {preview.changes.length > 5 && (
                <li className="text-xs text-ink-3">and {preview.changes.length - 5} more</li>
              )}
            </ul>
          </>
        )}
      </div>

      <div className="flex gap-2">
        {ruleId && (
          <Button variant="danger" onClick={remove}>
            Delete
          </Button>
        )}
        <Button variant="primary" className="flex-1" onClick={save} disabled={!!error || !d.category_id}>
          {ruleId ? 'Save rule' : 'Create rule'}
        </Button>
      </div>
    </div>
  );
}
