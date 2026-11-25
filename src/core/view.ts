/**
 * The computed view over a DataSet: every transaction's effective categorisation, computed once per
 * data change and shared by every screen and aggregate.
 */
import { categorize, effective, type Effective } from './categorize';
import type { DataSet, Txn } from './dataset';
import { isTrue } from './schema';

export interface View {
  ds: DataSet;
  eff: Map<string, Effective>;
}

export function buildView(ds: DataSet): View {
  const eff = new Map<string, Effective>();
  for (const t of ds.txns) eff.set(t.id, effective(ds, t, categorize(ds, t)));
  return { ds, eff };
}

export function effOf(v: View, t: Txn): Effective {
  let e = v.eff.get(t.id);
  if (!e) {
    e = effective(v.ds, t);
    v.eff.set(t.id, e);
  }
  return e;
}

export function isTracked(ds: DataSet, accountId: string): boolean {
  return isTrue(ds.accounts.get(accountId)?.tracked);
}
