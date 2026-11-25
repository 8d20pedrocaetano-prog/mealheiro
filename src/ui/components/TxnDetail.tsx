import { Banknote, CalendarRange, CircleSlash, HandCoins, NotebookPen, Tags, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { Txn } from '../../core/dataset';
import { assignedEventId } from '../../core/events';
import { tryParseMoney } from '../../core/money';
import { effOf } from '../../core/view';
import { CategoryIcon } from '../lib/icons';
import { fmtDate, formatEUR } from '../lib/format';
import { noteOf } from '../lib/filter';
import { groupColor, tint } from '../lib/palette';
import { Sheet } from './Sheet';
import { suggestPattern } from '../../core/ruleTools';
import { CASH_CATEGORY, itemisedFor } from '../../core/review';
import { deleteManual, recategorise } from '../../state/edits';
import { useApp, useModel } from '../../state/store';
import { categoryName } from '../lib/categories';
import { CategoryGrid } from './CategoryGrid';
import { CashItemiser } from './CashItemiser';
import { RuleEditor } from './RuleEditor';
import { EventPicker, ExcludeEditor, NoteEditor, PaybackPicker } from './TxnEditors';
import { Button } from './ui';
import { whyText } from '../lib/why';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-sm text-ink-2">{label}</dt>
      <dd className="min-w-0 text-right text-sm break-words">{children}</dd>
    </div>
  );
}

type Mode = 'detail' | 'category' | 'rule' | 'note' | 'exclude' | 'event' | 'payback' | 'cash';

const TITLES: Record<Exclude<Mode, 'detail'>, string> = {
  category: 'Change category',
  rule: 'All like this',
  note: 'Note',
  exclude: 'Exclude from analysis',
  event: 'Event',
  payback: 'Payback for…',
  cash: 'What was this cash for?',
};

function Action({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-11 items-center gap-2 rounded-xl border border-line px-3 py-1.5 text-left text-sm leading-tight hover:bg-surface-2"
    >
      <span className="shrink-0 text-ink-2">{icon}</span>
      <span className="min-w-0">{label}</span>
    </button>
  );
}

/** The detail sheet (SPEC §4.2): what a transaction is and why, plus every edit, as views inside one sheet. */
export function TxnDetail({ t, onClose }: { t: Txn | null; onClose: () => void }) {
  if (!t) return <Sheet open={false} onOpenChange={() => onClose()} title="" children={null} />;
  return <DetailSheet key={t.id} t={t} onClose={onClose} />;
}

