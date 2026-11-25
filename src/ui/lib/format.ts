/** Display formats (SPEC §4): dates `dd/mm/yyyy` or `12 Mar`, money pt-PT. UI language English. */
export { formatEUR, formatEURShort } from '../../core/money';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const parts = (iso: string) => ({
  y: Number(iso.slice(0, 4)),
  m: Number(iso.slice(5, 7)),
  d: Number(iso.slice(8, 10)),
});

/** 31/10/2026 */
export function fmtDate(iso: string): string {
  if (!iso) return '';
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** 12 Mar */
export function fmtDay(iso: string): string {
  const { m, d } = parts(iso);
  return `${d} ${MONTHS[m - 1]}`;
}

/** Fri 31 Oct (2025 added when not the reference year) */
export function fmtDayHeader(iso: string, refYear?: number): string {
  const { y, m, d } = parts(iso);
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${wd} ${d} ${MONTHS[m - 1]}${refYear && y !== refYear ? ` ${y}` : ''}`;
}

/** October 2026 */
export function fmtMonth(ym: string): string {
  return `${MONTHS_LONG[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
}

/** Oct 26 */
export function fmtMonthShort(ym: string): string {
  return `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;
}

export function fmtPct(x: number | null, digits = 0): string {
  if (x === null || !Number.isFinite(x)) return '—';
  return `${(x * 100).toFixed(digits).replace('.', ',')}%`;
}

export function plural(n: number, one: string, many = one + 's'): string {
  return `${n} ${n === 1 ? one : many}`;
}
