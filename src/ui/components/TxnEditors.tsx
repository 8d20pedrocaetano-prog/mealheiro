import { Check, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Txn } from '../../core/dataset';
import { addDays } from '../../core/dates';
import { assignedEventId } from '../../core/events';
import { effOf } from '../../core/view';
import { linkPayback, setEvent, setExcluded, setNote, unlinkPayback, type NewOp } from '../../state/edits';
import { useApp, useModel } from '../../state/store';
import { categoryName } from '../lib/categories';
import { noteOf } from '../lib/filter';
import { fmtDate, formatEUR } from '../lib/format';
import { Button, Field, inputCls } from './ui';

export function NoteEditor({ t, onDone }: { t: Txn; onDone: () => void }) {
  const m = useModel();
  const commit = useApp((s) => s.commit);
  const current = noteOf(t, m);
  const [text, setText] = useState(current);
  const save = async (v: string) => {
    await commit(setNote(t, v));
    onDone();
  };
  return (
    <div className="flex flex-col gap-3">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        autoFocus
        aria-label="Note"
        className="w-full rounded-xl border border-line bg-surface p-3 text-[16px] outline-none focus:border-accent"
        placeholder="e.g. dinner with the team, split later"
      />
      <div className="flex gap-2">
        {current && (
          <Button variant="danger" onClick={() => save('')}>
            Remove
          </Button>
        )}
        <Button
          variant="primary"
          className="flex-1"
          onClick={() => save(text)}
          disabled={text.trim() === current}
        >
          Save note
        </Button>
      </div>
    </div>
  );
}

export function ExcludeEditor({ t, onDone }: { t: Txn; onDone: () => void }) {
  const m = useModel();
  const commit = useApp((s) => s.commit);
  const excluded = effOf(m.view, t).excluded;
  const [reason, setReason] = useState('');
  const run = async (ops: NewOp[]) => {
    await commit(ops);
    onDone();
  };
  if (excluded)
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink-2">This transaction is left out of every total.</p>
        <Button variant="primary" onClick={() => run(setExcluded(t, false))}>
          Include it again
        </Button>
      </div>
    );
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-2">
        Excluded transactions stay in the list but don't count in any total, budget or chart.
      </p>
      <Field label="Reason (saved as the note)">
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className={inputCls}
          placeholder="e.g. paid for a friend, one-off"
        />
      </Field>
      <Button variant="primary" onClick={() => run(setExcluded(t, true, reason))}>
        Exclude from analysis
      </Button>
    </div>
  );
}

export function EventPicker({ t, onDone }: { t: Txn; onDone: () => void }) {
  const m = useModel();
  const commit = useApp((s) => s.commit);
  const current = assignedEventId(m.view, t);
  const events = m.ds.events
    .filter((e) => e.type !== 'stage' && e.status !== 'dismissed')
    .sort((a, b) => (a.start_date < b.start_date ? 1 : -1));
  const pick = async (id: string) => {
    if (id !== current) {
      const ops: NewOp[] = t.manual?.event_id
        ? [
            {
              file: 'manual.csv',
              kind: 'upsert',
              key: { id: t.id },
              row: { event_id: id },
              label: 'assign to event',
            },
          ]
        : setEvent(t, id);
      await commit(ops);
    }
    onDone();
  };
  const near = (e: (typeof events)[number]) =>
    t.value_date >= addDays(e.start_date, -7) && t.value_date <= addDays(e.end_date || m.today, 7);
  const sorted = [...events.filter(near), ...events.filter((e) => !near(e))];
  return (
    <ul className="flex flex-col">
      <li>
        <button
          type="button"
          onClick={() => pick('')}
          className="flex min-h-12 w-full items-center gap-3 border-b border-line px-1 text-left"
        >
          <span className="flex-1">No event</span>
          {!current && <Check size={18} className="text-accent" />}
        </button>
      </li>
      {sorted.map((e) => (
        <li key={e.id}>
          <button
            type="button"
            onClick={() => pick(e.id)}
            className="flex min-h-12 w-full items-center gap-3 border-b border-line px-1 text-left"
          >
            <span
              className="size-3 shrink-0 rounded-full"
              style={{ background: e.color || 'var(--ink-3)' }}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{e.name}</span>
              <span className="block text-xs text-ink-3">
                {e.type} · {fmtDate(e.start_date)}
                {e.end_date ? `–${fmtDate(e.end_date)}` : ''}
                {e.status === 'proposed' ? ' · proposed' : ''}
              </span>
            </span>
            {current === e.id && <Check size={18} className="text-accent" />}
          </button>
        </li>
      ))}
      {events.length === 0 && <li className="py-4 text-sm text-ink-3">No events yet.</li>}
    </ul>
  );
}

