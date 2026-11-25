/** Year in review (M6): a calendar year's income, spending, saving and where it went, every figure tappable. */
import { ChevronLeft, ChevronRight, Plane } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import type { MonthTotals } from '../../core/aggregates';
import type { Txn } from '../../core/dataset';
import { lastDay } from '../../core/dates';
import { reviewYears, yearReview } from '../../core/yearReview';
import { useModel } from '../../state/store';
import { EChart, type EChartsOption } from '../charts/EChart';
import { useColorScheme } from '../charts/useColorScheme';
import { DataTable, ViewToggle } from '../components/DataTable';
import { TxnDetail } from '../components/TxnDetail';
import { TxnRow } from '../components/TxnRow';
import { Card, CardTitle, Empty } from '../components/ui';
import { activityHref, openActivity, type TxnFilter } from '../lib/filter';
import { fmtDate, fmtDay, fmtMonth, fmtPct, formatEUR, formatEURShort, plural } from '../lib/format';
import { chartTheme, groupColor } from '../lib/palette';
import { Delta } from './InsightsPanels';

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const abbr = (ym: string) => MONTH_ABBR[Number(ym.slice(5, 7)) - 1];
const monthFilter = (ym: string): TxnFilter => ({ from: `${ym}-01`, to: lastDay(ym) });

export function YearReviewPage() {
  const m = useModel();
  const { year } = useParams();
  const years = reviewYears(m);
  if (!years.length) return <YearEmpty />;
  if (!year || !years.includes(year)) return <Navigate to={`/insights/year/${years[0]}`} replace />;
  return <Review year={year} years={years} />;
}

function YearEmpty() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <h1 className="text-xl font-semibold">Year in review</h1>
      <Card>
        <Empty>
          Nothing to review yet.{' '}
          <Link to="/more/import" className="text-accent underline">
            Import a statement
          </Link>{' '}
          and your first year starts here.
        </Empty>
      </Card>
    </div>
  );
}

