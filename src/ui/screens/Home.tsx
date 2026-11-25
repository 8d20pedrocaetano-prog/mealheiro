import { ChevronLeft, ChevronRight, CircleAlert, Inbox, Plane, Upload } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { totalsOf } from '../../core/aggregates';
import { budgetLines, budgetStatuses } from '../../core/budgets';
import { addMonths, daysInMonth, monthOf } from '../../core/dates';
import { accountBalance, netWorth } from '../../core/goals';
import { cumulativeByDay, daysSince, totalsBy } from '../../core/insights';
import type { Model } from '../../core/model';
import { isTrue } from '../../core/schema';
import { useModel } from '../../state/store';
import { EChart, type EChartsOption } from '../charts/EChart';
import { useColorScheme } from '../charts/useColorScheme';
import { Sheet } from '../components/Sheet';
import { TxnDetail } from '../components/TxnDetail';
import { BudgetBar } from '../components/BudgetBar';
import { badgeCount } from '../lib/review';
import { QuickAddFab } from '../components/QuickAdd';
import { TxnRow } from '../components/TxnRow';
import { Card, CardTitle, Empty } from '../components/ui';
import { activityHref, monthRangeFilter, openActivity, type ActivityLink } from '../lib/filter';
import { fmtDate, fmtDay, fmtMonth, fmtPct, formatEUR, formatEURShort, plural } from '../lib/format';
import { CategoryIcon } from '../lib/icons';
import { chartTheme, groupColor, tint } from '../lib/palette';
import type { Txn } from '../../core/dataset';

function Kpi({
  label,
  value,
  sub,
  to,
  state,
  onClick,
  tone,
  testId,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  to?: string;
  state?: ActivityLink['state'];
  onClick?: () => void;
  tone?: 'good' | 'bad';
  testId?: string;
}) {
  const body = (
    <>
      <div className="text-sm text-ink-2">{label}</div>
      <div
        className={`num mt-0.5 text-[22px] leading-tight font-semibold ${tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-bad' : ''}`}
        data-testid={testId}
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-ink-3">{sub}</div>}
    </>
  );
  const cls = 'block rounded-2xl border border-line bg-surface p-4 text-left hover:border-ink-3';
  if (to)
    return (
      <Link to={to} state={state} className={cls}>
        {body}
      </Link>
    );
  return (
    <button type="button" onClick={onClick} className={cls}>
      {body}
    </button>
  );
}

