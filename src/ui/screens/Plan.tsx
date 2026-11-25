import { ChevronLeft, ChevronRight, CircleAlert, CircleCheck, Plus, Sparkles, Target } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { budgetStatuses, suggestLimit, type BudgetStatus } from '../../core/budgets';
import { addMonths, monthOf } from '../../core/dates';
import { confirmedTripMemberIds } from '../../core/events';
import { goalStatus } from '../../core/goals';
import { formatMoneyCsv, parseUserAmount, tryParseMoney, type Cents } from '../../core/money';
import type { BudgetRow, GoalRow } from '../../core/schema';
import { isTrue } from '../../core/schema';
import { deleteGoal, saveGoal, setBudget, stopBudget, type BudgetDraft } from '../../state/edits';
import { useApp, useModel } from '../../state/store';
import { BudgetBar } from '../components/BudgetBar';
import { CategoryGrid } from '../components/CategoryGrid';
import { Sheet } from '../components/Sheet';
import { Button, Card, CardTitle, Empty, Field, Segmented, Switch, inputCls } from '../components/ui';
import { categoryName } from '../lib/categories';
import { activityHref } from '../lib/filter';
import { fmtDate, fmtMonth, fmtPct, formatEUR, plural } from '../lib/format';

const toInput = (c: Cents) => formatMoneyCsv(c).replace('.', ',');

function targetName(m: ReturnType<typeof useModel>, scope: string, target: string): string {
  if (scope === 'total') return 'All spending';
  if (scope === 'group') return target;
  return categoryName(m, target);
}

const STATE: Record<BudgetStatus['state'], { label: string; cls: string; icon: ReactNode }> = {
  ok: { label: 'On track', cls: 'text-ink-3', icon: <CircleCheck size={14} /> },
  'over-pace': { label: 'Over pace', cls: 'text-warn', icon: <CircleAlert size={14} /> },
  'projected-over': { label: 'Heading over', cls: 'text-warn', icon: <CircleAlert size={14} /> },
  over: { label: 'Over', cls: 'text-bad', icon: <CircleAlert size={14} /> },
};

