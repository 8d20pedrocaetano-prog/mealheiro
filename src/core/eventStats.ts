/** Figures for the trip page and stage compare (SPEC §4.5). Net, like Spent (DATA_MODEL §9). */
import { netSpent, type Line } from './aggregates';
import { daysBetween, monthOf, monthRange } from './dates';
import { eventMembers } from './events';
import type { Model } from './model';
import { parseMoney, type Cents } from './money';
import { isFxFeeNorm } from './normalize';
import type { EventRow } from './schema';

export interface TripSummary {
  members: string[];
  lines: Line[];
  total: Cents;
  days: number;
  perDay: Cents;
  byCategory: { key: string; spent: Cents }[];
  /** Spend per day from start to end (index 0 = start). */
  byDay: Cents[];
  fxFees: Cents;
  /** Money moved to untracked accounts (Revolut top-ups, cash) during the trip. */
  unitemized: Cents;
  /** Members dated before the trip starts (flights and hotels booked ahead). */
  preTrip: Cents;
  budget: Cents | null;
}

/** Net spend of a set of transactions, from the expense reporting lines (offsets included). */
export function membersSpend(m: Model, ids: Set<string>): { lines: Line[]; total: Cents } {
  const lines = m.lines.filter((l) => l.kind === 'expense' && ids.has(l.txn.id));
  return { lines, total: netSpent(lines) };
}

export function tripSummary(m: Model, e: EventRow): TripSummary {
  const members = eventMembers(m.view, e, m.today);
  const ids = new Set(members.map((t) => t.id));
  const { lines, total } = membersSpend(m, ids);
  const end = e.end_date || m.today;
  const days = Math.max(1, daysBetween(e.start_date, end) + 1);
  const byCat = new Map<string, Line[]>();
  const byDay = new Array<Cents>(days).fill(0);
  let unitemized = 0;
  let preTrip = 0;
  for (const l of lines) {
    let a = byCat.get(l.reportCategory);
    if (!a) byCat.set(l.reportCategory, (a = []));
    a.push(l);
    if (l.reportCategory.startsWith('unitemized-')) unitemized -= l.amount;
    if (l.date < e.start_date) preTrip -= l.amount;
    else {
      const i = daysBetween(e.start_date, l.date);
      if (i >= 0 && i < days) byDay[i] -= l.amount;
    }
  }
  const fxFees = members.filter((t) => isFxFeeNorm(t.descNorm)).reduce((s, t) => s - t.amount, 0);
  let budget: Cents | null = null;
  try {
    budget = e.budget ? parseMoney(e.budget) : null;
  } catch {
    budget = null;
  }
  return {
    members: [...ids],
    lines,
    total,
    days,
    perDay: Math.round(total / days),
    byCategory: [...byCat.entries()]
      .map(([key, ls]) => ({ key, spent: netSpent(ls) }))
      .sort((a, b) => b.spent - a.spent),
    byDay,
    fxFees,
    unitemized,
    preTrip,
    budget,
  };
}

/** Whole calendar months a stage covers up to today (at least one). */
export function stageMonths(e: EventRow, today: string): string[] {
  const end = e.end_date && e.end_date < today ? e.end_date : today;
  return monthRange(monthOf(e.start_date), monthOf(end));
}

/** Average monthly net spend by group within a stage (SPEC §4.5 stage compare). */
export function stageAverages(
  m: Model,
  e: EventRow,
): { months: number; byGroup: Map<string, Cents>; total: Cents } {
  const end = e.end_date || m.today;
  const months = Math.max(1, stageMonths(e, m.today).length);
  const by = new Map<string, Cents>();
  for (const l of m.lines) {
    if (l.kind !== 'expense' || l.date < e.start_date || l.date > end) continue;
    by.set(l.group, (by.get(l.group) ?? 0) - l.amount);
  }
  const byGroup = new Map([...by].map(([g, v]) => [g, Math.round(v / months)]));
  const total = [...byGroup.values()].reduce((s, v) => s + v, 0);
  return { months, byGroup, total };
}

/** A free event id near `ev-<start>`. */
export function newEventId(events: EventRow[], start: string): string {
  const taken = new Set(events.map((e) => e.id));
  let id = `ev-${start}`;
  for (let i = 2; taken.has(id); i++) id = `ev-${start}-${i}`;
  return id;
}

/** Default ticks for a proposal: detector members minus `unticked` (DATA_MODEL §11 step 6). */
export function defaultTicks(members: string[], unticked: string[]): Set<string> {
  const u = new Set(unticked);
  return new Set(members.filter((id) => !u.has(id)));
}