export function Home() {
  const m = useModel();
  const currentMonth = monthOf(m.today);
  const [month, setMonth] = useState(currentMonth);
  const [selected, setSelected] = useState<Txn | null>(null);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const navigate = useNavigate();
  const touch = useRef<{ x: number; y: number } | null>(null);

  const t = totalsOf(month, m.summary[month]);
  const range = monthRangeFilter(month);
  const statuses = useMemo(() => budgetStatuses(m.view, m.lines, month, m.today), [m, month]);
  const total = statuses.find((s) => s.row.scope === 'total');
  const mainAccount = [...m.ds.accounts.values()].find((a) => isTrue(a.tracked) && a.type === 'current');
  const balance = mainAccount ? accountBalance(m.ds, mainAccount.id) : null;
  const nw = useMemo(() => netWorth(m.ds), [m]);
  const minMonth = m.months[0] ?? currentMonth;

  const go = (delta: number) => {
    const next = addMonths(month, delta);
    if (next > currentMonth || next < minMonth) return;
    setMonth(next);
  };

  let paceText: ReactNode = null;
  if (total) {
    const label =
      total.state === 'over'
        ? 'Over budget'
        : total.state === 'over-pace'
          ? 'Over pace'
          : total.state === 'projected-over'
            ? 'Projected over'
            : month === currentMonth
              ? 'On pace'
              : 'Within budget';
    paceText = (
      <span
        className={total.state === 'over' ? 'text-bad' : total.state === 'ok' ? 'text-good' : 'text-warn'}
      >
        {label}
      </span>
    );
  }

  return (
    <div
      className="flex flex-col gap-4"
      onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
      onTouchEnd={(e) => {
        const s = touch.current;
        touch.current = null;
        if (!s) return;
        const dx = e.changedTouches[0].clientX - s.x;
        const dy = e.changedTouches[0].clientY - s.y;
        if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) go(dx < 0 ? 1 : -1);
      }}
    >
      <div className="flex items-center justify-between">
        <button
          className="flex size-11 items-center justify-center rounded-full text-ink-2 disabled:opacity-30"
          onClick={() => go(-1)}
          disabled={month <= minMonth}
          aria-label="Previous month"
        >
          <ChevronLeft size={22} />
        </button>
        <h1 className="text-lg font-semibold" data-testid="home-month">
          {fmtMonth(month)}
        </h1>
        <button
          className="flex size-11 items-center justify-center rounded-full text-ink-2 disabled:opacity-30"
          onClick={() => go(1)}
          disabled={month >= currentMonth}
          aria-label="Next month"
        >
          <ChevronRight size={22} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Link
          {...activityHref({ ...range, kind: 'expense', label: `Spent · ${fmtMonth(month)}` })}
          className="col-span-2 block rounded-2xl border border-line bg-surface p-4 hover:border-ink-3"
        >
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-ink-2">Spent</span>
            <span className="text-xs">{paceText}</span>
          </div>
          <div className="num mt-0.5 text-3xl font-semibold" data-testid="kpi-spent">
            {formatEUR(t.spent)}
          </div>
          {total && (
            <div className="mt-2">
              <BudgetBar
                spent={total.spent}
                limit={total.limit}
                pace={month === currentMonth ? total.pace : null}
              />
              <div className="num mt-1 flex justify-between text-xs text-ink-3">
                <span>
                  {formatEUR(total.spent, { compact: true })} of {formatEUR(total.limit, { compact: true })}{' '}
                  budget
                  {isTrue(total.row.exclude_events) ? ' (trips excluded)' : ''}
                </span>
                <span>{total.left >= 0 ? `${formatEUR(total.left, { compact: true })} left` : 'over'}</span>
              </div>
            </div>
          )}
        </Link>
        <Kpi
          label="Income"
          value={formatEUR(t.income)}
          {...activityHref({ ...range, kind: 'income', label: `Income · ${fmtMonth(month)}` })}
          testId="kpi-income"
        />
        <Kpi
          label="Saved"
          value={formatEUR(t.saved)}
          sub={t.savingsRate === null ? 'No income' : `${fmtPct(t.savingsRate)} of income`}
          tone={t.saved < 0 ? 'bad' : undefined}
          {...activityHref({
            ...range,
            kind: 'reporting',
            label: `Income and spending · ${fmtMonth(month)}`,
          })}
          testId="kpi-saved"
        />
        <Kpi
          label={`Balance${mainAccount ? ` · ${mainAccount.institution.includes('Caixa') ? 'CGD' : mainAccount.name}` : ''}`}
          value={balance ? formatEUR(balance.balance) : '—'}
          sub={balance ? `on ${fmtDate(balance.asOf)}` : 'Unknown'}
          to={mainAccount ? activityHref({ acct: mainAccount.id }).to : undefined}
          onClick={() => setAccountsOpen(true)}
          testId="kpi-balance"
        />
        <Kpi
          label="Net worth"
          value={formatEUR(nw.total)}
          sub={nw.unknown.length ? `${plural(nw.unknown.length, 'account')} unknown` : 'All accounts'}
          onClick={() => setAccountsOpen(true)}
          testId="kpi-networth"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <PaceCard m={m} month={month} />
        <TopCategories m={m} month={month} />
        <NeedsAttention m={m} month={month} statuses={statuses} />
        <Card>
          <CardTitle
            action={
              <Link to="/activity" className="text-sm text-accent">
                All
              </Link>
            }
          >
            Latest
          </CardTitle>
          <div className="divide-y divide-line pb-1">
            {[...m.ds.txns]
              .slice(-5)
              .reverse()
              .map((tx) => (
                <TxnRow key={tx.id} t={tx} onOpen={setSelected} />
              ))}
          </div>
        </Card>
      </div>

      <TxnDetail t={selected} onClose={() => setSelected(null)} />
      <QuickAddFab />
      <AccountsSheet
        open={accountsOpen}
        onOpenChange={setAccountsOpen}
        onPick={(id) => openActivity(navigate, { acct: id })}
      />
    </div>
  );
}

