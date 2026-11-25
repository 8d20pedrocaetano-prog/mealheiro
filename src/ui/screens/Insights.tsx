import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { isGrossLine, netSpent, type Line } from '../../core/aggregates';
import { addMonths, monthRange } from '../../core/dates';
import { merchantStats, monthlySeries } from '../../core/insights';
import type { Model } from '../../core/model';
import { useModel } from '../../state/store';
import { comparePeriod, elapsed, periodPresets, type CompareMode, type Period } from '../lib/period';
import { CalendarHeat, CompareCard, Delta, MoneyFlow, Recurring } from './InsightsPanels';
import { EChart, type EChartsOption } from '../charts/EChart';
import { useColorScheme } from '../charts/useColorScheme';
import { Card, CardTitle, Chip, Empty, Segmented } from '../components/ui';
import { activityHref, monthRangeFilter, openActivity } from '../lib/filter';
import { fmtDate, fmtMonth, fmtMonthShort, fmtPct, formatEUR, formatEURShort } from '../lib/format';
import { chartGroup, chartTheme, groupColor, GROUP_SLOT, onColor, OTHER_GROUP, tint } from '../lib/palette';

export function Insights() {
  const m = useModel();
  const presets = useMemo(() => periodPresets(m), [m]);
  const [periodId, setPeriodId] = useState('6m');
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const period = useMemo<Period>(
    () =>
      periodId === 'custom' && custom
        ? { id: 'custom', label: 'Custom', ...custom }
        : (presets.find((p) => p.id === periodId) ?? presets[3]),
    [periodId, custom, presets],
  );

  const [gross, setGross] = useState(false);
  const [compare, setCompare] = useState<CompareMode>('');
  // Gross view (SPEC §4.3): spending counts only money out; refunds and paybacks are not netted.
  const base = useMemo(
    () => (gross ? m.lines.filter((l) => l.kind === 'income' || isGrossLine(l)) : m.lines),
    [m, gross],
  );
  const inPeriod = useMemo(() => within(base, period), [base, period]);
  const netInPeriod = useMemo(() => within(m.lines, period), [m, period]);
  const income = inPeriod.filter((l) => l.kind === 'income').reduce((s, l) => s + l.amount, 0);
  const spent = netSpent(inPeriod);
  const saved = income - netSpent(netInPeriod);
  const cmp = useMemo(() => comparePeriod(period, compare, m), [period, compare, m]);
  const cmpData = useMemo(() => {
    if (!cmp) return null;
    const now = elapsed(period, m.today);
    const nowLines = within(base, now);
    const before = within(base, cmp);
    return {
      now,
      nowLines,
      before,
      tNow: totals(nowLines, within(m.lines, now)),
      tBefore: totals(before, within(m.lines, cmp)),
    };
  }, [cmp, base, period, m]);
  const stages = m.ds.events.filter((e) => e.type === 'stage' && e.status === 'confirmed');

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Insights</h1>
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
        {presets.map((p) => (
          <Chip key={p.id} active={period.id === p.id} onClick={() => setPeriodId(p.id)}>
            {p.label}
          </Chip>
        ))}
        <Chip
          active={period.id === 'custom'}
          onClick={() => {
            setCustom(custom ?? { from: period.from, to: period.to });
            setPeriodId('custom');
          }}
        >
          Custom
        </Chip>
      </div>
      {period.id === 'custom' && custom && (
        <div className="flex gap-2">
          <input
            type="date"
            className="h-11 flex-1 rounded-xl border border-line bg-surface px-3"
            value={custom.from}
            onChange={(e) => setCustom({ ...custom, from: e.target.value })}
            aria-label="From"
          />
          <input
            type="date"
            className="h-11 flex-1 rounded-xl border border-line bg-surface px-3"
            value={custom.to}
            onChange={(e) => setCustom({ ...custom, to: e.target.value })}
            aria-label="To"
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="w-40">
          <Segmented
            label="Spending view"
            value={gross ? 'gross' : 'net'}
            onChange={(v) => setGross(v === 'gross')}
            options={[
              { value: 'net', label: 'Net' },
              { value: 'gross', label: 'Gross' },
            ]}
          />
        </div>
        <select
          className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-sm"
          value={compare}
          onChange={(e) => setCompare(e.target.value as CompareMode)}
          aria-label="Compare to"
        >
          <option value="">No comparison</option>
          <option value="previous">Compare to previous period</option>
          <option value="last-year">Compare to same time last year</option>
          {stages.map((e) => (
            <option key={e.id} value={`stage-${e.id}`}>
              Compare to stage: {e.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[
          ['Income', income, { from: period.from, to: period.to, kind: 'income' as const }],
          [
            'Spent',
            spent,
            { from: period.from, to: period.to, kind: 'expense' as const, gross: gross || undefined },
          ],
          ['Saved', saved, { from: period.from, to: period.to, kind: 'reporting' as const }],
        ].map(([label, v, f]) => (
          <Link
            key={label as string}
            {...activityHref({ ...(f as object), label: `${label} · ${period.label}` })}
            className="rounded-2xl border border-line bg-surface p-3"
          >
            <div className="text-xs text-ink-2">{label as string}</div>
            <div
              className="num text-base font-semibold"
              data-testid={`period-${(label as string).toLowerCase()}`}
            >
              {formatEUR(v as number, { compact: true })}
            </div>
            {cmpData && (
              <Delta
                now={cmpData.tNow[label as 'Income']}
                before={cmpData.tBefore[label as 'Income']}
                label={cmp?.label.toLowerCase() ?? ''}
              />
            )}
          </Link>
        ))}
      </div>
      <p className="-mt-2 text-xs text-ink-3">
        {fmtDate(period.from)} – {fmtDate(period.to)}
        {income > 0 ? ` · saved ${fmtPct(saved / income)} of income` : ''}
        {gross ? ' · gross: refunds and paybacks not netted' : ''}
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <OverTime m={m} period={period} lines={base} gross={gross} />
        {cmp && cmpData && (
          <CompareCard
            period={cmpData.now}
            cmp={cmp}
            lines={cmpData.nowLines}
            cmpLines={cmpData.before}
            gross={gross}
          />
        )}
        <WhereItGoes m={m} period={period} lines={inPeriod} gross={gross} />
        <MoneyFlow m={m} period={period} lines={inPeriod} netLines={netInPeriod} gross={gross} />
        <Merchants m={m} period={period} lines={inPeriod} gross={gross} />
        <Recurring m={m} />
        <CalendarHeat m={m} period={period} lines={inPeriod} gross={gross} />
      </div>
    </div>
  );
}

function within(ls: Line[], p: { from: string; to: string }): Line[] {
  return ls.filter((l) => l.date >= p.from && l.date <= p.to);
}

/** Income, spent (in the chosen view) and saved (always net: it is real money). */
function totals(ls: Line[], net: Line[]) {
  const inc = ls.filter((l) => l.kind === 'income').reduce((s, l) => s + l.amount, 0);
  return { Income: inc, Spent: netSpent(ls), Saved: inc - netSpent(net) };
}

function chartMonths(period: Period): string[] {
  let from = period.from.slice(0, 7);
  const to = period.to.slice(0, 7);
  if (monthRange(from, to).length < 3) from = addMonths(to, -5);
  return monthRange(from, to);
}

function OverTime({ m, period, lines, gross }: { m: Model; period: Period; lines: Line[]; gross: boolean }) {
  const scheme = useColorScheme();
  const navigate = useNavigate();
  const [focus, setFocus] = useState<string>('');
  const [table, setTable] = useState(false);
  const months = useMemo(() => chartMonths(period), [period]);
  const groupOf = useMemo(
    () =>
      focus
        ? (l: Line) => (l.group === focus ? l.reportCategory : '·other')
        : (l: Line) => chartGroup(l.group),
    [focus],
  );
  const series = useMemo(() => monthlySeries(lines, months, groupOf), [lines, months, groupOf]);
  const keys = useMemo(() => {
    const totals = new Map<string, number>();
    for (const s of series) for (const [k, v] of s.byGroup) totals.set(k, (totals.get(k) ?? 0) + v);
    const ks = [...totals.keys()].filter((k) => k !== '·other');
    if (!focus) {
      // fixed group order (colour follows the group), "Other groups" last
      return ks.sort((a, b) => (GROUP_SLOT[a] ?? 99) - (GROUP_SLOT[b] ?? 99));
    }
    return ks.sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0));
  }, [series, focus]);
  const groups = useMemo(
    () => [...new Set(m.lines.filter((l) => l.kind === 'expense').map((l) => l.group))].sort(),
    [m],
  );

  const option = useMemo<EChartsOption>(() => {
    const dark = scheme === 'dark';
    const th = chartTheme(dark);
    const base = focus ? groupColor(focus, dark) : '';
    const color = (k: string, i: number) =>
      focus
        ? tint(base, Math.min(0.7, i * 0.14), dark)
        : k === OTHER_GROUP
          ? groupColor('', dark)
          : groupColor(k, dark);
    const nameOf = (k: string) => (focus ? (m.ds.categories.get(k)?.name ?? k) : k);
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
        data: months.map(fmtMonthShort),
        axisLine: { lineStyle: { color: th.grid } },
        axisTick: { show: false },
        axisLabel: { color: th.ink3 },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: th.grid } },
        axisLabel: { color: th.ink3, formatter: (v: number) => formatEURShort(v * 100) },
      },
      series: [
        ...keys.map((k, i) => ({
          name: nameOf(k),
          type: 'bar',
          stack: 'spend',
          barMaxWidth: 28,
          data: series.map((s) => Math.max(0, s.byGroup.get(k) ?? 0) / 100),
          itemStyle: { color: color(k, i), borderColor: th.surface, borderWidth: 1 },
          emphasis: { focus: 'series' },
        })),
        {
          name: 'Income',
          type: 'line',
          data: series.map((s) => s.income / 100),
          symbol: 'circle',
          symbolSize: 7,
          lineStyle: { width: 2, color: th.ink },
          itemStyle: { color: th.ink },
          z: 5,
        },
      ],
    };
  }, [scheme, months, keys, series, focus, m]);

  const rateOption = useMemo<EChartsOption>(() => {
    const th = chartTheme(scheme === 'dark');
    return {
      animation: false,
      grid: { left: 8, right: 8, top: 8, bottom: 4, containLabel: true },
      tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => (typeof v === 'number' ? `${v}%` : '—') },
      xAxis: {
        type: 'category',
        data: months.map(fmtMonthShort),
        axisLine: { lineStyle: { color: th.grid } },
        axisTick: { show: false },
        axisLabel: { color: th.ink3 },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: th.grid } },
        axisLabel: { color: th.ink3, formatter: '{value}%' },
      },
      series: [
        {
          name: 'Savings rate',
          type: 'line',
          data: series.map((s) => (s.income > 0 ? Math.round((s.saved / s.income) * 100) : null)),
          symbol: 'circle',
          symbolSize: 7,
          lineStyle: { width: 2, color: th.accent },
          itemStyle: { color: th.accent },
        },
      ],
    };
  }, [scheme, months, series]);

  const legend = focus
    ? keys.map((k, i) => ({ k, name: m.ds.categories.get(k)?.name ?? k, i }))
    : keys.map((k, i) => ({ k, name: k, i }));
  return (
    <Card className="lg:col-span-2">
      <CardTitle
        action={
          <button className="text-sm text-accent" onClick={() => setTable(!table)}>
            {table ? 'Chart' : 'Table'}
          </button>
        }
      >
        Spending over time
      </CardTitle>
      <div className="px-4 pb-1">
        <select
          className="h-9 rounded-lg border border-line bg-surface px-2 text-sm"
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          aria-label="Show"
        >
          <option value="">By group</option>
          {groups.map((g) => (
            <option key={g} value={g}>
              Categories in {g}
            </option>
          ))}
        </select>
      </div>
      {table ? (
        <div className="overflow-x-auto px-4 pb-3">
          <table className="num w-full text-sm">
            <thead className="text-left text-ink-2">
              <tr>
                <th className="py-1 font-medium">Month</th>
                <th className="py-1 text-right font-medium">Income</th>
                <th className="py-1 text-right font-medium">Spent</th>
                <th className="py-1 text-right font-medium">Saved</th>
                <th className="py-1 text-right font-medium">Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {series.map((s) => (
                <tr key={s.month}>
                  <td className="py-1.5">{fmtMonthShort(s.month)}</td>
                  <td className="py-1.5 text-right">{formatEUR(s.income)}</td>
                  <td className="py-1.5 text-right">{formatEUR(s.spent)}</td>
                  <td className="py-1.5 text-right">{formatEUR(s.saved)}</td>
                  <td className="py-1.5 text-right">{s.income ? fmtPct(s.saved / s.income) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-3 gap-y-1 px-4 py-1 text-xs text-ink-2" aria-label="Legend">
            {legend.map(({ k, name, i }) => (
              <span key={k} className="flex items-center gap-1">
                <span
                  className="size-2.5 rounded-sm"
                  style={{
                    background: focus
                      ? tint(groupColor(focus, scheme === 'dark'), Math.min(0.7, i * 0.14), scheme === 'dark')
                      : groupColor(k === OTHER_GROUP ? '' : k, scheme === 'dark'),
                  }}
                />
                {name}
              </span>
            ))}
            <span className="flex items-center gap-1">
              <span className="h-0.5 w-3 bg-ink" />
              Income
            </span>
          </div>
          <div className="px-2">
            <EChart
              option={option}
              height={260}
              ariaLabel="Monthly spending by group as stacked columns, with income as a line"
              onClick={(p) => {
                const month = months[p.dataIndex];
                if (!month) return;
                if (p.seriesName === 'Income') {
                  openActivity(navigate, {
                    ...monthRangeFilter(month),
                    kind: 'income',
                    label: `Income · ${fmtMonth(month)}`,
                  });
                  return;
                }
                const k = focus
                  ? keys.find((x) => (m.ds.categories.get(x)?.name ?? x) === p.seriesName)
                  : p.seriesName;
                if (!k) return;
                const f = focus ? { cat: k } : k === OTHER_GROUP ? {} : { group: k };
                openActivity(navigate, {
                  ...monthRangeFilter(month),
                  kind: 'expense',
                  gross: gross || undefined,
                  ...f,
                  label: `${p.seriesName} · ${fmtMonth(month)}`,
                });
              }}
            />
          </div>
          <div className="px-4 pt-2 text-xs font-medium text-ink-2">Savings rate</div>
          <div className="px-2 pb-2">
            <EChart option={rateOption} height={120} ariaLabel="Savings rate per month" />
          </div>
        </>
      )}
    </Card>
  );
}

interface TreeNode {
  name: string;
  value: number;
  path: { group?: string; cat?: string; merchant?: string };
  children?: TreeNode[];
  itemStyle?: { color: string };
  label?: { color: string };
}

function WhereItGoes({
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
  const navigate = useNavigate();
  const data = useMemo<TreeNode[]>(() => {
    const dark = scheme === 'dark';
    const g = new Map<string, Map<string, Map<string, number>>>();
    for (const l of lines) {
      if (l.kind !== 'expense') continue;
      const cats = g.get(l.group) ?? g.set(l.group, new Map()).get(l.group)!;
      const merch =
        cats.get(l.reportCategory) ?? cats.set(l.reportCategory, new Map()).get(l.reportCategory)!;
      const name = l.offset ? 'Itemised cash' : l.eff.merchant;
      merch.set(name, (merch.get(name) ?? 0) - l.amount);
    }
    const nodes: TreeNode[] = [];
    for (const [group, cats] of g) {
      const color = groupColor(group, dark);
      const catNodes: TreeNode[] = [];
      let ci = 0;
      for (const [cat, merch] of cats) {
        const catColor = tint(color, Math.min(0.55, ci++ * 0.12), dark);
        const kids = [...merch.entries()]
          .filter(([, v]) => v > 0)
          .map(([name, v]) => ({
            name,
            value: v / 100,
            path: { group, cat, merchant: name },
            label: { color: onColor(catColor) },
          }));
        const v = kids.reduce((s, k) => s + k.value, 0);
        if (v <= 0) continue;
        catNodes.push({
          name: cat.startsWith('unitemized-')
            ? `Unitemized ${m.ds.accounts.get(cat.slice(11))?.name ?? ''}`
            : (m.ds.categories.get(cat)?.name ?? cat),
          value: v,
          path: { group, cat },
          children: kids,
          itemStyle: { color: catColor },
          label: { color: onColor(catColor) },
        });
      }
      const v = catNodes.reduce((s, k) => s + k.value, 0);
      if (v > 0)
        nodes.push({
          name: group,
          value: v,
          path: { group },
          children: catNodes,
          itemStyle: { color },
          label: { color: onColor(color) },
        });
    }
    return nodes.sort((a, b) => b.value - a.value);
  }, [lines, m, scheme]);

  const option = useMemo<EChartsOption>(() => {
    const th = chartTheme(scheme === 'dark');
    return {
      animation: false,
      tooltip: {
        formatter: (p: { name: string; value: number; treePathInfo?: { name: string }[] }) =>
          `${
            (p.treePathInfo ?? [])
              .slice(1)
              .map((x) => x.name)
              .join(' › ') || p.name
          }<br/><b>${formatEUR(Math.round(p.value * 100))}</b>`,
      },
      series: [
        {
          type: 'treemap',
          name: 'All spending',
          data,
          roam: false,
          leafDepth: 1,
          nodeClick: 'zoomToNode',
          left: 0,
          right: 0,
          top: 0,
          bottom: 30,
          drillDownIcon: '',
          breadcrumb: {
            show: true,
            bottom: 0,
            height: 24,
            itemStyle: {
              color: th.surface,
              borderColor: th.grid,
              textStyle: { color: th.ink2, fontSize: 12 },
            },
            emphasis: { itemStyle: { color: th.grid } },
          },
          label: {
            show: true,
            formatter: (p: { name: string; value: number }) =>
              `${p.name}\n${formatEUR(Math.round(p.value * 100), { compact: true })}`,
            fontSize: 12,
            overflow: 'truncate',
          },
          upperLabel: { show: false },
          itemStyle: { borderColor: th.surface, borderWidth: 2, gapWidth: 2 },
          levels: [
            { itemStyle: { borderWidth: 0, gapWidth: 2 } },
            { itemStyle: { gapWidth: 2 } },
            { itemStyle: { gapWidth: 1 } },
          ],
        },
      ],
    };
  }, [data, scheme]);

  const total = data.reduce((s, g) => s + g.value, 0) || 1;
  return (
    <Card>
      <CardTitle>Where it goes</CardTitle>
      {data.length === 0 ? (
        <Empty>No spending in this period.</Empty>
      ) : (
        <div className="px-2 pb-2">
          <EChart
            option={option}
            height={300}
            ariaLabel="Spending by group, then category, then merchant. Tap a block to zoom in."
            onClick={(p) => {
              const node = p.data as TreeNode | undefined;
              if (!node?.path?.merchant) return;
              const { group, cat, merchant } = node.path;
              openActivity(navigate, {
                from: period.from,
                to: period.to,
                kind: 'expense',
                group,
                cat,
                merchant: merchant === 'Itemised cash' ? undefined : merchant,
                gross: gross || undefined,
                label: `${merchant} · ${period.label}`,
              });
            }}
          />
          <p className="px-2 text-xs text-ink-3">
            Tap a block to zoom in; tap a merchant to see its transactions.
          </p>
          <ul className="mt-2 divide-y divide-line" aria-label="Spending by group">
            {data.map((g) => (
              <li key={g.name}>
                <Link
                  {...activityHref({
                    from: period.from,
                    to: period.to,
                    kind: 'expense',
                    group: g.name,
                    gross: gross || undefined,
                    label: `${g.name} · ${period.label}`,
                  })}
                  className="flex min-h-11 items-center gap-3 px-2 py-1.5 text-sm hover:bg-surface-2"
                >
                  <span className="size-2.5 shrink-0 rounded-sm" style={{ background: g.itemStyle?.color }} />
                  <span className="flex-1">{g.name}</span>
                  <span className="num text-ink-2">{fmtPct(g.value / total)}</span>
                  <span className="num w-24 text-right font-medium">
                    {formatEUR(Math.round(g.value * 100))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function Merchants({ m, period, lines, gross }: { m: Model; period: Period; lines: Line[]; gross: boolean }) {
  const [by, setBy] = useState<'total' | 'count'>('total');
  const stats = useMemo(() => {
    const s = merchantStats(lines, period.from, period.to).filter((x) => x.spent > 0);
    return s
      .sort((a, b) => (by === 'total' ? b.spent - a.spent : b.count - a.count || b.spent - a.spent))
      .slice(0, 12);
  }, [lines, period, by]);
  void m;
  return (
    <Card>
      <CardTitle
        action={
          <div className="flex gap-1">
            <Chip active={by === 'total'} onClick={() => setBy('total')}>
              Total
            </Chip>
            <Chip active={by === 'count'} onClick={() => setBy('count')}>
              Visits
            </Chip>
          </div>
        }
      >
        Merchants
      </CardTitle>
      {stats.length === 0 && <Empty>No spending in this period.</Empty>}
      <ol className="divide-y divide-line pb-1">
        {stats.map((s) => (
          <li key={s.merchant}>
            <Link
              {...activityHref({
                from: period.from,
                to: period.to,
                merchant: s.merchant,
                kind: 'expense',
                gross: gross || undefined,
                label: `${s.merchant} · ${period.label}`,
              })}
              className="flex min-h-12 items-center gap-3 px-4 py-2 hover:bg-surface-2"
            >
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: groupColor(s.group) }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{s.merchant}</span>
                <span className="block text-xs text-ink-3">
                  {s.count} {s.count === 1 ? 'visit' : 'visits'} · {s.perMonth.toFixed(1).replace('.', ',')}
                  /month
                </span>
              </span>
              <span className="num text-sm font-medium">{formatEUR(s.spent)}</span>
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}
