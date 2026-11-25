/** Insights panels added in M4 (SPEC §4.3): compare-to, money flow, calendar heatmap, recurring. */
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { netSpent, type Line } from '../../core/aggregates';
import { addDays, dayNum, lastDay, monthRange } from '../../core/dates';
import { isTripType } from '../../core/events';
import { dailySpend } from '../../core/insights';
import type { Model } from '../../core/model';
import { recurringDetails } from '../../core/recurring';
import { effOf } from '../../core/view';
import { EChart, type EChartsOption } from '../charts/EChart';
import { useColorScheme } from '../charts/useColorScheme';
import { DataTable, ViewToggle } from '../components/DataTable';
import { Card, CardTitle, Empty } from '../components/ui';
import { activityHref, openActivity, type TxnFilter } from '../lib/filter';
import { fmtDate, fmtMonth, fmtPct, formatEUR } from '../lib/format';
import { chartGroup, chartTheme, groupColor, GROUP_SLOT, OTHER_GROUP, tint } from '../lib/palette';
import type { Period } from '../lib/period';

const pct = (a: number, b: number) => (b === 0 ? null : (a - b) / Math.abs(b));

/** "+12% vs previous period", with an arrow so the direction is never colour alone. */
export function Delta({ now, before, label }: { now: number; before: number; label: string }) {
  const d = pct(now, before);
  if (d === null) return <span className="text-xs text-ink-3">no {label} data</span>;
  const Icon = d >= 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="flex items-center gap-0.5 text-xs text-ink-3">
      <Icon size={12} aria-hidden />
      {d >= 0 ? '+' : '−'}
      {fmtPct(Math.abs(d))}
    </span>
  );
}