function PaceCard({ m, month }: { m: Model; month: string }) {
  const scheme = useColorScheme();
  const option = useMemo<EChartsOption>(() => {
    const th = chartTheme(scheme === 'dark');
    const statuses = budgetStatuses(m.view, m.lines, month, m.today);
    const total = statuses.find((s) => s.row.scope === 'total');
    const dim = daysInMonth(month);
    const lines = total ? budgetLines(m.view, m.lines, total.row, month) : m.lines;
    const cum = cumulativeByDay(lines, month);
    const isCurrent = month === monthOf(m.today);
    const day = isCurrent ? Number(m.today.slice(8, 10)) : dim;
    let limit: number;
    let paceName: string;
    if (total) {
      limit = total.limit;
      paceName = 'Budget pace';
    } else {
      const prev = [1, 2, 3].map((i) => addMonths(month, -i));
      limit = Math.round(prev.reduce((s, p) => s + totalsOf(p, m.summary[p]).spent, 0) / 3);
      paceName = '3-month average pace';
    }
    const days = Array.from({ length: dim }, (_, i) => i + 1);
    const actual = cum.map((v, i) => (i < day ? v / 100 : null));
    const pace = days.map((d) => Math.round((limit * d) / dim) / 100);
    const projected =
      isCurrent && day < dim
        ? days.map((d) => (d < day ? null : Math.round(((cum[day - 1] ?? 0) / day) * d) / 100))
        : [];
    return {
      animation: false,
      grid: { left: 8, right: 12, top: 28, bottom: 4, containLabel: true },
      legend: { top: 0, left: 0, itemWidth: 14, itemHeight: 2, textStyle: { color: th.ink2, fontSize: 11 } },
      tooltip: {
        trigger: 'axis',
        valueFormatter: (v: unknown) => (typeof v === 'number' ? formatEUR(Math.round(v * 100)) : '—'),
      },
      xAxis: {
        type: 'category',
        data: days,
        axisLine: { lineStyle: { color: th.grid } },
        axisTick: { show: false },
        axisLabel: { color: th.ink3, interval: 6 },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: th.grid } },
        axisLabel: { color: th.ink3, formatter: (v: number) => formatEURShort(v * 100) },
      },
      series: [
        {
          name: 'Spent',
          type: 'line',
          data: actual,
          showSymbol: false,
          lineStyle: { width: 2, color: th.accent },
          itemStyle: { color: th.accent },
          z: 3,
        },
        {
          name: paceName,
          type: 'line',
          data: pace,
          showSymbol: false,
          lineStyle: { width: 1.5, color: th.ink3 },
          itemStyle: { color: th.ink3 },
        },
        ...(projected.length
          ? [
              {
                name: 'Projection',
                type: 'line',
                data: projected,
                showSymbol: false,
                lineStyle: { width: 2, type: 'dashed', color: th.accent },
                itemStyle: { color: th.accent },
              },
            ]
          : []),
      ],
    };
  }, [m, month, scheme]);
  return (
    <Card>
      <CardTitle>Budget pace</CardTitle>
      <div className="px-2 pb-2">
        <EChart
          option={option}
          height={200}
          ariaLabel="Cumulative spending this month against a straight-line budget pace"
        />
      </div>
    </Card>
  );
}

