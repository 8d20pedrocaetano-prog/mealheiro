import { ArrowDown, ArrowUp, Plus, Search } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { accountBalance } from '../../core/goals';
import { parseUserAmount, tryParseMoney } from '../../core/money';
import { ruleHits, reorderRules, type RuleDraft } from '../../core/ruleTools';
import { isTrue, type AccountRow, type CategoryRow } from '../../core/schema';
import { balanceSnapshot, mergeCategory, updateAccount, updateRule, upsertCategory } from '../../state/edits';
import { useApp, useModel } from '../../state/store';
import { CategoryGrid } from '../components/CategoryGrid';
import { RuleEditor } from '../components/RuleEditor';
import { Sheet } from '../components/Sheet';
import { Button, Card, Field, Segmented, Switch, inputCls } from '../components/ui';
import { categoryName, groupedCategories } from '../lib/categories';
import { fmtDate, formatEUR, plural } from '../lib/format';
import { CategoryIcon, IconPicker } from '../lib/icons';
import { groupColor, tint } from '../lib/palette';

function Page({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{title}</h1>
        {action}
      </div>
      {children}
    </div>
  );
}

/* ───────────── Accounts ───────────── */

export function AccountsSettings() {
  const m = useModel();
  const commit = useApp((s) => s.commit);
  const [open, setOpen] = useState<AccountRow | null>(null);
  return (
    <Page title="Accounts">
      <p className="text-sm text-ink-2">
        A <b>tracked</b> account has all its own transactions imported or logged. Money sent to an{' '}
        <b>untracked</b> account (Revolut before its statements are imported, cash) counts as unitemized
        spending.
      </p>
      <Card className="divide-y divide-line overflow-hidden">
        {[...m.ds.accounts.values()].map((a) => {
          const b = accountBalance(m.ds, a.id);
          const tracked = isTrue(a.tracked);
          return (
            <div key={a.id} className="flex min-h-16 items-center gap-3 px-4 py-2">
              <button type="button" onClick={() => setOpen(a)} className="min-w-0 flex-1 text-left">
                <span className="block truncate font-medium">{a.name}</span>
                <span className="block text-xs text-ink-3">
                  {b ? `${formatEUR(b.balance)} on ${fmtDate(b.asOf)}` : 'Balance unknown'} ·{' '}
                  {tracked ? 'tracked' : 'untracked'}
                </span>
              </button>
              <Switch
                checked={tracked}
                label={`Track ${a.name}`}
                onChange={(v) => commit([updateAccount(a.id, { tracked: v ? 'true' : 'false' })])}
              />
            </div>
          );
        })}
      </Card>
      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)} title={open?.name ?? ''}>
        {open && <AccountSheet key={open.id} a={open} onDone={() => setOpen(null)} />}
      </Sheet>
    </Page>
  );
}

function AccountSheet({ a, onDone }: { a: AccountRow; onDone: () => void }) {
  const m = useModel();
  const commit = useApp((s) => s.commit);
  const [name, setName] = useState(a.name);
  const [date, setDate] = useState(m.today);
  const [amount, setAmount] = useState('');
  const snaps = m.ds.balances.filter((b) => b.account_id === a.id).sort((x, y) => (x.date < y.date ? 1 : -1));
  const cents = parseUserAmount(amount);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <Button
          disabled={!name.trim() || name === a.name}
          onClick={async () => {
            await commit([updateAccount(a.id, { name: name.trim() })]);
            onDone();
          }}
        >
          Rename
        </Button>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold text-ink-2">Balance snapshots</h3>
        <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
          <Field label="Date">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Balance (€)">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              className={`${inputCls} num`}
            />
          </Field>
          <Button
            variant="primary"
            disabled={cents === null || !date}
            onClick={async () => {
              await commit(balanceSnapshot(a.id, date, cents!));
              setAmount('');
            }}
          >
            Add
          </Button>
        </div>
        <ul className="mt-2 divide-y divide-line text-sm">
          {snaps.map((s) => (
            <li key={s.date} className="flex justify-between py-2">
              <span>{fmtDate(s.date)}</span>
              <span className="num">{formatEUR(tryParseMoney(s.balance) ?? 0)}</span>
            </li>
          ))}
          {snaps.length === 0 && <li className="py-2 text-ink-3">No snapshots yet.</li>}
        </ul>
      </div>
    </div>
  );
}

/* ───────────── Categories ───────────── */

function slug(name: string, taken: (id: string) => boolean): string {
  const base =
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'category';
  let id = base;
  for (let i = 2; taken(id); i++) id = `${base}-${i}`;
  return id;
}

