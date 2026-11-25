/** Everything the screens read, computed once per data change (pure, no React). */
import { monthSummary, reportingLines, type Line, type MonthBuckets } from './aggregates';
import type { CsvTable } from './csv';
import { buildDataSet, type DataSet } from './dataset';
import { suggestPairs, type PairSuggestion } from './pairs';
import { recurringKeys } from './recurring';
import type { Settings } from './schema';
import { detectTrips, filterProposals, type TripCandidate, type TripProposal } from './trips';
import { buildView, type View } from './view';

export interface Model {
  ds: DataSet;
  view: View;
  lines: Line[];
  summary: Record<string, MonthBuckets>;
  recurring: Set<string>;
  trips: TripCandidate[];
  proposals: TripProposal[];
  pairs: PairSuggestion[];
  /** Months that have any transaction (value date), sorted. */
  months: string[];
  /** The clock used for "current month", pace and goals. */
  today: string;
  /** How long the recompute took (ms), for the performance budget in SPEC §7. */
  computeMs: number;
}

export function buildModel(tables: Map<string, CsvTable>, settings: Settings, today: string): Model {
  const t0 = performance.now();
  const ds = buildDataSet(tables, settings);
  const view = buildView(ds);
  const lines = reportingLines(view);
  const summary = monthSummary(lines);
  const trips = detectTrips(ds, view);
  const months = [...new Set(ds.txns.map((t) => t.value_date.slice(0, 7)))].sort();
  const model: Model = {
    ds,
    view,
    lines,
    summary,
    recurring: recurringKeys(ds),
    trips,
    proposals: filterProposals(trips, ds.events),
    pairs: suggestPairs(ds, view),
    months,
    today,
    computeMs: 0,
  };
  model.computeMs = performance.now() - t0;
  return model;
}
