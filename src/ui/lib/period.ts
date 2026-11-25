import { addMonths, lastDay, monthOf } from '../../core/dates';
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
