import { ChevronLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { addMonths, daysBetween, monthOf, monthRange } from '../../core/dates';
import { tryParseMoney } from '../../core/money';
import { useApp, useModel } from '../../state/store';
import { Card, CardTitle, Empty } from '../components/ui';
import { fmtDate, fmtMonthShort, formatEUR, plural } from '../lib/format';
import { StatementImport } from './StatementImport';

/** Import (SPEC §4.8): import a statement on this device (M5), coverage and history. */
export function ImportHistory() {
  const m = useModel();
  const source = useApp((s) => s.source);
  const imports = [...m.ds.imports].sort((a, b) => (a.imported_at < b.imported_at ? 1 : -1));

  // Coverage per account: months with at least one imported row, gaps between first and last.
  const coverage = [...m.ds.accounts.values()]
    .map((a) => {
      const rows = m.ds.txns.filter((t) => !t.manual && t.account_id === a.id);
      if (!rows.length) return null;
      const months = new Set(rows.map((t) => t.booking_date.slice(0, 7)));
      const sorted = [...months].sort();
      const all = monthRange(sorted[0], sorted[sorted.length - 1]);
      const gaps = all.filter((x) => !months.has(x));
      const last = rows.reduce((mx, t) => (t.booking_date > mx ? t.booking_date : mx), '');
      const lastImport = m.ds.imports
        .filter((i) => i.account_id === a.id)
        .map((i) => i.imported_at.slice(0, 10))
        .sort()
        .pop();
      return { a, first: sorted[0], lastMonth: sorted[sorted.length - 1], gaps, last, lastImport };
    })
    .filter((x) => x !== null);

  const repoUrl =
    source?.kind === 'github' ? `https://github.com/${source.owner}/${source.repo}#readme` : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-1">
        <Link
          to="/more"
          className="-ml-2 flex size-11 items-center justify-center rounded-full text-ink-2"
          aria-label="Back"
        >
          <ChevronLeft size={22} />
        </Link>
        <h1 className="text-xl font-semibold">Import</h1>
      </div>

      <StatementImport />

      <Card>
        <CardTitle>Coverage</CardTitle>
        {coverage.length === 0 && <Empty>Nothing imported yet.</Empty>}
        <ul className="divide-y divide-line pb-1">
          {coverage.map((c) => {
            const stale = c.lastImport ? daysBetween(c.lastImport, m.today) : null;
            return (
              <li key={c.a.id} className="px-4 py-3 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">{c.a.name}</span>
                  <span className="text-ink-2">
                    {fmtMonthShort(c.first)} – {fmtMonthShort(c.lastMonth)}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-ink-3">
                  Last movement {fmtDate(c.last)}
                  {c.lastImport &&
                    ` · last import ${fmtDate(c.lastImport)}${stale !== null && stale >= 20 ? ` (${stale} days ago)` : ''}`}
                </div>
                {c.gaps.length > 0 && (
                  <div className="mt-1 text-xs text-warn">
                    Missing months: {c.gaps.map(fmtMonthShort).join(', ')}
                  </div>
                )}
                {monthOf(m.today) > addMonths(c.lastMonth, 1) && (
                  <div className="mt-1 text-xs text-warn">
                    Nothing after {fmtMonthShort(c.lastMonth)}: time for a new statement?
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <CardTitle>History</CardTitle>
        {imports.length === 0 && <Empty>No imports yet.</Empty>}
        <ul className="divide-y divide-line pb-1">
          {imports.map((i) => {
            const ok = i.checks.startsWith('ok');
            const closing = tryParseMoney(i.closing_balance);
            return (
              <li key={i.id} className="px-4 py-3 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">
                    {fmtDate(i.period_start)} – {fmtDate(i.period_end)}
                  </span>
                  <span className={ok ? 'text-good' : 'text-bad'}>{ok ? 'Checks OK' : 'Check failed'}</span>
                </div>
                <div className="mt-0.5 text-xs text-ink-3">
                  {m.ds.accounts.get(i.account_id)?.name ?? i.account_id} · {i.source_type} · imported{' '}
                  {fmtDate(i.imported_at.slice(0, 10))} by {i.by || '?'}
                </div>
                <div className="mt-0.5 text-xs text-ink-2">
                  {plural(Number(i.rows_added) || 0, 'row')} added, {Number(i.rows_duplicate) || 0} duplicates
                  skipped
                  {closing !== null && ` · closing balance ${formatEUR(closing)}`}
                </div>
                {i.checks.includes(';') && (
                  <div className="mt-1 text-xs text-warn">
                    {i.checks.split(';').slice(1).join(';').trim()}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <CardTitle>Or use an ingest session</CardTitle>
        <ol className="list-decimal space-y-1 px-8 pb-4 text-sm text-ink-2">
          <li>CGD app → movements → export PDF.</li>
          <li>
            Open a Claude session on your data repo with a cheaper model, attach the PDF and say “ingest this
            statement”. It also suggests categories and trips.
          </li>
          <li>Come back here: the new rows arrive on the next sync. Both ways give the same rows and ids.</li>
        </ol>
        {repoUrl && (
          <a
            href={repoUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="mx-4 mb-4 inline-block text-sm text-accent underline"
          >
            Data repo README
          </a>
        )}
      </Card>
    </div>
  );
}
