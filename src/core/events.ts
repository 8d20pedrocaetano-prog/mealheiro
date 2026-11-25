/** Event membership (DATA_MODEL §7). */
import type { DataSet, Txn } from './dataset';
import type { EventRow } from './schema';
import { effOf, type View } from './view';

export const isTripType = (e: EventRow) => e.type === 'trip' || e.type === 'work-trip';

/**
 * The event a transaction is explicitly assigned to: the override's event_id, or for a manual entry
 * the event_id it was logged with (Quick add pre-selects the current trip). mh.py's effective() only
 * reads overrides; the manual fallback is an app decision (see CHANGELOG) and does not affect parity.
 */
export function assignedEventId(view: View, t: Txn): string {
  return effOf(view, t).eventId || t.manual?.event_id || '';
}

/** Members of an event: explicit for trips, work trips and tags; by date range for stages. */
export function eventMembers(view: View, e: EventRow, today: string): Txn[] {
  const { ds } = view;
  if (e.type === 'stage') {
    const end = e.end_date || today;
    return ds.txns.filter((t) => e.start_date <= t.value_date && t.value_date <= end);
  }
  return ds.txns.filter((t) => assignedEventId(view, t) === e.id);
}

/** Ids of transactions that belong to a confirmed trip or work trip. */
export function confirmedTripMemberIds(view: View): Set<string> {
  const confirmed = new Set(
    view.ds.events.filter((e) => isTripType(e) && e.status === 'confirmed').map((e) => e.id),
  );
  const out = new Set<string>();
  for (const t of view.ds.txns) {
    const id = assignedEventId(view, t);
    if (id && confirmed.has(id)) out.add(t.id);
  }
  return out;
}

/** Confirmed trip covering a date (for Quick add's pre-selected event). */
export function tripOn(ds: DataSet, date: string): EventRow | null {
  return (
    ds.events.find(
      (e) =>
        isTripType(e) && e.status === 'confirmed' && e.start_date <= date && date <= (e.end_date || date),
    ) ?? null
  );
}