/** SPEC §4.4: budgets and goals. */
export function Plan() {
  const m = useModel();
  const current = monthOf(m.today);
  const [month, setMonth] = useState(current);
  const [editing, setEditing] = useState<BudgetStatus | 'new' | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [goal, setGoal] = useState<GoalRow | 'new' | null>(null);
  const statuses = useMemo(
    () =>
      budgetStatuses(m.view, m.lines, month, m.today).sort(
        (a, b) =>
          (a.row.scope === 'total' ? -1 : 0) - (b.row.scope === 'total' ? -1 : 0) ||
          b.spent / b.limit - a.spent / a.limit,
      ),
    [m, month],
  );
  const goals = useMemo(() => m.ds.goals.map((g) => goalStatus(m.ds, m.lines, g, m.today)), [m]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setMonth(addMonths(month, -1))}
          className="flex size-11 items-center justify-center rounded-full text-ink-2"
          aria-label="Previous month"
        >
          <ChevronLeft size={22} />
        </button>
        <h1 className="text-lg font-semibold" data-testid="plan-month">
          {fmtMonth(month)}
        </h1>
        <button
          type="button"
          onClick={() => setMonth(addMonths(month, 1))}
          disabled={month > current}
          className="flex size-11 items-center justify-center rounded-full text-ink-2 disabled:opacity-30"
          aria-label="Next month"
        >
          <ChevronRight size={22} />
        </button>
      </div>

      <Card>
        <CardTitle
          action={
            <div className="flex gap-1">
              <Button variant="ghost" className="min-h-9 px-2 text-sm" onClick={() => setSuggesting(true)}>
                <Sparkles size={16} /> Suggest
              </Button>
              <Button variant="ghost" className="min-h-9 px-2 text-sm" onClick={() => setEditing('new')}>
                <Plus size={16} /> Add
              </Button>
            </div>
          }
        >
          Budgets
        </CardTitle>
        {statuses.length === 0 && (
          <Empty>
            No budgets for {fmtMonth(month)}.{' '}
            {m.months.length >= 2
              ? 'Tap Suggest to start from your averages, or Add to set a limit.'
              : 'Tap Add to set a monthly limit. After a couple of months, Suggest proposes limits from your averages.'}
          </Empty>
        )}
        <ul className="divide-y divide-line pb-1" data-testid="budget-list">
          {statuses.map((s) => {
            const st = STATE[s.state];
            return (
              <li key={s.row.id}>
                <button
                  type="button"
                  onClick={() => setEditing(s)}
                  className="flex w-full flex-col gap-1.5 px-4 py-3 text-left hover:bg-surface-2"
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-medium">{targetName(m, s.row.scope, s.row.target)}</span>
                    <span className="num shrink-0 text-sm">
                      {formatEUR(s.spent, { compact: true })} / {formatEUR(s.limit, { compact: true })}
                    </span>
                  </span>
                  <BudgetBar
                    spent={s.spent}
                    limit={s.limit}
                    pace={month === current ? s.pace : null}
                    projected={month === current ? s.projected : undefined}
                  />
                  <span className="flex justify-between text-xs">
                    <span className={`flex items-center gap-1 ${st.cls}`}>
                      {st.icon}
                      {st.label}
                      {month === current && s.state !== 'over'
                        ? ` · ends near ${formatEUR(s.projected, { compact: true })}`
                        : ''}
                    </span>
                    <span className="num text-ink-3">
                      {s.left >= 0
                        ? `${formatEUR(s.left, { compact: true })} left`
                        : `${formatEUR(-s.left, { compact: true })} over`}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <CardTitle
          action={
            <Button variant="ghost" className="min-h-9 px-2 text-sm" onClick={() => setGoal('new')}>
              <Plus size={16} /> Add
            </Button>
          }
        >
          Goals
        </CardTitle>
        {goals.length === 0 && (
          <Empty>
            No goals yet. Add one to save towards an amount by a date, like an emergency fund or a deposit.
          </Empty>
        )}
        <ul className="divide-y divide-line pb-1">
          {goals.map((g) => (
            <li key={g.goal.id}>
              <button
                type="button"
                onClick={() => setGoal(g.goal)}
                className="flex w-full flex-col gap-1.5 px-4 py-3 text-left hover:bg-surface-2"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="flex items-center gap-2 truncate font-medium">
                    <Target size={16} className="text-ink-2" />
                    {g.goal.name}
                  </span>
                  <span className="num shrink-0 text-sm">{fmtPct(g.progress)}</span>
                </span>
                <BudgetBar
                  spent={Math.max(0, (g.value ?? 0) - g.startAmount)}
                  limit={g.target - g.startAmount}
                  pace={null}
                />
                <span className="flex flex-wrap justify-between gap-x-3 text-xs">
                  <span className="num text-ink-2">
                    {formatEUR(g.value ?? 0, { compact: true })} of {formatEUR(g.target, { compact: true })}{' '}
                    by {fmtDate(g.goal.target_date)}
                  </span>
                  <span className={`flex items-center gap-1 ${g.onTrack ? 'text-good' : 'text-warn'}`}>
                    {g.onTrack ? <CircleCheck size={13} /> : <CircleAlert size={13} />}
                    {g.value === null ? 'Value unknown' : g.onTrack ? 'On track' : 'Behind'} ·{' '}
                    {formatEUR(g.requiredPerMonth, { compact: true })}/month
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <Sheet
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        title={
          editing === 'new'
            ? 'New budget'
            : editing
              ? targetName(m, editing.row.scope, editing.row.target)
              : ''
        }
        description={`From ${fmtMonth(month)} on`}
      >
        {editing && (
          <BudgetSheet
            key={editing === 'new' ? 'new' : editing.row.id}
            s={editing === 'new' ? null : editing}
            month={month}
            onDone={() => setEditing(null)}
          />
        )}
      </Sheet>
      <Sheet
        open={suggesting}
        onOpenChange={setSuggesting}
        title="Suggest budgets"
        description={`From ${fmtMonth(month)} on`}
      >
        {suggesting && <SuggestSheet month={month} onDone={() => setSuggesting(false)} />}
      </Sheet>
      <Sheet
        open={!!goal}
        onOpenChange={(o) => !o && setGoal(null)}
        title={goal === 'new' ? 'New goal' : (goal?.name ?? '')}
      >
        {goal && (
          <GoalSheet
            key={goal === 'new' ? 'new' : goal.id}
            g={goal === 'new' ? null : goal}
            onDone={() => setGoal(null)}
          />
        )}
      </Sheet>
    </div>
  );
}

function pseudoRow(scope: string, target: string, exclude: boolean): BudgetRow {
  return {
    id: 'x',
    scope,
    target,
    monthly_limit: '0',
    start_month: '',
    end_month: '',
    exclude_events: exclude ? 'true' : 'false',
    notes: '',
  };
}

function BudgetSheet({ s, month, onDone }: { s: BudgetStatus | null; month: string; onDone: () => void }) {
  const m = useModel();
  const commit = useApp((x) => x.commit);
  const [scope, setScope] = useState<BudgetDraft['scope']>(
    (s?.row.scope as BudgetDraft['scope']) ?? 'category',
  );
  const [target, setTarget] = useState(s?.row.target ?? '');
  const [limit, setLimit] = useState(s ? toInput(s.limit) : '');
  const [exclude, setExclude] = useState(s ? isTrue(s.row.exclude_events) : false);
  const groups = [
    ...new Set([...m.ds.categories.values()].filter((c) => c.kind === 'expense').map((c) => c.group)),
  ].sort();
  const realTarget = scope === 'total' ? 'all' : target;
  const suggestion = realTarget
    ? suggestLimit(m.view, m.lines, pseudoRow(scope, realTarget, exclude), month)
    : 0;
  const cents = parseUserAmount(limit);
  return (
    <div className="flex flex-col gap-3">
      {!s && (
        <>
          <Segmented
            label="Budget for"
            value={scope}
            onChange={(v) => {
              setScope(v);
              setTarget('');
            }}
            options={[
              { value: 'category', label: 'Category' },
              { value: 'group', label: 'Group' },
              { value: 'total', label: 'Everything' },
            ]}
          />
          {scope === 'category' &&
            (target ? (
              <div className="flex items-center justify-between rounded-xl border border-line p-3">
                <span className="font-medium">{categoryName(m, target)}</span>
                <Button variant="ghost" onClick={() => setTarget('')}>
                  Change
                </Button>
              </div>
            ) : (
              <CategoryGrid kinds={['expense']} onPick={setTarget} />
            ))}
          {scope === 'group' && (
            <Field label="Group">
              <select value={target} onChange={(e) => setTarget(e.target.value)} className={inputCls}>
                <option value="">Pick a group</option>
                {groups.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </>
      )}
      <Field
        label="Monthly limit (€)"
        hint={suggestion ? `Your 6-month average rounds up to ${formatEUR(suggestion)}.` : undefined}
      >
        <input
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          inputMode="decimal"
          className={`${inputCls} num`}
        />
      </Field>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span>Leave out confirmed trips (they have their own budget)</span>
        <Switch checked={exclude} onChange={setExclude} label="Leave out confirmed trips" />
      </div>
      {s && (
        <Link
          {...activityHref({
            ...monthFilter(month),
            kind: 'expense',
            ...(s.row.scope === 'category'
              ? { cat: s.row.target }
              : s.row.scope === 'group'
                ? { group: s.row.target }
                : {}),
            notrips: exclude || undefined,
            label: `${targetName(m, s.row.scope, s.row.target)} · ${fmtMonth(month)}`,
          })}
          className="text-sm text-accent"
        >
          See the {plural(new Set(s.lines.map((l) => l.txn.id)).size, 'transaction')} behind{' '}
          {formatEUR(s.spent)}
        </Link>
      )}
      <p className="text-xs text-ink-3">
        Changes apply from {fmtMonth(month)} on; earlier months keep their limits.
      </p>
      <div className="flex gap-2">
        {s && (
          <Button
            variant="danger"
            onClick={async () => {
              await commit(stopBudget(m, s.row.scope, s.row.target, month));
              onDone();
            }}
          >
            Stop
          </Button>
        )}
        <Button
          variant="primary"
          className="flex-1"
          disabled={!realTarget || !cents || cents <= 0}
          onClick={async () => {
            await commit(
              setBudget(m, { scope, target: realTarget, limit: cents!, excludeEvents: exclude }, month),
            );
            onDone();
          }}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

function monthFilter(month: string) {
  const [y, mo] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** "Suggest budgets" (SPEC §4.4): every budgetable category from its 6-month average, rounded up to €5. */
function SuggestSheet({ month, onDone }: { month: string; onDone: () => void }) {
  const m = useModel();
  const commit = useApp((x) => x.commit);
  const rows = useMemo(() => {
    const trips = confirmedTripMemberIds(m.view);
    const active = new Map(
      budgetStatuses(m.view, m.lines, month, m.today).map((s) => [`${s.row.scope}|${s.row.target}`, s]),
    );
    return [...m.ds.categories.values()]
      .filter((c) => c.kind === 'expense' && isTrue(c.budgetable))
      .map((c) => {
        const sug = suggestLimit(m.view, m.lines, pseudoRow('category', c.id, false), month, trips);
        const cur = active.get(`category|${c.id}`);
        return { id: c.id, name: c.name, suggestion: sug, current: cur?.limit ?? null };
      })
      .filter((r) => r.suggestion > 0 || r.current !== null)
      .sort((a, b) => b.suggestion - a.suggestion);
  }, [m, month]);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.id, toInput(r.current ?? r.suggestion)])),
  );
  const [on, setOn] = useState<Set<string>>(
    () => new Set(rows.filter((r) => r.current === null).map((r) => r.id)),
  );
  const total = [...on].reduce((s, id) => s + (parseUserAmount(values[id] ?? '') ?? 0), 0);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-ink-2">Ticked rows are saved. Adjust any amount first.</p>
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.id} className="flex min-h-12 items-center gap-3 py-1">
            <input
              type="checkbox"
              checked={on.has(r.id)}
              onChange={(e) =>
                setOn((s) => {
                  const n = new Set(s);
                  if (e.target.checked) n.add(r.id);
                  else n.delete(r.id);
                  return n;
                })
              }
              aria-label={`Set a budget for ${r.name}`}
              className="size-5 shrink-0 accent-[var(--accent)]"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{r.name}</span>
              <span className="block text-xs text-ink-3">
                avg {formatEUR(r.suggestion)}
                {r.current !== null ? ` · now ${formatEUR(r.current)}` : ''}
              </span>
            </span>
            <input
              value={values[r.id] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [r.id]: e.target.value }))}
              inputMode="decimal"
              aria-label={`Limit for ${r.name}`}
              className={`${inputCls} num w-28 text-right`}
            />
          </li>
        ))}
      </ul>
      <Button
        variant="primary"
        disabled={on.size === 0}
        onClick={async () => {
          const ops = [...on].flatMap((id) => {
            const c = parseUserAmount(values[id] ?? '');
            return c && c > 0
              ? setBudget(m, { scope: 'category', target: id, limit: c, excludeEvents: false }, month)
              : [];
          });
          await commit(ops);
          onDone();
        }}
      >
        Set {plural(on.size, 'budget')} ({formatEUR(total)} a month)
      </Button>
    </div>
  );
}

