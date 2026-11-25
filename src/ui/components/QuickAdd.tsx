import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { parseUserAmount } from '../../core/money';
import { addManual, balanceSnapshot } from '../../state/edits';
import { useApp, useModel } from '../../state/store';
import { categoryName, mostUsedCategories } from '../lib/categories';
import { formatEUR } from '../lib/format';
import { CategoryGrid } from './CategoryGrid';
import { Sheet } from './Sheet';
import { Button, Field, Segmented, inputCls } from './ui';
import type { Model } from '../../core/model';

type Tab = 'expense' | 'income' | 'balance';

/** Accounts Quick add may log on: no imports, so nothing gets counted twice (DATA_MODEL §3 manual.csv). */
function manualAccounts(m: Model) {
  const imported = new Set(m.ds.txns.filter((t) => !t.manual).map((t) => t.account_id));
  for (const i of m.ds.imports) imported.add(i.account_id);
  return [...m.ds.accounts.values()].filter((a) => !imported.has(a.id));
}

function tripOnDay(m: Model, day: string): string {
  const e = m.ds.events.find(
    (x) =>
      (x.type === 'trip' || x.type === 'work-trip') &&
      x.status === 'confirmed' &&
      x.start_date <= day &&
      (!x.end_date || day <= x.end_date),
  );
  return e?.id ?? '';
}

/** SPEC §4.7: from + to saved in three taps plus typing the amount. Works offline (it is just an op). */
export function QuickAdd({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Quick add">
      {open && <QuickAddForm onDone={() => onOpenChange(false)} />}
    </Sheet>
  );
}

function QuickAddForm({ onDone }: { onDone: () => void }) {
  const m = useModel();
  const commit = useApp((s) => s.commit);
  const accounts = useMemo(() => manualAccounts(m), [m]);
  const [tab, setTab] = useState<Tab>('expense');
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [date, setDate] = useState(m.today);
  const [accountId, setAccountId] = useState(
    accounts.find((a) => a.id === 'cash')?.id ??
      accounts.find((a) => a.type === 'cash')?.id ??
      accounts[0]?.id ??
      '',
  );
  const [note, setNote] = useState('');
  const [eventId, setEventId] = useState(() => tripOnDay(m, m.today));
  const [details, setDetails] = useState(false);
  const cents = parseUserAmount(amount);
  const kind = tab === 'income' ? 'income' : 'expense';
  const top = useMemo(() => mostUsedCategories(m, kind), [m, kind]);
  const events = m.ds.events.filter((e) => e.type !== 'stage' && e.status !== 'dismissed');

  const valid =
    tab === 'balance'
      ? cents !== null && !!accountId && !!date
      : !!cents && cents > 0 && !!categoryId && !!accountId;

  const save = async () => {
    if (!valid || cents === null) return;
    if (tab === 'balance') {
      await commit(balanceSnapshot(accountId, date, cents, note.trim()));
    } else {
      await commit(
        addManual(m, {
          accountId,
          date,
          amount: tab === 'expense' ? -Math.abs(cents) : Math.abs(cents),
          categoryId,
          note,
          eventId,
        }),
      );
    }
    onDone();
  };

  return (
    <div className="flex flex-col gap-3">
      <Segmented
        label="Type"
        value={tab}
        onChange={(v) => {
          setTab(v);
          setCategoryId('');
        }}
        options={[
          { value: 'expense', label: 'Expense' },
          { value: 'income', label: 'Income' },
          { value: 'balance', label: 'Balance' },
        ]}
      />

      <label className="flex items-baseline gap-2 border-b border-line pb-1">
        <span className="sr-only">{tab === 'balance' ? 'Balance' : 'Amount'}</span>
        <span className={`text-3xl ${tab === 'income' ? 'text-good' : 'text-ink-3'}`}>
          {tab === 'expense' ? '−' : tab === 'income' ? '+' : ''}
        </span>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          autoFocus
          placeholder="0,00"
          aria-label={tab === 'balance' ? 'Balance' : 'Amount'}
          className="num min-w-0 flex-1 bg-transparent text-4xl font-semibold outline-none"
        />
        <span className="text-2xl text-ink-3">€</span>
      </label>

      {tab === 'balance' ? (
        <>
          <Field label="Account">
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputCls}>
              {[...m.ds.accounts.values()].map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="On">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Note (optional)">
            <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
          </Field>
        </>
      ) : (
        <>
          <CategoryGrid value={categoryId} onPick={setCategoryId} top={top} kinds={[kind]} />
          {details ? (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Date">
                <input
                  type="date"
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setEventId(tripOnDay(m, e.target.value));
                  }}
                  className={inputCls}
                />
              </Field>
              <Field label="Account">
                <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputCls}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="col-span-2">
                <Field label="Note">
                  <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
                </Field>
              </div>
              <div className="col-span-2">
                <Field label="Event">
                  <select value={eventId} onChange={(e) => setEventId(e.target.value)} className={inputCls}>
                    <option value="">None</option>
                    {events.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setDetails(true)}
              className="min-h-11 rounded-xl text-left text-sm text-ink-2 hover:bg-surface-2"
            >
              {date === m.today ? 'Today' : date} · {m.ds.accounts.get(accountId)?.name ?? 'No account'}
              {eventId ? ` · ${m.ds.events.find((e) => e.id === eventId)?.name}` : ''} ·{' '}
              <span className="text-accent">Date, account, note, event</span>
            </button>
          )}
        </>
      )}

      <Button variant="primary" onClick={save} disabled={!valid} data-testid="quick-add-save">
        {valid && cents !== null
          ? tab === 'balance'
            ? `Save balance ${formatEUR(cents)}`
            : `Save ${formatEUR(Math.abs(cents))} · ${categoryName(m, categoryId)}`
          : 'Save'}
      </Button>
    </div>
  );
}

/** The floating + on Home and Activity (SPEC §3). */
export function QuickAddFab() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Quick add"
        className="fixed right-4 bottom-[calc(76px+env(safe-area-inset-bottom))] z-30 flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-ink shadow-lg lg:right-8 lg:bottom-8"
      >
        <Plus size={26} />
      </button>
      <QuickAdd open={open} onOpenChange={setOpen} />
    </>
  );
}