function DetailSheet({ t: initial, onClose }: { t: Txn; onClose: () => void }) {
  const m = useModel();
  const commit = useApp((s) => s.commit);
  const [mode, setMode] = useState<Mode>('detail');
  const [changedTo, setChangedTo] = useState<string | null>(null);
  // the model is rebuilt after every edit: always show the current version of this transaction
  const t = m.ds.byId.get(initial.id) ?? initial;
  const e = effOf(m.view, t);
  const back = () => setMode('detail');

  if (mode !== 'detail') {
    let content: ReactNode = null;
    if (mode === 'category')
      content = (
        <CategoryGrid
          value={e.categoryId}
          onPick={async (id) => {
            if (id !== e.categoryId) {
              await commit(recategorise(t, id));
              setChangedTo(id);
            }
            back();
          }}
        />
      );
    if (mode === 'rule')
      content = (
        <RuleEditor
          initial={{
            pattern: suggestPattern(t),
            direction: t.amount < 0 ? 'out' : 'in',
            amount_min: '',
            amount_max: '',
            account_id: '',
            merchant: '',
            category_id: changedTo ?? e.categoryId,
          }}
          onDone={() => {
            setChangedTo(null);
            back();
          }}
        />
      );
    if (mode === 'note') content = <NoteEditor t={t} onDone={back} />;
    if (mode === 'exclude') content = <ExcludeEditor t={t} onDone={back} />;
    if (mode === 'event') content = <EventPicker t={t} onDone={back} />;
    if (mode === 'payback') content = <PaybackPicker t={t} onDone={back} />;
    if (mode === 'cash') content = <CashItemiser t={t} onDone={back} />;
    return (
      <Sheet
        open
        onOpenChange={(o) => !o && onClose()}
        title={TITLES[mode]}
        description={`${e.merchant} · ${formatEUR(t.amount, { plus: true })}`}
        onBack={back}
      >
        {content}
      </Sheet>
    );
  }

  const isCash = e.categoryId === CASH_CATEGORY && t.amount < 0 && !t.manual;
  const itemised = isCash ? itemisedFor(m, t) : [];
  const itemisedSum = itemised.reduce((s, x) => s - x.amount, 0);
  const o = m.ds.overrides.get(t.id);
  const eventId = assignedEventId(m.view, t);

  return (
    <DetailView t={t} onClose={onClose}>
      {changedTo && !t.manual && (
        <div className="my-2 flex items-center gap-2 rounded-xl bg-accent-soft p-3 text-sm">
          <span className="min-w-0 flex-1">
            Changed to <b>{categoryName(m, changedTo)}</b>. Apply to all like this?
          </span>
          <Button variant="primary" className="min-h-9 px-3 text-sm" onClick={() => setMode('rule')}>
            Make a rule
          </Button>
        </div>
      )}
      {isCash && (
        <button
          type="button"
          onClick={() => setMode('cash')}
          className="my-2 flex min-h-12 w-full items-center gap-3 rounded-xl bg-accent-soft px-3 text-left"
        >
          <Banknote size={20} className="text-accent" />
          <span className="flex-1">
            <span className="block font-medium text-accent">What was this cash for?</span>
            {itemised.length > 0 && (
              <span className="num block text-xs text-ink-2">
                {formatEUR(itemisedSum)} of {formatEUR(-t.amount)} itemised
              </span>
            )}
          </span>
        </button>
      )}
      <div className="my-2 grid grid-cols-2 gap-2">
        <Action icon={<Tags size={18} />} label="Change category" onClick={() => setMode('category')} />
        <Action
          icon={<NotebookPen size={18} />}
          label={noteOf(t, m) ? 'Edit note' : 'Add note'}
          onClick={() => setMode('note')}
        />
        <Action
          icon={<CalendarRange size={18} />}
          label={eventId ? 'Change event' : 'Add to event'}
          onClick={() => setMode('event')}
        />
        <Action
          icon={<CircleSlash size={18} />}
          label={e.excluded ? 'Include again' : 'Exclude'}
          onClick={() => setMode('exclude')}
        />
        {t.amount > 0 && !t.manual && (
          <Action
            icon={<HandCoins size={18} />}
            label={o?.reimburses_txn_id ? 'Payback: change' : 'Payback for…'}
            onClick={() => setMode('payback')}
          />
        )}
        {t.manual && (
          <Action
            icon={<Trash2 size={18} />}
            label="Delete entry"
            onClick={async () => {
              await commit([deleteManual(t.id)]);
              onClose();
            }}
          />
        )}
        {!t.manual && e.source !== 'none' && (
          <Action icon={<Tags size={18} />} label="All like this…" onClick={() => setMode('rule')} />
        )}
      </div>
    </DetailView>
  );
}