function GoalSheet({ g, onDone }: { g: GoalRow | null; onDone: () => void }) {
  const m = useModel();
  const commit = useApp((x) => x.commit);
  const [name, setName] = useState(g?.name ?? '');
  const [target, setTarget] = useState(g ? toInput(tryParseMoney(g.target_amount) ?? 0) : '');
  const [date, setDate] = useState(g?.target_date ?? `${Number(m.today.slice(0, 4)) + 1}-12-31`);
  const [basis, setBasis] = useState(g?.basis ?? 'savings-since-start');
  const [start, setStart] = useState(g?.start_date ?? `${monthOf(m.today)}-01`);
  const [startAmount, setStartAmount] = useState(g ? toInput(tryParseMoney(g.start_amount) ?? 0) : '0');
  const cents = parseUserAmount(target);
  const startCents = parseUserAmount(startAmount) ?? 0;
  return (
    <div className="flex flex-col gap-3">
      <Field label="Name">
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Target (€)">
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            inputMode="decimal"
            className={`${inputCls} num`}
          />
        </Field>
        <Field label="By">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
        </Field>
      </div>
      <Field
        label="Measured by"
        hint="Savings since start adds up income minus spending for each whole month."
      >
        <select value={basis} onChange={(e) => setBasis(e.target.value)} className={inputCls}>
          <option value="savings-since-start">Savings since the start date</option>
          <option value="net-worth">Net worth</option>
          {[...m.ds.accounts.values()].map((a) => (
            <option key={a.id} value={`account:${a.id}`}>
              Balance of {a.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Start date">
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Starting amount (€)">
          <input
            value={startAmount}
            onChange={(e) => setStartAmount(e.target.value)}
            inputMode="decimal"
            className={`${inputCls} num`}
          />
        </Field>
      </div>
      <div className="flex gap-2">
        {g && (
          <Button
            variant="danger"
            onClick={async () => {
              await commit(deleteGoal(g.id));
              onDone();
            }}
          >
            Delete
          </Button>
        )}
        <Button
          variant="primary"
          className="flex-1"
          disabled={!name.trim() || !cents || cents <= 0 || !date || !start}
          onClick={async () => {
            await commit(
              saveGoal(m, {
                id: g?.id,
                name,
                target: cents!,
                targetDate: date,
                basis,
                startDate: start,
                startAmount: startCents,
              }),
            );
            onDone();
          }}
        >
          {g ? 'Save goal' : 'Add goal'}
        </Button>
      </div>
    </div>
  );
}