/** Spending by group, this period against the compare period. Rows open this period's transactions. */
export function CompareCard({
  period,
  cmp,
  lines,
  cmpLines,
  gross,
}: {
  period: Period;
  cmp: Period;
  lines: Line[];
  cmpLines: Line[];
  gross: boolean;
}) {
  const rows = useMemo(() => {
    const by = (ls: Line[]) => {
      const out = new Map<string, number>();
      for (const l of ls) if (l.kind === 'expense') out.set(l.group, (out.get(l.group) ?? 0) - l.amount);
      return out;
    };
    const a = by(lines);
    const b = by(cmpLines);
    return [...new Set([...a.keys(), ...b.keys()])]
      .map((g) => ({ group: g, now: a.get(g) ?? 0, before: b.get(g) ?? 0 }))
      .filter((r) => r.now !== 0 || r.before !== 0)
      .sort((x, y) => Math.abs(y.now - y.before) - Math.abs(x.now - x.before));
  }, [lines, cmpLines]);
  const now = netSpent(lines);
  const before = netSpent(cmpLines);
  return (
    <Card className="lg:col-span-2">
      <CardTitle>
        Compared with{' '}
        {cmp.label.toLowerCase().startsWith('same') || cmp.label.startsWith('Previous')
          ? cmp.label.toLowerCase()
          : cmp.label}
      </CardTitle>
      <p className="-mt-1 px-4 text-xs text-ink-3">
        {fmtDate(period.from)} – {fmtDate(period.to)} against {fmtDate(cmp.from)} – {fmtDate(cmp.to)}
      </p>
      <div className="overflow-x-auto px-4 pb-3">
        <table className="num w-full text-sm" data-testid="compare-table">
          <thead className="text-left text-ink-2">
            <tr>
              <th className="py-1 font-medium">Group</th>
              <th className="py-1 text-right font-medium">Now</th>
              <th className="py-1 text-right font-medium">Before</th>
              <th className="py-1 text-right font-medium">Change</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            <tr className="font-semibold">
              <td className="py-1.5">All spending</td>
              <td className="py-1.5 text-right">{formatEUR(now, { compact: true })}</td>
              <td className="py-1.5 text-right">{formatEUR(before, { compact: true })}</td>
              <td className="py-1.5 text-right">{signed(now - before)}</td>
            </tr>
            {rows.map((r) => (
              <tr key={r.group}>
                <td className="py-1.5">
                  <Link
                    {...activityHref({
                      from: period.from,
                      to: period.to,
                      kind: 'expense',
                      group: r.group,
                      gross: gross || undefined,
                      label: `${r.group} · ${period.label}`,
                    })}
                    className="flex items-center gap-2"
                  >
                    <span
                      className="size-2.5 shrink-0 rounded-sm"
                      style={{ background: groupColor(r.group) }}
                    />
                    {r.group}
                  </Link>
                </td>
                <td className="py-1.5 text-right">{formatEUR(r.now, { compact: true })}</td>
                <td className="py-1.5 text-right text-ink-2">{formatEUR(r.before, { compact: true })}</td>
                <td className="py-1.5 text-right">{signed(r.now - r.before)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function signed(c: number): string {
  if (c === 0) return '0';
  return `${c > 0 ? '+' : '−'}${formatEUR(Math.abs(c), { compact: true })}`;
}

interface FlowNode {
  name: string;
  itemStyle: { color: string };
  depth: number;
  f?: TxnFilter;
}

/** Money flow (SPEC §4.3): income → groups → saved. Gross view adds refunds and paybacks as money in. */
export function MoneyFlow({
  period,
  lines,
  netLines,
  gross,
  m,
}: {
  period: Period;
  lines: Line[];
  netLines: Line[];
  gross: boolean;
  m: Model;
}) {
  const scheme = useColorScheme();
  const navigate = useNavigate();
  const [table, setTable] = useState(false);
  const flow = useMemo(() => {
    const dark = scheme === 'dark';
    const th = chartTheme(dark);
    const base = { from: period.from, to: period.to };
    const incomeBy = new Map<string, number>();
    for (const l of lines)
      if (l.kind === 'income')
        incomeBy.set(l.reportCategory, (incomeBy.get(l.reportCategory) ?? 0) + l.amount);
    const incomes = [...incomeBy.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const top = incomes.slice(0, 4);
    const rest = incomes.slice(4).reduce((s, [, v]) => s + v, 0);
    const groupBy = new Map<string, number>();
    for (const l of lines)
      if (l.kind === 'expense')
        groupBy.set(chartGroup(l.group), (groupBy.get(chartGroup(l.group)) ?? 0) - l.amount);
    const groups = [...groupBy.entries()]
      .filter(([, v]) => v > 0)
      .sort((a, b) => (GROUP_SLOT[a[0]] ?? 99) - (GROUP_SLOT[b[0]] ?? 99));
    const income = incomes.reduce((s, [, v]) => s + v, 0);
    const spentShown = groups.reduce((s, [, v]) => s + v, 0);
    // Refunds and paybacks netted in the net view are money in for the gross view.
    const refunds = gross ? netSpent(lines) - netSpent(netLines) : 0;
    const saved = income + refunds - spentShown;

    const inColor = dark ? '#8a918e' : '#7a807d';
    const nodes: FlowNode[] = [];
    const links: { source: string; target: string; value: number }[] = [];
    const mid = 'Money in';
    for (const [cat, v] of top) {
      const name = m.ds.categories.get(cat)?.name ?? cat;
      nodes.push({ name, depth: 0, itemStyle: { color: inColor }, f: { ...base, kind: 'income', cat } });
      links.push({ source: name, target: mid, value: v / 100 });
    }
    if (rest > 0) {
      nodes.push({
        name: 'Other income',
        depth: 0,
        itemStyle: { color: inColor },
        f: { ...base, kind: 'income' },
      });
      links.push({ source: 'Other income', target: mid, value: rest / 100 });
    }
    if (refunds > 0) {
      nodes.push({
        name: 'Refunds and paybacks',
        depth: 0,
        itemStyle: { color: inColor },
        f: { ...base, kind: 'expense' },
      });
      links.push({ source: 'Refunds and paybacks', target: mid, value: refunds / 100 });
    }
    if (saved < 0) {
      nodes.push({ name: 'From savings', depth: 0, itemStyle: { color: th.ink3 } });
      links.push({ source: 'From savings', target: mid, value: -saved / 100 });
    }
    nodes.push({ name: mid, depth: 1, itemStyle: { color: th.ink2 }, f: { ...base, kind: 'reporting' } });
    for (const [g, v] of groups) {
      nodes.push({
        name: g,
        depth: 2,
        itemStyle: { color: g === OTHER_GROUP ? groupColor('', dark) : groupColor(g, dark) },
        f: {
          ...base,
          kind: 'expense',
          ...(g === OTHER_GROUP ? {} : { group: g }),
          gross: gross || undefined,
        },
      });
      links.push({ source: mid, target: g, value: v / 100 });
    }
    if (saved > 0) {
      nodes.push({
        name: 'Saved',
        depth: 2,
        itemStyle: { color: th.accent },
        f: { ...base, kind: 'reporting' },
      });
      links.push({ source: mid, target: 'Saved', value: saved / 100 });
    }
    return { nodes, links, income, saved, empty: income === 0 && spentShown === 0 };
  }, [lines, netLines, gross, period, m, scheme]);

  const option = useMemo<EChartsOption>(() => {
    const th = chartTheme(scheme === 'dark');
    return {
      animation: false,
      tooltip: {
        trigger: 'item',
        formatter: (p: {
          dataType: string;
          name: string;
          value: number;
          data: { source?: string; target?: string };
        }) =>
          p.dataType === 'edge'
            ? `${p.data.source} → ${p.data.target}<br/><b>${formatEUR(Math.round(p.value * 100))}</b>`
            : `${p.name}<br/><b>${formatEUR(Math.round(p.value * 100))}</b>`,
      },
      series: [
        {
          type: 'sankey',
          left: 4,
          right: 4,
          top: 8,
          bottom: 8,
          nodeWidth: 10,
          nodeGap: 10,
          nodeAlign: 'justify',
          layoutIterations: 0,
          draggable: false,
          data: flow.nodes.map(({ name, itemStyle, depth }) => ({ name, itemStyle, depth })),
          links: flow.links,
          lineStyle: { color: 'gradient', opacity: 0.35, curveness: 0.5 },
          emphasis: { focus: 'adjacency' },
          label: { color: th.ink, fontSize: 11, position: 'right' },
          levels: [{ depth: 2, label: { position: 'left' } }],
        },
      ],
    };
  }, [flow, scheme]);

  const nodeOf = (name: string) => flow.nodes.find((x) => x.name === name);
  return (
    <Card>
      <CardTitle action={!flow.empty && <ViewToggle table={table} onChange={setTable} what="money flow" />}>
        Money flow
      </CardTitle>
      {flow.empty ? (
        <Empty>No money moved in this period.</Empty>
      ) : table ? (
        <DataTable
          caption={`Money flow, ${period.label}`}
          testId="flow-table"
          columns={[{ label: 'From' }, { label: 'To' }, { label: 'Amount', num: true }]}
          rows={flow.links.map((l) => {
            const incoming = l.target === 'Money in';
            const name = incoming ? l.source : l.target;
            const f = nodeOf(name)?.f;
            const cell = f ? (
              <Link {...activityHref({ ...f, label: `${name} · ${period.label}` })} className="text-accent">
                {name}
              </Link>
            ) : (
              name
            );
            const amount = formatEUR(Math.round(l.value * 100));
            return incoming ? [cell, 'Money in', amount] : ['Money in', cell, amount];
          })}
        />
      ) : (
        <div className="px-2 pb-2">
          <EChart
            option={option}
            height={Math.max(260, flow.nodes.length * 30)}
            ariaLabel="Money flow from income through spending groups to savings"
            onClick={(p) => {
              const n = flow.nodes.find((x) => x.name === p.name);
              if (n?.f) openActivity(navigate, { ...n.f, label: `${n.name} · ${period.label}` });
            }}
          />
          <p className="px-2 text-xs text-ink-3">
            {flow.saved >= 0
              ? `${formatEUR(flow.saved)} of ${formatEUR(flow.income)} in stayed with you.`
              : `Spending was ${formatEUR(-flow.saved)} more than money in.`}{' '}
            Tap a block to see its transactions.
          </p>
        </div>
      )}
    </Card>
  );
}

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** Daily spend as mini month calendars (SPEC §4.3), trip days hatched. Each day opens its transactions. */
export function CalendarHeat({
  m,
  period,
  lines,
  gross,
}: {
  m: Model;
  period: Period;
  lines: Line[];
  gross: boolean;
}) {
  const scheme = useColorScheme();
  const dark = scheme === 'dark';
  const [table, setTable] = useState(false);
  const to = period.to > m.today ? m.today : period.to;
  const months = useMemo(
    () => monthRange(period.from.slice(0, 7), to.slice(0, 7)).slice(-12),
    [period.from, to],
  );
  const from = `${months[0]}-01` < period.from ? period.from : `${months[0]}-01`;
  const daily = useMemo(() => dailySpend(lines, from, to), [lines, from, to]);
  const tripDays = useMemo(() => {
    const s = new Map<string, string>();
    for (const e of m.ds.events) {
      if (!isTripType(e) || e.status !== 'confirmed' || !e.end_date) continue;
      for (let d = e.start_date; d <= e.end_date; d = addDays(d, 1)) s.set(d, e.name);
    }
    return s;
  }, [m]);
  const steps = useMemo(() => {
    const vals = [...daily.values()].filter((v) => v > 0).sort((a, b) => a - b);
    const q = (p: number) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))] ?? 0;
    return [q(0.2), q(0.4), q(0.6), q(0.8)];
  }, [daily]);
  const accent = chartTheme(dark).accent;
  const ramp = [0.85, 0.65, 0.42, 0.2, 0].map((t) => tint(accent, t, dark));
  const colorOf = (v: number) => {
    if (v <= 0) return 'var(--surface-2)';
    let i = 0;
    while (i < steps.length && v > steps[i]) i++;
    return ramp[i];
  };
  const hatch = dark
    ? 'repeating-linear-gradient(135deg, rgba(255,255,255,.55) 0 1.5px, transparent 1.5px 5px)'
    : 'repeating-linear-gradient(135deg, rgba(0,0,0,.5) 0 1.5px, transparent 1.5px 5px)';
  const total = [...daily.values()].reduce((s, v) => s + v, 0);
  const days = Math.max(1, dayNum(to) - dayNum(from) + 1);
  const byMonth = useMemo(
    () =>
      months.map((ym) => {
        let spent = 0;
        let top: [string, number] | null = null;
        let n = 0;
        for (const [d, v] of daily) {
          if (!d.startsWith(ym)) continue;
          spent += v;
          if (v > 0) n++;
          if (v > 0 && (!top || v > top[1])) top = [d, v];
        }
        return { ym, spent, n, top };
      }),
    [months, daily],
  );

  return (
    <Card className="lg:col-span-2">
      <CardTitle action={<ViewToggle table={table} onChange={setTable} what="spending by day" />}>
        Spending by day
      </CardTitle>
      <p className="-mt-1 px-4 text-xs text-ink-3">
        {formatEUR(Math.round(total / days))} a day on average
        {months.length === 12 && monthRange(period.from.slice(0, 7), to.slice(0, 7)).length > 12
          ? ' · last 12 months shown'
          : ''}
      </p>
      {table ? (
        <DataTable
          caption="Spending per month, with the busiest day"
          testId="calendar-table"
          columns={[
            { label: 'Month' },
            { label: 'Spent', num: true },
            { label: 'Days with spending', num: true },
            { label: 'Busiest day', num: true },
          ]}
          rows={byMonth.map((r) => [
            fmtMonth(r.ym),
            formatEUR(Math.max(0, r.spent)),
            r.n,
            r.top ? (
              <Link
                {...activityHref({
                  from: r.top[0],
                  to: r.top[0],
                  kind: 'expense',
                  gross: gross || undefined,
                  label: fmtDate(r.top[0]),
                })}
                className="text-accent"
              >
                {fmtDate(r.top[0])}: {formatEUR(r.top[1])}
                {tripDays.get(r.top[0]) ? ` (${tripDays.get(r.top[0])})` : ''}
              </Link>
            ) : (
              '—'
            ),
          ])}
        />
      ) : (
        <>
          <div
            className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3 sm:grid-cols-3 lg:grid-cols-4"
            data-testid="calendar"
          >
            {months.map((ym) => {
              const first = new Date(`${ym}-01T00:00:00Z`).getUTCDay();
              const pad = (first + 6) % 7;
              const n = Number(lastDay(ym).slice(8, 10));
              return (
                <div key={ym}>
                  <div className="mb-1 text-xs font-medium text-ink-2">{fmtMonth(ym)}</div>
                  <div className="grid grid-cols-7 gap-[2px]">
                    {WEEKDAYS.map((w, i) => (
                      <span key={i} className="text-center text-[10px] leading-4 text-ink-3" aria-hidden>
                        {w}
                      </span>
                    ))}
                    {Array.from({ length: pad }, (_, i) => (
                      <span key={`p${i}`} />
                    ))}
                    {Array.from({ length: n }, (_, i) => {
                      const d = `${ym}-${String(i + 1).padStart(2, '0')}`;
                      const out = d < from || d > to;
                      const v = daily.get(d) ?? 0;
                      const trip = tripDays.get(d);
                      const label = `${fmtDate(d)}: ${formatEUR(Math.max(0, v))} spent${trip ? ` · ${trip}` : ''}`;
                      if (out)
                        return (
                          <span
                            key={d}
                            className="aspect-square rounded-[3px] border border-dashed border-line"
                          />
                        );
                      return (
                        <Link
                          key={d}
                          {...activityHref({
                            from: d,
                            to: d,
                            kind: 'expense',
                            gross: gross || undefined,
                            label: fmtDate(d),
                          })}
                          title={label}
                          aria-label={label}
                          className="aspect-square rounded-[3px]"
                          style={{
                            backgroundColor: colorOf(v),
                            backgroundImage: trip ? hatch : undefined,
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <div
            className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pb-3 text-xs text-ink-2"
            aria-label="Legend"
          >
            <span className="flex items-center gap-1">
              Less
              {['var(--surface-2)', ...ramp].map((c) => (
                <span key={c} className="size-3 rounded-[3px]" style={{ backgroundColor: c }} />
              ))}
              More
            </span>
            <span className="flex items-center gap-1">
              <span
                className="size-3 rounded-[3px]"
                style={{ backgroundColor: ramp[1], backgroundImage: hatch }}
              />
              Trip day
            </span>
          </div>
        </>
      )}
    </Card>
  );
}

function every(days: number): string {
  if (days <= 9) return 'weekly';
  if (days <= 18) return 'every 2 weeks';
  if (days <= 40) return 'monthly';
  if (days <= 100) return 'every 3 months';
  if (days <= 200) return 'every 6 months';
  if (days <= 400) return 'yearly';
  return `every ${days} days`;
}

/** Recurring payments (DATA_MODEL §8) with monthly cost and next expected date. */
export function Recurring({ m }: { m: Model }) {
  const [all, setAll] = useState(false);
  const items = useMemo(() => {
    return recurringDetails(m.ds, m.recurring).map((r) => {
      const last = r.txns[r.txns.length - 1];
      const overdue = dayNum(m.today) - dayNum(r.nextExpected);
      return {
        ...r,
        name: effOf(m.view, last).merchant,
        group: effOf(m.view, last).group,
        // two intervals (and at least a fortnight) without a payment: probably cancelled
        stopped: overdue > Math.max(14, r.intervalDays),
      };
    });
  }, [m]);
  const active = items.filter((i) => !i.stopped);
  const monthly = active.reduce((s, i) => s + i.monthlyCost, 0);
  return (
    <Card>
      <CardTitle>Recurring</CardTitle>
      {items.length === 0 ? (
        <Empty>Nothing repeats for three months or more yet.</Empty>
      ) : (
        <>
          <p className="-mt-1 px-4 text-sm">
            <span className="num font-semibold" data-testid="recurring-monthly">
              {formatEUR(monthly)}
            </span>{' '}
            <span className="text-ink-2">a month across {active.length} payments</span>
          </p>
          <ul className="divide-y divide-line pb-1">
            {(all ? items : items.slice(0, 8)).map((r) => (
              <li key={r.key}>
                <Link
                  {...activityHref({ merchant: r.name, kind: 'expense', label: `${r.name} · all time` })}
                  className={`flex min-h-12 items-center gap-3 px-4 py-2 hover:bg-surface-2 ${r.stopped ? 'opacity-60' : ''}`}
                >
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: groupColor(r.group) }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{r.name}</span>
                    <span className="block text-xs text-ink-3">
                      {formatEUR(r.typical)} {every(r.intervalDays)} ·{' '}
                      {r.stopped
                        ? `last paid ${fmtDate(r.last)}, may have stopped`
                        : `next around ${fmtDate(r.nextExpected)}`}
                    </span>
                  </span>
                  <span className="num text-right text-sm">
                    {formatEUR(r.monthlyCost)}
                    <span className="block text-xs text-ink-3">/month</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {items.length > 8 && (
            <button
              type="button"
              className="min-h-11 w-full text-sm text-accent"
              onClick={() => setAll(!all)}
            >
              {all ? 'Show fewer' : `Show all ${items.length}`}
            </button>
          )}
        </>
      )}
    </Card>
  );
}
