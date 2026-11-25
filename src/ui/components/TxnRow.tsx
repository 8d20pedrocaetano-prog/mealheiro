import type { Txn } from '../../core/dataset';
import { useModel } from '../../state/store';
import { CategoryIcon } from '../lib/icons';
import { formatEUR } from '../lib/format';
import { groupColor, tint } from '../lib/palette';
import { effOf } from '../../core/view';
import { itemisedSums } from '../lib/cash';

/** One transaction row: merchant, category chip, amount (SPEC §4.2). */
export function TxnRow({
  t,
  onOpen,
  contribution,
}: {
  t: Txn;
  onOpen?: (t: Txn) => void;
  /** When a filtered total counts this row differently from its amount (e.g. itemised cash offsets). */
  contribution?: number;
}) {
  const m = useModel();
  const e = effOf(m.view, t);
  const cat = m.ds.categories.get(e.categoryId);
  const neutral = e.kind === 'transfer' || e.excluded;
  const color = groupColor(e.group);
  const amountClass = neutral ? 'text-ink-3 line-through' : t.amount > 0 ? 'text-good' : 'text-ink';
  const itemised = itemisedSums(m).get(t.id);
  const catName = e.reportCategory.startsWith('unitemized-')
    ? `${cat?.name ?? e.categoryId} · unitemized`
    : (cat?.name ?? e.categoryId);
  const event =
    e.eventId || t.manual?.event_id
      ? m.ds.events.find((ev) => ev.id === (e.eventId || t.manual?.event_id))
      : null;
  return (
    <button
      type="button"
      onClick={() => onOpen?.(t)}
      className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-2 focus-visible:bg-surface-2"
    >
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-full"
        style={{ background: tint(color, 0.8), color }}
      >
        <CategoryIcon name={cat?.icon ?? 'tag'} size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{e.merchant}</span>
        <span className="flex items-center gap-1.5 truncate text-xs text-ink-2">
          <span className={e.source === 'none' ? 'text-warn' : ''}>{catName}</span>
          {event && (
            <span className="truncate rounded-full bg-accent-soft px-1.5 text-[11px] text-accent">
              {event.name}
            </span>
          )}
          {t.manual && <span className="text-ink-3">· {t.account_id}</span>}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end">
        <span className={`num text-right text-[15px] font-medium ${amountClass}`}>
          {formatEUR(t.amount, { plus: true })}
        </span>
        {itemised !== undefined && (
          <span className="num text-[11px] text-ink-3">
            {formatEUR(itemised)} of {formatEUR(-t.amount)} itemised
          </span>
        )}
        {contribution !== undefined && contribution !== t.amount && (
          <span className="num text-[11px] text-ink-3">
            counts {formatEUR(contribution, { plus: true })} here
          </span>
        )}
      </span>
    </button>
  );
}
