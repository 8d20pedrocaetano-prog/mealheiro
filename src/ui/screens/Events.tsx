import { CalendarRange, ChevronRight, Plane, Plus, Tag, TrendingUp } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { Txn } from '../../core/dataset';
import { addDays, addMonths, daysBetween, monthOf } from '../../core/dates';
import { defaultTicks, membersSpend, stageAverages, tripSummary } from '../../core/eventStats';
import { eventMembers } from '../../core/events';
import type { Model } from '../../core/model';
import { orphanProposedEvents, NON_TRIP_CATEGORIES } from '../../core/trips';
import type { EventRow } from '../../core/schema';
import { effOf } from '../../core/view';
import { confirmTrip, deleteEvent, dismissTrip, saveEvent, type EventDraft } from '../../state/edits';
import { useApp, useModel } from '../../state/store';
import { BudgetBar } from '../components/BudgetBar';
import { DataTable, ViewToggle } from '../components/DataTable';
import { Sheet } from '../components/Sheet';
import { TxnDetail } from '../components/TxnDetail';
import { TxnRow } from '../components/TxnRow';
import { Button, Card, CardTitle, Empty, Field, Segmented, inputCls } from '../components/ui';
import { EChart, type EChartsOption } from '../charts/EChart';
import { useColorScheme } from '../charts/useColorScheme';
import { categoryName } from '../lib/categories';
import { activityHref } from '../lib/filter';
import { fmtDate, fmtDay, formatEUR, formatEURShort, plural } from '../lib/format';
import { chartTheme, groupColor } from '../lib/palette';

/* ───────────── Proposals ───────────── */

interface Proposal {
  key: string;
  event: EventRow | null;
  name: string;
  start: string;
  end: string;
  members: string[];
  ticked: Set<string>;
  preTrip: string[];
  source: string;
}

function proposalsOf(m: Model): Proposal[] {
  const out: Proposal[] = m.proposals.map((p) => ({
    key: p.candidate.start,
    event: p.event,
    name: p.name,
    start: p.start,
    end: p.end,
    members: p.candidate.members,
    ticked: defaultTicks(p.candidate.members, p.candidate.unticked),
    preTrip: p.candidate.pre_trip_suggestions,
    source: p.event?.source || 'detector',
  }));
  for (const e of orphanProposedEvents(m.trips, m.ds.events)) {
    const members = outflowsIn(m, e.start_date, e.end_date || e.start_date).map((t) => t.id);
    out.push({
      key: e.id,
      event: e,
      name: e.name,
      start: e.start_date,
      end: e.end_date || e.start_date,
      members,
      ticked: new Set(members),
      preTrip: [],
      source: e.source || 'claude',
    });
  }
  return out.sort((a, b) => (a.start < b.start ? 1 : -1));
}

function outflowsIn(m: Model, start: string, end: string): Txn[] {
  return m.ds.txns.filter(
    (t) =>
      t.amount < 0 &&
      t.value_date >= start &&
      t.value_date <= end &&
      !NON_TRIP_CATEGORIES.has(effOf(m.view, t).categoryId),
  );
}