function TopCategories({ m, month }: { m: Model; month: string }) {
  const top = useMemo(() => totalsBy(m.lines, month, (l) => l.reportCategory).slice(0, 5), [m, month]);
  const range = monthRangeFilter(month);
  const max = Math.max(1, ...top.map((c) => c.spent));
  return (
    <Card>
      <CardTitle>Top categories</CardTitle>
      {top.length === 0 && <Empty>No spending this month.</Empty>}
      <ul className="flex flex-col pb-2">
        {top.map((c) => {
          const cat = m.ds.categories.get(c.key);
          const group = c.lines[0]?.group ?? '';
          const color = groupColor(group);
          const name = c.key.startsWith('unitemized-')
            ? `Unitemized · ${m.ds.accounts.get(c.key.slice(11))?.name ?? c.key.slice(11)}`
            : (cat?.name ?? c.key);
          const delta = c.spent - c.avg3;
          return (
            <li key={c.key}>
              <Link
                {...activityHref({
                  ...range,
                  kind: 'expense',
                  cat: c.key,
                  label: `${name} · ${fmtMonth(month)}`,
                })}
                className="flex min-h-12 items-center gap-3 px-4 py-1.5 hover:bg-surface-2"
              >
                <span
                  className="flex size-8 shrink-0 items-center justify-center rounded-full"
                  style={{ background: tint(color, 0.8), color }}
                >
                  <CategoryIcon
                    name={c.key.startsWith('unitemized-') ? 'banknote' : (cat?.icon ?? 'tag')}
                    size={16}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex justify-between gap-2 text-sm">
                    <span className="truncate font-medium">{name}</span>
                    <span className="num font-medium">{formatEUR(c.spent)}</span>
                  </span>
                  <span className="mt-1 flex items-center gap-2">
                    <span className="h-1.5 flex-1 rounded-full bg-surface-2">
                      <span
                        className="block h-1.5 rounded-full"
                        style={{ width: `${(c.spent / max) * 100}%`, background: color }}
                      />
                    </span>
                    <span className={`num w-28 text-right text-xs ${delta > 0 ? 'text-warn' : 'text-ink-3'}`}>
                      {c.avg3 === 0 ? 'new' : `${formatEUR(delta, { plus: true, compact: true })} vs avg`}
                    </span>
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function NeedsAttention({
  m,
  month,
  statuses,
}: {
  m: Model;
  month: string;
  statuses: ReturnType<typeof budgetStatuses>;
}) {
  const review = badgeCount(m);
  const lastImport = m.ds.imports
    .map((i) => i.imported_at.slice(0, 10))
    .sort()
    .pop();
  const staleDays = lastImport ? daysSince(lastImport, m.today) : null;
  const hot = statuses.filter((s) => s.row.scope !== 'total' && s.limit > 0 && s.spent >= 0.9 * s.limit);
  const items: { icon: ReactNode; text: ReactNode; link: { to: string; state: unknown } }[] = [];
  if (review > 0)
    items.push({
      icon: <Inbox size={18} />,
      text: `${plural(review, 'item')} to review`,
      link: { to: '/more/review', state: null },
    });
  for (const p of m.proposals)
    items.push({
      icon: <Plane size={18} />,
      text: `Proposed trip: ${p.name} (${fmtDay(p.start)}–${fmtDay(p.end)})`,
      link: { to: '/more/events', state: { proposal: p.candidate.start } },
    });
  for (const s of hot) {
    const name =
      s.row.scope === 'category'
        ? (m.ds.categories.get(s.row.target)?.name ??
          (s.row.target.startsWith('unitemized-') ? `Unitemized ${s.row.target.slice(11)}` : s.row.target))
        : s.row.target;
    items.push({
      icon: <CircleAlert size={18} className={s.spent > s.limit ? 'text-bad' : 'text-warn'} />,
      text: `${name}: ${fmtPct(s.spent / s.limit)} of budget`,
      link: activityHref({
        ...monthRangeFilter(month),
        kind: 'expense',
        ...(s.row.scope === 'category' ? { cat: s.row.target } : { group: s.row.target }),
        label: `${name} · ${fmtMonth(month)}`,
      }),
    });
  }
  if (staleDays === null || staleDays >= 20)
    items.push({
      icon: <Upload size={18} />,
      text: staleDays === null ? 'No imports yet' : `No import for ${staleDays} days`,
      link: { to: '/more/import', state: null },
    });
  return (
    <Card>
      <CardTitle>Needs attention</CardTitle>
      {items.length === 0 && <Empty>All clear.</Empty>}
      <ul className="pb-2">
        {items.map((it, i) => (
          <li key={i}>
            <Link
              {...it.link}
              className="flex min-h-11 items-center gap-3 px-4 py-2 text-sm hover:bg-surface-2"
            >
              <span className="text-ink-2">{it.icon}</span>
              <span className="flex-1">{it.text}</span>
              <ChevronRight size={16} className="text-ink-3" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function AccountsSheet({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPick: (id: string) => void;
}) {
  const m = useModel();
  const nw = netWorth(m.ds);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Accounts"
      description={`Net worth ${formatEUR(nw.total)}`}
    >
      <ul className="divide-y divide-line">
        {[...m.ds.accounts.values()].map((a) => {
          const b = accountBalance(m.ds, a.id);
          return (
            <li key={a.id}>
              <button
                className="flex min-h-14 w-full items-center gap-3 py-2 text-left"
                onClick={() => onPick(a.id)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{a.name}</span>
                  <span className="block text-xs text-ink-3">
                    {isTrue(a.tracked) ? 'Tracked' : 'Not tracked: money sent here counts as spent'}
                    {b ? ` · ${b.source === 'import' ? 'from import' : 'snapshot'} ${fmtDate(b.asOf)}` : ''}
                  </span>
                </span>
                <span className="num font-medium">{b ? formatEUR(b.balance) : '—'}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {nw.unknown.length > 0 && (
        <p className="mt-2 text-xs text-ink-3">Accounts without a balance are left out of net worth.</p>
      )}
    </Sheet>
  );
}
