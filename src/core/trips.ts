/** Foreign-trip detection (DATA_MODEL §11) and the app-side filter (§7). Mirrors detect_trips in mh.py. */
import type { DataSet, Txn } from './dataset';
import { addDays, daysBetween } from './dates';
import { formatMoneyCsv } from './money';
import { isCardIntl, isFxFeeNorm, merchantKey } from './normalize';
import { recurringKeys } from './recurring';
import type { EventRow, TripDetectionSettings } from './schema';
import { buildView, effOf, type View } from './view';

export const NON_TRIP_CATEGORIES = new Set([
  'salary',
  'tax-refund',
  'work-reimbursement',
  'family-support',
  'other-income',
  'software-ai',
  'streaming',
  'phone',
  'gym',
  'utilities',
  'rent',
  'savings-transfer',
  'flights',
  'accommodation',
  'travel-other',
]);

export const PRE_TRIP_CATEGORIES = new Set(['flights', 'accommodation', 'travel-other']);

/** Same shape as fixtures/golden/trips.json. */
export interface TripCandidate {
  start: string;
  end: string;
  days: number;
  score: number;
  total: string;
  members: string[];
  unticked: string[];
  pre_trip_suggestions: string[];
  sample: string[];
}

export function tripSettings(ds: DataSet): TripDetectionSettings {
  const s = ds.settings.trip_detection ?? {};
  return {
    away_day_score: s.away_day_score ?? 3,
    max_gap_days: s.max_gap_days ?? 2,
    min_trip_score: s.min_trip_score ?? 6,
    pre_trip_window_days: s.pre_trip_window_days ?? 120,
  };
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function detectTrips(ds: DataSet, view: View = buildView(ds)): TripCandidate[] {
  const s = tripSettings(ds);
  const homeCurrency = ds.settings.home_currency ?? 'EUR';
  const rec = recurringKeys(ds);
  const cat = (t: Txn) => effOf(view, t).categoryId;

  // 1. Score days (insertion-ordered like Python's defaultdict; only days that scored exist).
  const score = new Map<string, number>();
  const feePts = new Map<string, number>();
  const add = (day: string, n: number) => score.set(day, (score.get(day) ?? 0) + n);
  for (const t of ds.txns) {
    if (t.amount >= 0) continue;
    const day = t.value_date;
    if (isFxFeeNorm(t.descNorm)) {
      const f = feePts.get(day) ?? 0;
      if (f < 2) {
        feePts.set(day, f + 1);
        add(day, 1);
      }
      continue;
    }
    if (NON_TRIP_CATEGORIES.has(cat(t)) || rec.has(merchantKey(t.descNorm))) continue;
    if (isCardIntl(t.description_raw)) add(day, 2);
    else if ((t.currency || 'EUR') !== homeCurrency) add(day, 3);
  }

  // 2. Away days → clusters.
  const away = [...score.entries()]
    .filter(([, sc]) => sc >= s.away_day_score)
    .map(([d]) => d)
    .sort(cmp);
  const clusters: string[][] = [];
  let cur: string[] = [];
  for (const day of away) {
    if (cur.length && daysBetween(cur[cur.length - 1], day) > s.max_gap_days) {
      clusters.push(cur);
      cur = [];
    }
    cur.push(day);
  }
  if (cur.length) clusters.push(cur);

  // 3. Extend forward then backward to days with some foreign activity (score ≥ 2) within max_gap.
  const scoredDays = [...score.keys()];
  for (const c of clusters) {
    for (;;) {
      const last = c[c.length - 1];
      const cand = scoredDays.filter((x) => {
        const d = daysBetween(last, x);
        return score.get(x)! >= 2 && d > 0 && d <= s.max_gap_days;
      });
      if (!cand.length) break;
      c.push(cand.reduce((m, x) => (x < m ? x : m)));
    }
    for (;;) {
      const first = c[0];
      const cand = scoredDays.filter((x) => {
        const d = daysBetween(x, first);
        return score.get(x)! >= 2 && d > 0 && d <= s.max_gap_days;
      });
      if (!cand.length) break;
      c.unshift(cand.reduce((m, x) => (x > m ? x : m)));
    }
  }

  const starts = clusters.map((c) => c[0]);
  const nearestFollowingStart = (v: string): string | null => {
    let best: string | null = null;
    for (const x of starts) if (x > v && (best === null || x < best)) best = x;
    return best;
  };

  const likelyHome = (t: Txn): boolean => {
    const c = cat(t);
    if (isCardIntl(t.description_raw) || isFxFeeNorm(t.descNorm) || c === 'cash-withdrawal') return false;
    return c === 'online-shopping' || c === 'people-out' || rec.has(merchantKey(t.descNorm));
  };

  const out: TripCandidate[] = [];
  for (const c of clusters) {
    const start = c[0];
    const end = c[c.length - 1];
    let totalScore = 0;
    for (const [x, sc] of score) if (start <= x && x <= end) totalScore += sc;
    const span = daysBetween(start, end) + 1;
    // 4. Keep clusters spanning ≥ 2 days or scoring ≥ min_trip_score.
    if (span < 2 && totalScore < s.min_trip_score) continue;

    // 5. Members and pre-trip suggestions.
    const members: Txn[] = [];
    const pre: Txn[] = [];
    const twoBefore = addDays(start, -2);
    for (const t of ds.txns) {
      const v = t.value_date;
      const e = effOf(view, t);
      if (start <= v && v <= end && t.amount < 0 && !NON_TRIP_CATEGORIES.has(e.categoryId)) {
        members.push(t);
      } else if (e.reportCategory === 'unitemized-revolut' && t.amount < 0 && twoBefore <= v && v < start) {
        members.push(t);
      } else if (PRE_TRIP_CATEGORIES.has(e.categoryId) && nearestFollowingStart(v) === start) {
        const before = daysBetween(v, start);
        if (before > 0 && before <= s.pre_trip_window_days) pre.push(t);
      }
    }

    // 6. Unticked by default: likely home life during the trip.
    const unticked = members.filter(likelyHome);
    const ticked = members.filter((t) => !likelyHome(t));
    let sum = 0;
    for (const t of ticked) sum += t.amount;
    // Python: str(-sum(...)) — an empty sum is the int 0 → "0".
    const total = ticked.length ? formatMoneyCsv(-sum) : '0';
    out.push({
      start,
      end,
      days: span,
      score: totalScore,
      total,
      members: members.map((t) => t.id),
      unticked: unticked.map((t) => t.id),
      pre_trip_suggestions: pre.map((t) => t.id),
      sample: [...new Set(ticked.map((t) => t.descNorm))].sort(cmp).slice(0, 8),
    });
  }
  return out;
}

function overlaps(e: EventRow, start: string, end: string): boolean {
  const eEnd = e.end_date || '9999-12-31';
  return !(eEnd < start || e.start_date > end);
}

export interface TripProposal {
  candidate: TripCandidate;
  /** The `proposed` event this candidate is shown as (named by the ingest session or detector). */
  event: EventRow | null;
  name: string;
  start: string;
  end: string;
}

/**
 * App-side filter (DATA_MODEL §7): hide candidates overlapping a confirmed or dismissed trip /
 * work-trip; merge one overlapping a proposed event into a single proposal with the event's name and
 * dates and the detector's members.
 */
export function filterProposals(candidates: TripCandidate[], events: EventRow[]): TripProposal[] {
  const trips = events.filter((e) => e.type === 'trip' || e.type === 'work-trip');
  const out: TripProposal[] = [];
  for (const c of candidates) {
    const ov = trips.filter((e) => overlaps(e, c.start, c.end));
    if (ov.some((e) => e.status === 'confirmed' || e.status === 'dismissed')) continue;
    const proposed = ov.find((e) => e.status === 'proposed') ?? null;
    out.push({
      candidate: c,
      event: proposed,
      name: proposed ? proposed.name : `Trip ${c.start}`,
      start: proposed ? proposed.start_date : c.start,
      end: proposed ? proposed.end_date || c.end : c.end,
    });
  }
  return out;
}

/** Proposed events with no detector candidate (e.g. domestic trips named by the ingest session). */
export function orphanProposedEvents(candidates: TripCandidate[], events: EventRow[]): EventRow[] {
  return events.filter(
    (e) =>
      e.status === 'proposed' &&
      (e.type === 'trip' || e.type === 'work-trip') &&
      !candidates.some((c) => overlaps(e, c.start, c.end)),
  );
}
