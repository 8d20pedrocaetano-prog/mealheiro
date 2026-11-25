/**
 * CSV of the filtered Activity list (M6), oldest first. Amounts use the data repo's format (`-12.34`); a
 * UTF-8 byte order mark lets Excel read accents. `counted` is what each row adds to the filter's total when
 * that differs from the amount (itemised cash, excluded rows, transfers).
 */
import { serializeCsv } from '../../core/csv';
import { assignedEventId } from '../../core/events';
import type { Model } from '../../core/model';
import { formatMoneyCsv } from '../../core/money';
import { effOf } from '../../core/view';
import { noteOf, type FilterResult } from './filter';

export function activityCsv(m: Model, r: FilterResult): string {
  const header = [
    'date',
    'booking_date',
    'account',
    'merchant',
    'description',
    'category',
    'group',
    'kind',
    'amount',
    ...(r.lineBased ? ['counted'] : []),
    'event',
    'note',
    'id',
  ];
  const events = new Map(m.ds.events.map((e) => [e.id, e.name]));
  const txns = [...r.txns].sort((a, b) =>
    a.value_date < b.value_date ? -1 : a.value_date > b.value_date ? 1 : 0,
  );
  const rows = txns.map((t) => {
    const e = effOf(m.view, t);
    const cat = m.ds.categories.get(e.categoryId)?.name ?? e.categoryId;
    return {
      date: t.value_date,
      booking_date: t.booking_date,
      account: m.ds.accounts.get(t.account_id)?.name ?? t.account_id,
      merchant: e.merchant,
      description: t.description_raw,
      category: e.reportCategory.startsWith('unitemized-') ? `${cat} (unitemized)` : cat,
      group: e.group,
      kind: e.excluded ? 'excluded' : e.kind,
      amount: formatMoneyCsv(t.amount),
      counted: formatMoneyCsv(r.contribution.get(t.id) ?? t.amount),
      event: events.get(assignedEventId(m.view, t)) ?? '',
      note: noteOf(t, m),
      id: t.id,
    };
  });
  return '﻿' + serializeCsv(header, rows);
}