function DetailView({ t, onClose, children }: { t: Txn; onClose: () => void; children: ReactNode }) {
  const m = useModel();
  const e = effOf(m.view, t);
  const cat = m.ds.categories.get(e.categoryId);
  const acct = m.ds.accounts.get(t.account_id);
  const eventId = assignedEventId(m.view, t);
  const event = eventId ? m.ds.events.find((x) => x.id === eventId) : null;
  const o = m.ds.overrides.get(t.id);
  const reimburses = o?.reimburses_txn_id ? m.ds.byId.get(o.reimburses_txn_id) : null;
  const paybacks = m.ds.txns.filter((x) => m.ds.overrides.get(x.id)?.reimburses_txn_id === t.id);
  const itemised = m.ds.txns.filter((x) => x.manual?.linked_txn_id === t.id);
  const itemisedSum = itemised.reduce((s, x) => s + -x.amount, 0);
  const rule = e.ruleId ? m.ds.rules.find((r) => r.row.id === e.ruleId)?.row : null;
  const color = groupColor(e.group);
  const note = noteOf(t, m);
  const linkedWithdrawal = t.manual?.linked_txn_id ? m.ds.byId.get(t.manual.linked_txn_id) : null;

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={e.merchant} description={fmtDate(t.value_date)}>
      <div className="flex items-center gap-3 py-2">
        <span
          className="flex size-12 items-center justify-center rounded-full"
          style={{ background: tint(color, 0.8), color }}
        >
          <CategoryIcon name={cat?.icon ?? 'tag'} size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm text-ink-2">{cat?.name ?? e.categoryId}</div>
          <div className="text-xs text-ink-3">{whyText(e.source, e.ruleId, m, t)}</div>
        </div>
        <div
          className={`num text-2xl font-semibold ${
            e.kind === 'transfer' || e.excluded ? 'text-ink-3 line-through' : t.amount > 0 ? 'text-good' : ''
          }`}
        >
          {formatEUR(t.amount, { plus: true })}
        </div>
      </div>

      {e.reportCategory.startsWith('unitemized-') && (
        <p className="my-2 rounded-xl bg-surface-2 p-3 text-sm text-ink-2">
          Counts as unitemized spending: the{' '}
          {m.ds.accounts.get(e.reportCategory.slice(11))?.name ?? 'account'} isn't tracked, so money sent
          there is treated as spent.
          {itemised.length > 0 && ` ${formatEUR(itemisedSum)} of ${formatEUR(-t.amount)} itemised.`}
        </p>
      )}
      {e.kind === 'transfer' && (
        <p className="my-2 rounded-xl bg-surface-2 p-3 text-sm text-ink-2">
          A transfer between tracked accounts: neutral, not counted as spending.
        </p>
      )}
      {e.excluded && (
        <p className="my-2 rounded-xl bg-warn-soft p-3 text-sm text-warn">Excluded from analysis.</p>
      )}

      {children}

      <dl className="mt-2 divide-y divide-line">
        <Row label="Description">
          <span className="font-mono text-[13px]">{t.description_raw}</span>
        </Row>
        <Row label="Value date">{fmtDate(t.value_date)}</Row>
        {t.booking_date !== t.value_date && <Row label="Booking date">{fmtDate(t.booking_date)}</Row>}
        <Row label="Account">{acct?.name ?? t.account_id}</Row>
        {t.balance_after && (
          <Row label="Balance after">
            <span className="num">{formatEUR(tryParseMoney(t.balance_after) ?? 0)}</span>
          </Row>
        )}
        {t.currency && t.currency !== 'EUR' && <Row label="Currency">{t.currency}</Row>}
        <Row label="Source">
          {t.manual ? `Manual entry (${t.manual.created_at.slice(0, 10)})` : `Import ${t.import_id}`}
        </Row>
        {rule && (
          <Row label="Rule">
            <span className="font-mono text-[13px]">/{rule.pattern}/</span>
          </Row>
        )}
        {event && <Row label="Event">{event.name}</Row>}
        {note && <Row label="Note">{note}</Row>}
        {reimburses && (
          <Row label="Payback for">
            {effOf(m.view, reimburses).merchant} · {formatEUR(reimburses.amount)} ·{' '}
            {fmtDate(reimburses.value_date)}
          </Row>
        )}
        {paybacks.length > 0 && (
          <Row label="Paid back">
            <span className="num">{formatEUR(paybacks.reduce((s, x) => s + x.amount, 0))}</span>
          </Row>
        )}
        {linkedWithdrawal && (
          <Row label="Itemises">
            Cash withdrawal · {fmtDate(linkedWithdrawal.value_date)} ·{' '}
            <span className="num">{formatEUR(linkedWithdrawal.amount)}</span>
          </Row>
        )}
      </dl>
    </Sheet>
  );
}