function TickRow({ t, checked, onChange }: { t: Txn; checked: boolean; onChange: (v: boolean) => void }) {
  const m = useModel();
  const e = effOf(m.view, t);
  return (
    <label className="flex min-h-12 items-center gap-3 border-b border-line py-1.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(ev) => onChange(ev.target.checked)}
        className="size-5 shrink-0 accent-[var(--accent)]"
      />
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm ${checked ? '' : 'text-ink-3'}`}>{e.merchant}</span>
        <span className="block text-xs text-ink-3">
          {fmtDay(t.value_date)} · {categoryName(m, e.reportCategory)}
        </span>
      </span>
      <span className={`num shrink-0 text-sm ${checked ? '' : 'text-ink-3 line-through'}`}>
        {formatEUR(t.amount)}
      </span>
    </label>
  );
}

function ProposalSheet({ p, onDone }: { p: Proposal; onDone: () => void }) {
  const m = useModel();
  const commit = useApp((s) => s.commit);
  const [name, setName] = useState(p.name);
  const [start, setStart] = useState(p.start);
  const [end, setEnd] = useState(p.end);
  const [type, setType] = useState<'trip' | 'work-trip'>(
    p.event?.type === 'work-trip' ? 'work-trip' : 'trip',
  );
  const [budget, setBudget] = useState('');
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(p.ticked));
  const preSet = new Set(p.preTrip);
  const list = useMemo(() => {
    const ids = new Set([...p.members, ...outflowsIn(m, start, end).map((t) => t.id)]);
    return [...ids]
      .map((id) => m.ds.byId.get(id))
      .filter((t): t is Txn => !!t && !preSet.has(t.id))
      .sort((a, b) => (a.value_date < b.value_date ? -1 : 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m, start, end]);
  const pre = p.preTrip.map((id) => m.ds.byId.get(id)).filter((t): t is Txn => !!t);
  const { total } = membersSpend(m, ticked);
  const toggle = (id: string, v: boolean) =>
    setTicked((s) => {
      const n = new Set(s);
      if (v) n.add(id);
      else n.delete(id);
      return n;
    });
  const draft: EventDraft = { id: p.event?.id, name, type, start, end, budget };
  const days = daysBetween(start, end) + 1;

  return (
    <div className="flex flex-col gap-3">
      <Field label="Name">
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="From">
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} />
        </Field>
        <Field label="To">
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={inputCls} />
        </Field>
      </div>
      <Segmented
        label="Type"
        value={type}
        onChange={setType}
        options={[
          { value: 'trip', label: 'Trip' },
          { value: 'work-trip', label: 'Work trip' },
        ]}
      />
      <Field label="Budget (optional, €)">
        <input
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
          inputMode="decimal"
          className={inputCls}
        />
      </Field>
      <div className="rounded-xl bg-surface-2 p-3 text-sm" data-testid="proposal-total">
        <b className="num">{formatEUR(total)}</b> over {plural(days, 'day')} ·{' '}
        {plural(ticked.size, 'transaction')}
      </div>
      <div>
        <h3 className="text-sm font-semibold text-ink-2">During the trip</h3>
        {list.map((t) => (
          <TickRow key={t.id} t={t} checked={ticked.has(t.id)} onChange={(v) => toggle(t.id, v)} />
        ))}
      </div>
      {pre.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-ink-2">Booked before (pre-trip)</h3>
          {pre.map((t) => (
            <TickRow key={t.id} t={t} checked={ticked.has(t.id)} onChange={(v) => toggle(t.id, v)} />
          ))}
        </div>
      )}
      <div className="sticky bottom-0 flex gap-2 bg-surface pt-2">
        <Button
          variant="danger"
          onClick={async () => {
            await commit(dismissTrip(m, draft));
            onDone();
          }}
        >
          Dismiss
        </Button>
        <Button
          variant="primary"
          className="flex-1"
          disabled={!name.trim() || end < start}
          onClick={async () => {
            await commit(confirmTrip(m, draft, ticked));
            onDone();
          }}
        >
          Confirm trip
        </Button>
      </div>
    </div>
  );
}

/* ───────────── Event editor ───────────── */

function EventEditor({ e, onDone }: { e: EventRow | null; onDone: (id?: string) => void }) {
  const m = useModel();
  const commit = useApp((s) => s.commit);
  const [d, setD] = useState<EventDraft>({
    id: e?.id,
    name: e?.name ?? '',
    type: (e?.type as EventDraft['type']) ?? 'trip',
    start: e?.start_date ?? m.today,
    end: e?.end_date ?? '',
    budget: e?.budget ?? '',
  });
  const set = (p: Partial<EventDraft>) => setD((x) => ({ ...x, ...p }));
  const openEnded = d.type === 'stage' || d.type === 'tag';
  return (
    <div className="flex flex-col gap-3">
      <Field label="Name">
        <input value={d.name} onChange={(ev) => set({ name: ev.target.value })} className={inputCls} />
      </Field>
      <Segmented
        label="Type"
        value={d.type}
        onChange={(type) => set({ type })}
        options={[
          { value: 'trip', label: 'Trip' },
          { value: 'work-trip', label: 'Work trip' },
          { value: 'stage', label: 'Stage' },
          { value: 'tag', label: 'Tag' },
        ]}
      />
      <p className="text-xs text-ink-3">
        {d.type === 'stage'
          ? 'A stage is a period of life ("new job"): every transaction in its dates belongs to it. Leave the end empty while it lasts.'
          : d.type === 'tag'
            ? 'A tag is a label you add to transactions from their detail sheet.'
            : 'Add transactions from their detail sheet, or confirm a proposed trip.'}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="From">
          <input
            type="date"
            value={d.start}
            onChange={(ev) => set({ start: ev.target.value })}
            className={inputCls}
          />
        </Field>
        <Field label={openEnded ? 'To (optional)' : 'To'}>
          <input
            type="date"
            value={d.end}
            onChange={(ev) => set({ end: ev.target.value })}
            className={inputCls}
          />
        </Field>
      </div>
      {(d.type === 'trip' || d.type === 'work-trip') && (
        <Field label="Budget (optional, €)">
          <input
            value={d.budget}
            onChange={(ev) => set({ budget: ev.target.value })}
            inputMode="decimal"
            className={inputCls}
          />
        </Field>
      )}
      <div className="flex gap-2">
        {e && (
          <Button
            variant="danger"
            onClick={async () => {
              await commit(deleteEvent(m, e.id));
              onDone();
            }}
          >
            Delete
          </Button>
        )}
        <Button
          variant="primary"
          className="flex-1"
          disabled={!d.name.trim() || !d.start || (!openEnded && !d.end) || (!!d.end && d.end < d.start)}
          onClick={async () => {
            const ops = saveEvent(m, d);
            await commit(ops);
            onDone(ops[0].key.id);
          }}
        >
          {e ? 'Save' : 'Add event'}
        </Button>
      </div>
    </div>
  );
}

/* ───────────── List ───────────── */

const TYPE_ICON: Record<string, ReactNode> = {
  trip: <Plane size={18} />,
  'work-trip': <Plane size={18} />,
  stage: <TrendingUp size={18} />,
  tag: <Tag size={18} />,
};

export function Events() {
  const m = useModel();
  const navigate = useNavigate();
  const location = useLocation();
  const proposals = useMemo(() => proposalsOf(m), [m]);
  const wanted = (location.state as { proposal?: string } | null)?.proposal;
  const [open, setOpen] = useState<string | null>(() =>
    wanted && proposals.some((p) => p.key === wanted) ? wanted : null,
  );
  const [adding, setAdding] = useState(false);
  const current = proposals.find((p) => p.key === open) ?? null;
  const events = m.ds.events
    .filter((e) => e.status === 'confirmed')
    .sort((a, b) => (a.start_date < b.start_date ? 1 : -1));

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Events</h1>
        <Button variant="ghost" onClick={() => setAdding(true)}>
          <Plus size={18} /> Add
        </Button>
      </div>

      {proposals.length > 0 && (
        <Card>
          <CardTitle>Proposed trips</CardTitle>
          <ul className="divide-y divide-line pb-1">
            {proposals.map((p) => {
              const { total } = membersSpend(m, p.ticked);
              return (
                <li key={p.key}>
                  <button
                    type="button"
                    onClick={() => setOpen(p.key)}
                    className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left hover:bg-surface-2"
                  >
                    <span className="text-accent">
                      <Plane size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{p.name}</span>
                      <span className="block text-xs text-ink-3">
                        {fmtDate(p.start)}–{fmtDate(p.end)} · {plural(daysBetween(p.start, p.end) + 1, 'day')}{' '}
                        · {p.source}
                      </span>
                    </span>
                    <span className="num shrink-0 text-sm">{formatEUR(total)}</span>
                    <ChevronRight size={16} className="text-ink-3" />
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card>
        <CardTitle>Your events</CardTitle>
        {events.length === 0 && (
          <Empty>
            No events yet. Trips appear here on their own: after an import, Mealheiro proposes one when it
            sees days of spending away from home. Use Add for a trip, a life stage or a tag of your own.
          </Empty>
        )}
        <ul className="divide-y divide-line pb-1">
          {events.map((e) => (
            <li key={e.id}>
              <Link
                to={`/more/events/${encodeURIComponent(e.id)}`}
                className="flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-surface-2"
              >
                <span style={{ color: e.color || 'var(--ink-2)' }}>
                  {TYPE_ICON[e.type] ?? <CalendarRange size={18} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{e.name}</span>
                  <span className="block text-xs text-ink-3">
                    {e.type} · {fmtDate(e.start_date)}
                    {e.end_date ? `–${fmtDate(e.end_date)}` : ' onwards'}
                  </span>
                </span>
                <ChevronRight size={16} className="text-ink-3" />
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      <Sheet
        open={!!current}
        onOpenChange={(o) => !o && setOpen(null)}
        title="Proposed trip"
        description={current ? `${fmtDate(current.start)}–${fmtDate(current.end)}` : undefined}
      >
        {current && <ProposalSheet key={current.key} p={current} onDone={() => setOpen(null)} />}
      </Sheet>
      <Sheet open={adding} onOpenChange={setAdding} title="New event">
        {adding && (
          <EventEditor
            e={null}
            onDone={(id) => {
              setAdding(false);
              if (id) navigate(`/more/events/${encodeURIComponent(id)}`);
            }}
          />
        )}
      </Sheet>
    </div>
  );
}

/* ───────────── Event page ───────────── */

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-3">
      <div className="text-xs text-ink-2">{label}</div>
      <div className="num text-lg font-semibold">{value}</div>
      {sub && <div className="text-xs text-ink-3">{sub}</div>}
    </div>
  );
}

export function EventPage() {
  const m = useModel();
  const { id = '' } = useParams();
  const e = m.ds.events.find((x) => x.id === id);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Txn | null>(null);
  if (!e)
    return (
      <Card className="p-6 text-center">
        <p>This event no longer exists.</p>
        <Link to="/more/events" className="text-accent">
          Back to events
        </Link>
      </Card>
    );
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link to="/more/events" className="text-sm text-accent">
            Events
          </Link>
          <h1 className="truncate text-xl font-semibold">{e.name}</h1>
          <p className="text-sm text-ink-2">
            {e.type} · {fmtDate(e.start_date)}
            {e.end_date ? `–${fmtDate(e.end_date)}` : ' onwards'}
            {e.status !== 'confirmed' ? ` · ${e.status}` : ''}
          </p>
        </div>
        <Button onClick={() => setEditing(true)}>Edit</Button>
      </div>
      {e.type === 'stage' ? <StageBody e={e} /> : <TripBody e={e} onOpen={setSelected} />}
      <Sheet open={editing} onOpenChange={setEditing} title={`Edit ${e.name}`}>
        {editing && <EventEditor e={e} onDone={() => setEditing(false)} />}
      </Sheet>
      <TxnDetail t={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function TripBody({ e, onOpen }: { e: EventRow; onOpen: (t: Txn) => void }) {
  const m = useModel();
  const scheme = useColorScheme();
  const [byDayTable, setByDayTable] = useState(false);
  const s = useMemo(() => tripSummary(m, e), [m, e]);
  const members = useMemo(
    () => eventMembers(m.view, e, m.today).sort((a, b) => (a.value_date < b.value_date ? 1 : -1)),
    [m, e],
  );
  const option = useMemo<EChartsOption>(() => {
    const th = chartTheme(scheme === 'dark');
    const color = groupColor('Travel', scheme === 'dark');
    return {
      animation: false,
      grid: { left: 8, right: 8, top: 16, bottom: 4, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        valueFormatter: (v: unknown) => (typeof v === 'number' ? formatEUR(Math.round(v * 100)) : '—'),
      },
      xAxis: {
        type: 'category',
        data: s.byDay.map((_, i) => fmtDay(addDays(e.start_date, i))),
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
          type: 'bar',
          name: 'Spent',
          data: s.byDay.map((c) => c / 100),
          itemStyle: { color, borderRadius: [4, 4, 0, 0] },
          barMaxWidth: 28,
        },
      ],
    };
  }, [s, e, scheme]);

  if (e.type === 'tag')
    return (
      <>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Spent" value={formatEUR(s.total)} />
          <Stat label="Transactions" value={members.length} />
        </div>
        <TxnList txns={members} onOpen={onOpen} />
      </>
    );

  return (
    <>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="Spent" value={formatEUR(s.total)} sub={plural(members.length, 'transaction')} />
        <Stat label="Per day" value={formatEUR(s.perDay)} sub={plural(s.days, 'day')} />
        <Stat label="Pre-trip" value={formatEUR(s.preTrip)} sub="booked before" />
        <Stat label="FX fees" value={formatEUR(s.fxFees)} sub={`Unitemized ${formatEUR(s.unitemized)}`} />
      </div>
      {s.budget !== null && s.budget > 0 && (
        <Card className="p-4">
          <div className="mb-2 flex justify-between text-sm">
            <span>Budget</span>
            <span className="num">
              {formatEUR(s.total)} of {formatEUR(s.budget)}
            </span>
          </div>
          <BudgetBar spent={s.total} limit={s.budget} pace={null} />
        </Card>
      )}
      <Card>
        <CardTitle
          action={<ViewToggle table={byDayTable} onChange={setByDayTable} what="spending per day" />}
        >
          By day
        </CardTitle>
        {byDayTable ? (
          <DataTable
            caption={`Spending per day of ${e.name}`}
            testId="trip-day-table"
            columns={[{ label: 'Day' }, { label: 'Spent', num: true }]}
            rows={s.byDay.map((c, i) => [fmtDay(addDays(e.start_date, i)), formatEUR(c)])}
            footer={['Total', formatEUR(s.byDay.reduce((a, c) => a + c, 0))]}
          />
        ) : (
          <EChart option={option} height={200} ariaLabel="Spending per day of the trip" />
        )}
      </Card>
      <Card>
        <CardTitle
          action={
            <Link
              {...activityHref({ event: e.id, kind: 'expense', label: e.name })}
              className="text-sm text-accent"
            >
              See all
            </Link>
          }
        >
          By category
        </CardTitle>
        <ul className="divide-y divide-line pb-1">
          {s.byCategory.map((c) => (
            <li key={c.key} className="flex min-h-11 items-center justify-between px-4 text-sm">
              <span>{categoryName(m, c.key)}</span>
              <span className="num">{formatEUR(c.spent)}</span>
            </li>
          ))}
        </ul>
      </Card>
      <TxnList txns={members} onOpen={onOpen} />
    </>
  );
}

function TxnList({ txns, onOpen }: { txns: Txn[]; onOpen: (t: Txn) => void }) {
  return (
    <Card className="overflow-hidden">
      <CardTitle>Transactions</CardTitle>
      {txns.length === 0 && <Empty>No transactions yet. Add them from their detail sheet.</Empty>}
      <div className="divide-y divide-line">
        {txns.map((t) => (
          <TxnRow key={t.id} t={t} onOpen={onOpen} />
        ))}
      </div>
    </Card>
  );
}

/** SPEC §4.5 stage compare: average monthly spend by group, this stage vs another (or the time before it). */
function StageBody({ e }: { e: EventRow }) {
  const m = useModel();
  const others = m.ds.events.filter((x) => x.type === 'stage' && x.id !== e.id && x.status !== 'dismissed');
  const [other, setOther] = useState<string>('before');
  const a = useMemo(() => stageAverages(m, e), [m, e]);
  const otherEvent: EventRow = useMemo(() => {
    const o = others.find((x) => x.id === other);
    if (o) return o;
    const startMonth = addMonths(monthOf(e.start_date), -a.months);
    return {
      ...e,
      id: 'before',
      name: 'Before',
      start_date: `${startMonth}-01`,
      end_date: addDays(e.start_date, -1),
    };
  }, [others, other, e, a.months]);
  const b = useMemo(() => stageAverages(m, otherEvent), [m, otherEvent]);
  const groups = [...new Set([...a.byGroup.keys(), ...b.byGroup.keys()])].sort(
    (x, y) => (a.byGroup.get(y) ?? 0) - (a.byGroup.get(x) ?? 0),
  );
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Average spent / month" value={formatEUR(a.total)} sub={plural(a.months, 'month')} />
        <Stat
          label={other === 'before' ? `The ${plural(b.months, 'month')} before` : otherEvent.name}
          value={formatEUR(b.total)}
          sub="average / month"
        />
      </div>
      <Card>
        <CardTitle
          action={
            <select
              value={other}
              onChange={(ev) => setOther(ev.target.value)}
              className="h-9 rounded-lg border border-line bg-surface px-2 text-sm"
              aria-label="Compare with"
            >
              <option value="before">The same time before</option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          }
        >
          Compare by group
        </CardTitle>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-ink-3">
              <th className="px-4 py-1 text-left font-normal">Group</th>
              <th className="px-2 py-1 text-right font-normal">{e.name}</th>
              <th className="px-2 py-1 text-right font-normal">{otherEvent.name}</th>
              <th className="px-4 py-1 text-right font-normal">Change</th>
            </tr>
          </thead>
          <tbody className="num">
            {groups.map((g) => {
              const x = a.byGroup.get(g) ?? 0;
              const y = b.byGroup.get(g) ?? 0;
              return (
                <tr key={g} className="border-t border-line">
                  <td className="px-4 py-2">{g}</td>
                  <td className="px-2 py-2 text-right">{formatEUR(x)}</td>
                  <td className="px-2 py-2 text-right text-ink-2">{formatEUR(y)}</td>
                  <td className="px-4 py-2 text-right">{formatEUR(x - y, { plus: true })}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <Link
        {...activityHref({ from: e.start_date, to: e.end_date || m.today, kind: 'expense', label: e.name })}
        className="text-center text-sm text-accent"
      >
        See the transactions
      </Link>
    </>
  );
}
