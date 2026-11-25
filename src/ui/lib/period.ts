import { addDays, addMonths, daysBetween, lastDay, monthOf, monthRange } from '../../core/dates';
import type { Model } from '../../core/model';

export interface Period {
  id: string;
  label: string;
  from: string;
  to: string;
}

export function periodPresets(m: Model): Period[] {
  const cur = monthOf(m.today);
  const mk = (id: string, label: string, fromMonth: string, toMonth: string): Period => ({
    id,
    label,
    from: `${fromMonth}-01`,
    to: lastDay(toMonth),
  });
  const year = cur.slice(0, 4);
  const out: Period[] = [
    mk('this-month', 'This month', cur, cur),
    mk('last-month', 'Last month', addMonths(cur, -1), addMonths(cur, -1)),
    mk('3m', 'Last 3 months', addMonths(cur, -2), cur),
    mk('6m', 'Last 6 months', addMonths(cur, -5), cur),
    mk('12m', 'Last 12 months', addMonths(cur, -11), cur),
    mk('ytd', 'Year to date', `${year}-01`, cur),
  ];
  const years = [...new Set(m.months.map((x) => x.slice(0, 4)))].sort().reverse();
  for (const y of years) out.push(mk(`y${y}`, y, `${y}-01`, `${y}-12`));
  for (const e of m.ds.events.filter((x) => x.type === 'stage' && x.status === 'confirmed')) {
    out.push({
      id: `stage-${e.id}`,
      label: `Stage: ${e.name}`,
      from: e.start_date,
      to: e.end_date || m.today,
    });
  }
  return out;
}

export type CompareMode = '' | 'previous' | 'last-year' | `stage-${string}`;

function shiftDate(iso: string, months: number): string {
  const ym = addMonths(iso.slice(0, 7), months);
  if (iso === lastDay(iso.slice(0, 7))) return lastDay(ym);
  const d = Math.min(Number(iso.slice(8, 10)), Number(lastDay(ym).slice(8, 10)));
  return `${ym}-${String(d).padStart(2, '0')}`;
}

/**
 * The part of a period that has happened (to is capped at today), so "this month" compares the first
 * 25 days with the first 25 days of the period it is compared to.
 */
export function elapsed(p: Period, today: string): Period {
  return p.to > today && p.from <= today ? { ...p, to: today } : p;
}

/**
 * SPEC §4.3 "compare to". Whole-month periods shift by whole months (Feb 1–25 → Jan 1–25); any other
 * range shifts by its length in days. Stages compare with the stage itself.
 */
export function comparePeriod(p: Period, mode: CompareMode, m: Model): Period | null {
  if (!mode) return null;
  const cur = elapsed(p, m.today);
  if (mode === 'last-year') {
    return {
      id: 'cmp',
      label: 'Same time last year',
      from: shiftDate(cur.from, -12),
      to: shiftDate(cur.to, -12),
    };
  }
  if (mode === 'previous') {
    if (cur.from.endsWith('-01')) {
      const n = monthRange(cur.from.slice(0, 7), p.to.slice(0, 7)).length;
      return {
        id: 'cmp',
        label: 'Previous period',
        from: shiftDate(cur.from, -n),
        to: shiftDate(cur.to, -n),
      };
    }
    const len = daysBetween(cur.from, cur.to) + 1;
    return { id: 'cmp', label: 'Previous period', from: addDays(cur.from, -len), to: addDays(cur.from, -1) };
  }
  const id = mode.slice('stage-'.length);
  const e = m.ds.events.find((x) => x.id === id);
  if (!e) return null;
  return { id: 'cmp', label: e.name, from: e.start_date, to: e.end_date || m.today };
}
