/** ISO date helpers (`YYYY-MM-DD`, `YYYY-MM`). Day numbers are UTC days since the epoch. */

const MS_PER_DAY = 86_400_000;

export function dayNum(iso: string): number {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

export function fromDayNum(n: number): string {
  return new Date(n * MS_PER_DAY).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return fromDayNum(dayNum(iso) + days);
}

/** b − a in days. */
export function daysBetween(a: string, b: string): number {
  return dayNum(b) - dayNum(a);
}

export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

export function daysInMonth(ym: string): number {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthIndex(ym: string): number {
  return Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
}

export function fromMonthIndex(i: number): string {
  const y = Math.floor(i / 12);
  const m = (i % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

export function addMonths(ym: string, n: number): string {
  return fromMonthIndex(monthIndex(ym) + n);
}

/** Inclusive list of months from a to b. */
export function monthRange(a: string, b: string): string[] {
  const out: string[] = [];
  for (let i = monthIndex(a); i <= monthIndex(b); i++) out.push(fromMonthIndex(i));
  return out;
}

export function firstDay(ym: string): string {
  return `${ym}-01`;
}

export function lastDay(ym: string): string {
  return `${ym}-${String(daysInMonth(ym)).padStart(2, '0')}`;
}

/** Today's local date as ISO (the owner's phone clock, Europe/Lisbon). */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Local timestamp without zone, like Python's datetime.now().isoformat(timespec="seconds"). */
export function nowLocalTimestamp(now: Date = new Date()): string {
  const t = [now.getHours(), now.getMinutes(), now.getSeconds()].map((v) => String(v).padStart(2, '0'));
  return `${todayIso(now)}T${t.join(':')}`;
}

/**
 * Whole months from `from` to `to` (dates): calendar months, minus one if `to`'s day of month is
 * before `from`'s. 2026-11-25 → 2027-06-30 = 7; → 2027-06-20 = 6.
 */
export function wholeMonthsBetween(from: string, to: string): number {
  let n = monthIndex(to.slice(0, 7)) - monthIndex(from.slice(0, 7));
  if (Number(to.slice(8, 10)) < Number(from.slice(8, 10))) n -= 1;
  return n;
}