export function CategoriesSettings() {
  const m = useModel();
  const [open, setOpen] = useState<CategoryRow | 'new' | null>(null);
  const groups = groupedCategories(m);
  return (
    <Page
      title="Categories"
      action={
        <Button variant="ghost" onClick={() => setOpen('new')}>
          <Plus size={18} /> Add
        </Button>
      }
    >
      {groups.map(({ group, cats }) => (
        <Card key={group} className="overflow-hidden">
          <div className="px-4 pt-3 pb-1 text-sm font-semibold text-ink-2">{group}</div>
          <ul className="divide-y divide-line">
            {cats.map((c) => {
              const color = groupColor(c.group);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setOpen(c)}
                    className="flex min-h-12 w-full items-center gap-3 px-4 py-1.5 text-left hover:bg-surface-2"
                  >
                    <span
                      className="flex size-8 shrink-0 items-center justify-center rounded-full"
                      style={{ background: tint(color, 0.8), color }}
                    >
                      <CategoryIcon name={c.icon} size={16} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    <span className="text-xs text-ink-3">{c.kind}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
      <Sheet
        open={!!open}
        onOpenChange={(o) => !o && setOpen(null)}
        title={open === 'new' ? 'New category' : (open?.name ?? '')}
      >
        {open && (
          <CategorySheet
            key={open === 'new' ? 'new' : open.id}
            c={open === 'new' ? null : open}
            onDone={() => setOpen(null)}
          />
        )}
      </Sheet>
    </Page>
  );
}

function CategorySheet({ c, onDone }: { c: CategoryRow | null; onDone: () => void }) {
  const m = useModel();
  const commit = useApp((s) => s.commit);
  const [name, setName] = useState(c?.name ?? '');
  const [group, setGroup] = useState(c?.group ?? '');
  const [kind, setKind] = useState<'expense' | 'income' | 'transfer'>(
    (c?.kind as 'expense' | 'income' | 'transfer') ?? 'expense',
  );
  const [counterparty, setCounterparty] = useState(c?.counterparty_account ?? '');
  const [budgetable, setBudgetable] = useState(c ? isTrue(c.budgetable) : true);
  const [icon, setIcon] = useState(c?.icon || 'tag');
  const [mergeInto, setMergeInto] = useState('');
  const [view, setView] = useState<'edit' | 'merge'>('edit');
  const groups = [...new Set([...m.ds.categories.values()].map((x) => x.group))].sort();
  const reserved = c?.id === 'uncategorized';

  const save = async () => {
    const id = c?.id ?? slug(name, (x) => m.ds.categories.has(x));
    await commit([
      upsertCategory(
        id,
        {
          name: name.trim(),
          group: group.trim() || 'Other',
          kind,
          counterparty_account: kind === 'transfer' ? counterparty : '',
          budgetable: budgetable ? 'true' : 'false',
          icon,
        },
        c ? 'edit category' : 'add category',
      ),
    ]);
    onDone();
  };

  if (view === 'merge' && c) {
    const ops = mergeInto ? mergeCategory(m, c.id, mergeInto) : [];
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink-2">
          Everything in <b>{c.name}</b> moves to the category you pick: rules, your own choices, manual
          entries, suggestions and budgets. Then {c.name} is removed.
        </p>
        {mergeInto ? (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-line p-3">
            <span className="font-medium">Into {categoryName(m, mergeInto)}</span>
            <Button variant="ghost" onClick={() => setMergeInto('')}>
              Change
            </Button>
          </div>
        ) : (
          <CategoryGrid kinds={[c.kind]} onPick={(id) => id !== c.id && setMergeInto(id)} />
        )}
        {mergeInto && (
          <Button
            variant="danger"
            onClick={async () => {
              await commit(ops);
              onDone();
            }}
          >
            Merge ({plural(ops.length - 1, 'change')})
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Field label="Name">
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
      </Field>
      <Field label="Group">
        <input
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          list="category-groups"
          className={inputCls}
        />
        <datalist id="category-groups">
          {groups.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
      </Field>
      <Segmented
        label="Kind"
        value={kind}
        onChange={setKind}
        options={[
          { value: 'expense', label: 'Expense' },
          { value: 'income', label: 'Income' },
          { value: 'transfer', label: 'Transfer' },
        ]}
      />
      {kind === 'transfer' && (
        <Field label="Other account" hint="Transfers to an untracked account count as unitemized spending.">
          <select value={counterparty} onChange={(e) => setCounterparty(e.target.value)} className={inputCls}>
            <option value="">None</option>
            {[...m.ds.accounts.values()].map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm">Can have a budget</span>
        <Switch checked={budgetable} onChange={setBudgetable} label="Can have a budget" />
      </div>
      <div>
        <div className="mb-1 text-sm text-ink-2">Icon</div>
        <IconPicker value={icon} onPick={setIcon} />
      </div>
      <div className="flex gap-2">
        {c && !reserved && <Button onClick={() => setView('merge')}>Merge into…</Button>}
        <Button variant="primary" className="flex-1" disabled={!name.trim()} onClick={save}>
          {c ? 'Save' : 'Add category'}
        </Button>
      </div>
    </div>
  );
}

/* ───────────── Rules ───────────── */

const EMPTY_RULE: RuleDraft = {
  pattern: '',
  direction: '',
  amount_min: '',
  amount_max: '',
  account_id: '',
  merchant: '',
  category_id: '',
};

export function RulesSettings() {
  const m = useModel();
  const commit = useApp((s) => s.commit);
  const [open, setOpen] = useState<string | 'new' | null>(null);
  const [q, setQ] = useState('');
  const hits = useMemo(() => ruleHits(m.ds, m.view), [m]);
  const rows = m.ds.rules.map((r) => r.row);
  const needle = q.trim().toLowerCase();
  const shown = rows
    .map((r, i) => ({ r, i }))
    .filter(
      ({ r }) =>
        !needle ||
        r.pattern.toLowerCase().includes(needle) ||
        r.merchant.toLowerCase().includes(needle) ||
        categoryName(m, r.category_id).toLowerCase().includes(needle),
    );
  const move = (i: number, to: number) => {
    const changes = reorderRules(rows, i, to);
    if (changes.length)
      commit(changes.map((c) => updateRule(c.id, { priority: c.priority }, 'reorder rules')));
  };
  const editing = open && open !== 'new' ? rows.find((r) => r.id === open) : null;

  return (
    <Page
      title="Rules"
      action={
        <Button variant="ghost" onClick={() => setOpen('new')}>
          <Plus size={18} /> Add
        </Button>
      }
    >
      <p className="text-sm text-ink-2">
        The first rule that matches decides a transaction's category, unless you set it by hand.
      </p>
      <label className="flex h-11 items-center gap-2 rounded-xl border border-line bg-surface px-3 focus-within:border-accent">
        <Search size={16} className="text-ink-3" aria-hidden="true" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Pattern, name or category"
          aria-label="Find a rule"
          className="min-w-0 flex-1 bg-transparent text-[16px] outline-none"
        />
      </label>
      <Card className="divide-y divide-line overflow-hidden">
        {shown.map(({ r, i }) => (
          <div key={r.id} className="flex items-center gap-1 py-1 pr-1 pl-4">
            <button type="button" onClick={() => setOpen(r.id)} className="min-w-0 flex-1 py-1 text-left">
              <span className="block truncate font-mono text-[13px]">/{r.pattern}/</span>
              <span className="block truncate text-xs text-ink-2">
                {r.direction ? `${r.direction === 'in' ? 'in' : 'out'} · ` : ''}
                {categoryName(m, r.category_id)}
                {r.merchant ? ` · “${r.merchant}”` : ''}
              </span>
              <span className="block text-xs text-ink-3">
                {r.id} · {r.source} · {plural(hits.get(r.id) ?? 0, 'hit')}
              </span>
            </button>
            {!needle && (
              <>
                <button
                  type="button"
                  disabled={i === 0}
                  onClick={() => move(i, i - 1)}
                  className="flex size-11 items-center justify-center rounded-full text-ink-2 disabled:opacity-30"
                  aria-label={`Move ${r.id} up`}
                >
                  <ArrowUp size={18} />
                </button>
                <button
                  type="button"
                  disabled={i === rows.length - 1}
                  onClick={() => move(i, i + 1)}
                  className="flex size-11 items-center justify-center rounded-full text-ink-2 disabled:opacity-30"
                  aria-label={`Move ${r.id} down`}
                >
                  <ArrowDown size={18} />
                </button>
              </>
            )}
          </div>
        ))}
      </Card>
      <Sheet
        open={!!open}
        onOpenChange={(o) => !o && setOpen(null)}
        title={editing ? `Rule ${editing.id}` : 'New rule'}
        description={editing ? `${editing.source} · ${plural(hits.get(editing.id) ?? 0, 'hit')}` : undefined}
      >
        {open && (
          <RuleEditor
            key={open}
            ruleId={editing?.id}
            initial={
              editing
                ? {
                    pattern: editing.pattern,
                    direction: (editing.direction as RuleDraft['direction']) || '',
                    amount_min: editing.amount_min,
                    amount_max: editing.amount_max,
                    account_id: editing.account_id,
                    merchant: editing.merchant,
                    category_id: editing.category_id,
                  }
                : EMPTY_RULE
            }
            onDone={() => setOpen(null)}
          />
        )}
      </Sheet>
    </Page>
  );
}
