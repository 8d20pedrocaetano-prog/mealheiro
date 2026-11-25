import type { ReactNode } from 'react';
import type { Txn } from '../../core/dataset';
import { assignedEventId } from '../../core/events';
import { tryParseMoney } from '../../core/money';
import { effOf } from '../../core/view';
import { useModel } from '../../state/store';
import { CategoryIcon } from '../lib/icons';
import { fmtDate, formatEUR } from '../lib/format';
import { noteOf } from '../lib/filter';
import { groupColor, tint } from '../lib/palette';
import { Sheet } from './Sheet';
import { whyText } from '../lib/why';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-sm text-ink-2">{label}</dt>
      <dd className="min-w-0 text-right text-sm break-words">{children}</dd>
    </div>
  );
}

export function TxnDetail({
  t,
  onClose,
  actions,
}: {
  t: Txn | null;
  onClose: () => void;
  actions?: (t: Txn) => ReactNode;
}) {
  const m = useModel();
  if (!t) return <Sheet open={false} onOpenChange={() => onClose()} title="" children={null} />;
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

      {actions?.(t)}

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
        {t.manual?.linked_txn_id && <Row label="Itemises">cash withdrawal {t.manual.linked_txn_id}</Row>}
      </dl>
    </Sheet>
  );
}