/** Pick the expense this incoming money pays back (DATA_MODEL §6, §12). */
export function PaybackPicker({ t, onDone }: { t: Txn; onDone: () => void }) {
  const m = useModel();
  const commit = useApp((s) => s.commit);
  const [q, setQ] = useState('');
  const linkedId = m.ds.overrides.get(t.id)?.reimburses_txn_id;
  const linked = linkedId ? m.ds.byId.get(linkedId) : null;
  const suggested = m.pairs.find((p) => p.type === 'payback' && p.incoming.id === t.id)?.other;
  const candidates = useMemo(() => {
    const from = addDays(t.value_date, -60);
    const to = addDays(t.value_date, 3);
    const needle = q.trim().toUpperCase();
    const list = m.ds.txns.filter(
      (x) =>
        x.amount < 0 &&
        x.value_date >= from &&
        x.value_date <= to &&
        effOf(m.view, x).kind === 'expense' &&
        (!needle || effOf(m.view, x).merchant.toUpperCase().includes(needle) || x.descNorm.includes(needle)),
    );
    list.sort((a, b) => (a.value_date < b.value_date ? 1 : -1));
    if (suggested && !needle) return [suggested, ...list.filter((x) => x.id !== suggested.id)];
    return list;
  }, [m, t, q, suggested]);

  const link = async (x: Txn) => {
    await commit(linkPayback(m, t, x));
    onDone();
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-2">
        Pick the expense this pays back. It takes that expense's category, so the two net out there.
      </p>
      {linked && (
        <div className="flex items-center gap-2 rounded-xl bg-surface-2 p-3 text-sm">
          <span className="min-w-0 flex-1 truncate">
            Now: {effOf(m.view, linked).merchant} · {fmtDate(linked.value_date)} · {formatEUR(linked.amount)}
          </span>
          <Button
            variant="danger"
            className="min-h-9 px-3"
            onClick={async () => {
              await commit(unlinkPayback(t));
              onDone();
            }}
          >
            Unlink
          </Button>
        </div>
      )}
      <label className="flex h-11 items-center gap-2 rounded-xl border border-line bg-surface px-3 focus-within:border-accent">
        <Search size={16} className="text-ink-3" aria-hidden="true" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find the expense"
          aria-label="Find the expense"
          className="min-w-0 flex-1 bg-transparent text-[16px] outline-none"
        />
      </label>
      <ul className="flex flex-col">
        {candidates.slice(0, 40).map((x) => {
          const e = effOf(m.view, x);
          return (
            <li key={x.id}>
              <button
                type="button"
                onClick={() => link(x)}
                className="flex min-h-12 w-full items-center gap-3 border-b border-line px-1 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    {e.merchant}
                    {x.id === suggested?.id && <span className="ml-2 text-xs text-accent">suggested</span>}
                  </span>
                  <span className="block text-xs text-ink-3">
                    {fmtDate(x.value_date)} · {categoryName(m, e.categoryId)}
                  </span>
                </span>
                <span className="num shrink-0">{formatEUR(x.amount)}</span>
                {x.id === linkedId && <Check size={18} className="text-accent" />}
              </button>
            </li>
          );
        })}
        {candidates.length === 0 && (
          <li className="py-4 text-sm text-ink-3">No expenses in the 60 days before.</li>
        )}
      </ul>
    </div>
  );
}