function Review({ year, years }: { year: string; years: string[] }) {
  const m = useModel();
  const r = useMemo(() => yearReview(m, year), [m, year]);
  const [selected, setSelected] = useState<Txn | null>(null);
  const i = years.indexOf(year);
  const older = years[i + 1];
  const newer = years[i - 1];
  const range = { from: r.from, to: r.to };
  const span = r.months.length
    ? r.partial
      ? `${abbr(r.months[0].month)} – ${abbr(r.months[r.months.length - 1].month)}${
          r.to === m.today ? ', so far' : ''
        }`
      : 'January – December'
    : '';
  const prevLabel = r.prev
    ? `${abbr(r.prev.from.slice(0, 7))}–${abbr(r.prev.to.slice(0, 7))} ${r.prev.from.slice(0, 4)}`
    : '';
  const kpis = [
    { label: 'Income', v: r.totals.income, before: r.prev?.income, f: { kind: 'income' as const } },
    { label: 'Spent', v: r.totals.spent, before: r.prev?.spent, f: { kind: 'expense' as const } },
    { label: 'Saved', v: r.totals.saved, before: r.prev?.saved, f: { kind: 'reporting' as const } },
  ];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <YearLink year={older} dir="older" />
        <div className="text-center">
          <h1 className="text-xl font-semibold" data-testid="year-title">
            {year} in review
          </h1>
          <p className="text-xs text-ink-3">{span}</p>
        </div>
        <YearLink year={newer} dir="newer" />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {kpis.map((k) => (
          <Link
            key={k.label}
            {...activityHref({ ...range, ...k.f, label: `${k.label} · ${year}` })}
            className="rounded-2xl border border-line bg-surface p-3"
          >
            <div className="text-xs text-ink-2">{k.label}</div>
            <div className="num text-lg font-semibold" data-testid={`year-${k.label.toLowerCase()}`}>
              {formatEUR(k.v, { compact: true })}
            </div>
            {k.before !== undefined ? (
              <Delta now={k.v} before={k.before} label={prevLabel} />
            ) : (
              <span className="text-xs text-ink-3">no {Number(year) - 1} data</span>
            )}
          </Link>
        ))}
        <div className="rounded-2xl border border-line bg-surface p-3">
          <div className="text-xs text-ink-2">Savings rate</div>
          <div className="num text-lg font-semibold" data-testid="year-rate">
            {fmtPct(r.totals.rate)}
          </div>
          <span className="text-xs text-ink-3">
            {r.prev ? `${fmtPct(r.prev.rate)} in ${prevLabel}` : 'of income kept'}
          </span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <MonthByMonth months={r.months} year={year} best={r.best} worst={r.worst} />

        <Card>
          <CardTitle>Where it went</CardTitle>
          {r.groups.length === 0 && <Empty>No spending this year.</Empty>}
          <ul className="divide-y divide-line pb-1" data-testid="year-groups">
            {r.groups.map((g) => {
              const max = Math.max(1, r.groups[0]?.spent ?? 1);
              return (
                <li key={g.group}>
                  <Link
                    {...activityHref({
                      ...range,
                      kind: 'expense',
                      group: g.group,
                      label: `${g.group} · ${year}`,
                    })}
                    className="flex min-h-12 flex-col justify-center gap-1 px-4 py-1.5 hover:bg-surface-2"
                  >
                    <span className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex items-center gap-2 font-medium">
                        <span
                          className="size-2.5 shrink-0 rounded-sm"
                          style={{ background: groupColor(g.group) }}
                        />
                        {g.group}
                      </span>
                      <span className="num font-medium">{formatEUR(g.spent)}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="h-1.5 flex-1 rounded-full bg-surface-2">
                        <span
                          className="block h-1.5 rounded-full"
                          style={{
                            width: `${Math.max(0, (g.spent / max) * 100)}%`,
                            background: groupColor(g.group),
                          }}
                        />
                      </span>
                      <span className="w-28 text-right text-xs leading-4">
                        {g.prev === null ? (
                          <span className="text-xs text-ink-3">
                            {fmtPct(g.spent / (r.totals.spent || 1))}
                          </span>
                        ) : (
                          <Delta now={g.spent} before={g.prev} label={prevLabel} />
                        )}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card>
          <CardTitle>Top merchants</CardTitle>
          {r.merchants.length === 0 && <Empty>No spending this year.</Empty>}
          <ol className="divide-y divide-line pb-1">
            {r.merchants.map((s, n) => (
              <li key={s.merchant}>
                <Link
                  {...activityHref({
                    ...range,
                    merchant: s.merchant,
                    kind: 'expense',
                    label: `${s.merchant} · ${year}`,
                  })}
                  className="flex min-h-12 items-center gap-3 px-4 py-2 hover:bg-surface-2"
                >
                  <span className="num w-5 text-right text-xs text-ink-3">{n + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{s.merchant}</span>
                    <span className="block text-xs text-ink-3">{plural(s.count, 'visit')}</span>
                  </span>
                  <span className="num text-sm font-medium">{formatEUR(s.spent)}</span>
                </Link>
              </li>
            ))}
          </ol>
        </Card>

        <Card>
          <CardTitle>Trips</CardTitle>
          {r.trips.length === 0 ? (
            <Empty>No confirmed trips this year.</Empty>
          ) : (
            <>
              <p className="-mt-1 px-4 text-xs text-ink-3">
                {plural(r.trips.length, 'trip')}, {formatEUR(r.trips.reduce((s, t) => s + t.total, 0))} in all
              </p>
              <ul className="divide-y divide-line pb-1">
                {r.trips.map(({ event: e, total, days }) => (
                  <li key={e.id}>
                    <Link
                      to={`/more/events/${encodeURIComponent(e.id)}`}
                      className="flex min-h-12 items-center gap-3 px-4 py-2 hover:bg-surface-2"
                    >
                      <Plane size={18} className="shrink-0 text-ink-3" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{e.name}</span>
                        <span className="block text-xs text-ink-3">
                          {fmtDay(e.start_date)} · {plural(days, 'day')}
                        </span>
                      </span>
                      <span className="num text-sm font-medium">{formatEUR(total)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        <Card className="overflow-hidden lg:col-span-2">
          <CardTitle>Biggest one-off expenses</CardTitle>
          {r.biggest.length === 0 && <Empty>No spending this year.</Empty>}
          <div className="divide-y divide-line">
            {r.biggest.map((l) => (
              <TxnRow key={l.txn.id} t={l.txn} onOpen={setSelected} />
            ))}
          </div>
        </Card>
      </div>
      <p className="text-center text-xs text-ink-3">
        {fmtDate(r.from)} – {fmtDate(r.to)} · net of refunds and paybacks
      </p>
      <TxnDetail t={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function YearLink({ year, dir }: { year?: string; dir: 'older' | 'newer' }) {
  const Icon = dir === 'older' ? ChevronLeft : ChevronRight;
  const label = dir === 'older' ? 'Previous year' : 'Next year';
  if (!year)
    return (
      <span className="flex size-11 items-center justify-center text-ink-3 opacity-30" aria-hidden="true">
        <Icon size={22} />
      </span>
    );
  return (
    <Link
      to={`/insights/year/${year}`}
      replace
      className="flex size-11 items-center justify-center rounded-full text-ink-2"
      aria-label={`${label}: ${year}`}
    >
      <Icon size={22} />
    </Link>
  );
}

function MonthByMonth({
  months,
  year,
  best,
  worst,
}: {
  months: MonthTotals[];
  year: string;
  best: MonthTotals | null;
  worst: MonthTotals | null;
}) {
  const scheme = useColorScheme();
  const navigate = useNavigate();
  const [table, setTable] = useState(false);
  const option = useMemo<EChartsOption>(() => {
    const th = chartTheme(scheme === 'dark');
    return {
      animation: false,
      grid: { left: 8, right: 8, top: 8, bottom: 4, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        valueFormatter: (v: unknown) => (typeof v === 'number' ? formatEUR(Math.round(v * 100)) : '—'),
      },
      xAxis: {
        type: 'category',
        data: months.map((x) => abbr(x.month)),
        axisLine: { lineStyle: { color: th.grid } },
        axisTick: { show: false },
        axisLabel: { color: th.ink3 },
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        splitLine: { lineStyle: { color: th.grid } },
        axisLabel: { color: th.ink3, formatter: (v: number) => formatEURShort(v * 100) },
      },
      series: [
        {
          name: 'Spent',
          type: 'bar',
          barMaxWidth: 24,
          data: months.map((x) => x.spent / 100),
          itemStyle: { color: th.accent, borderRadius: [4, 4, 0, 0] },
        },
        {
          name: 'Income',
          type: 'line',
          data: months.map((x) => x.income / 100),
          symbol: 'circle',
          symbolSize: 8,
          lineStyle: { width: 2, color: th.ink },
          itemStyle: { color: th.ink },
          z: 5,
        },
      ],
    };
  }, [months, scheme]);
  const th = chartTheme(scheme === 'dark');

  return (
    <Card>
      <CardTitle action={<ViewToggle table={table} onChange={setTable} what="month by month" />}>
        Month by month
      </CardTitle>
      {months.length === 0 ? (
        <Empty>No months with data in {year}.</Empty>
      ) : table ? (
        <DataTable
          caption={`Income, spending and saving per month of ${year}`}
          testId="year-table"
          columns={[
            { label: 'Month' },
            { label: 'Income', num: true },
            { label: 'Spent', num: true },
            { label: 'Saved', num: true },
            { label: 'Rate', num: true },
          ]}
          rows={months.map((x) => [
            <Link
              {...activityHref({ ...monthFilter(x.month), kind: 'reporting', label: fmtMonth(x.month) })}
              className="text-accent"
            >
              {fmtMonth(x.month)}
            </Link>,
            formatEUR(x.income),
            formatEUR(x.spent),
            formatEUR(x.saved),
            fmtPct(x.savingsRate),
          ])}
        />
      ) : (
        <>
          <div className="flex gap-3 px-4 py-1 text-xs text-ink-2" aria-label="Legend">
            <span className="flex items-center gap-1">
              <span className="size-2.5 rounded-sm" style={{ background: th.accent }} />
              Spent
            </span>
            <span className="flex items-center gap-1">
              <span className="h-0.5 w-3 bg-ink" />
              Income
            </span>
          </div>
          <div className="px-2">
            <EChart
              option={option}
              height={220}
              ariaLabel={`Spending per month of ${year} as columns, with income as a line`}
              onClick={(p) => {
                const x = months[p.dataIndex];
                if (!x) return;
                const income = p.seriesName === 'Income';
                openActivity(navigate, {
                  ...monthFilter(x.month),
                  kind: income ? 'income' : 'expense',
                  label: `${income ? 'Income' : 'Spent'} · ${fmtMonth(x.month)}`,
                });
              }}
            />
          </div>
        </>
      )}
      {best && worst && (
        <div className="grid grid-cols-2 gap-2 px-4 pt-1 pb-3 text-sm">
          <Link
            {...activityHref({ ...monthFilter(best.month), kind: 'reporting', label: fmtMonth(best.month) })}
            className="rounded-xl bg-surface-2 p-2"
          >
            <div className="text-xs text-ink-2">Best month</div>
            <div className="font-medium">{fmtMonth(best.month)}</div>
            <div className="num text-xs text-ink-3">saved {formatEUR(best.saved, { compact: true })}</div>
          </Link>
          <Link
            {...activityHref({
              ...monthFilter(worst.month),
              kind: 'reporting',
              label: fmtMonth(worst.month),
            })}
            className="rounded-xl bg-surface-2 p-2"
          >
            <div className="text-xs text-ink-2">Hardest month</div>
            <div className="font-medium">{fmtMonth(worst.month)}</div>
            <div className="num text-xs text-ink-3">
              {worst.saved >= 0 ? 'saved' : 'overspent'} {formatEUR(Math.abs(worst.saved), { compact: true })}
            </div>
          </Link>
        </div>
      )}
    </Card>
  );
}
