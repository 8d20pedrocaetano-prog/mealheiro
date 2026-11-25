import { Search, SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import type { Txn } from '../../core/dataset';
import { useModel } from '../../state/store';
import { Sheet } from '../components/Sheet';
import { TxnDetail } from '../components/TxnDetail';
import { TxnRow } from '../components/TxnRow';
import { Chip, Empty } from '../components/ui';
import {
  applyFilter,
  filterSearch,
  filterState,
  isEmptyFilter,
  monthRangeFilter,
  parseFilter,
  type TxnFilter,
} from '../lib/filter';
import { fmtDate, fmtDayHeader, fmtMonth, fmtMonthShort, formatEUR, plural } from '../lib/format';

const PAGE = 40;

interface DayGroup {
  day: string;
  txns: Txn[];
  net: number;
}

export function Activity({ actions }: { actions?: (t: Txn) => ReactNode }) {
  const m = useModel();
  const [sp, setSp] = useSearchParams();
  const { state } = useLocation();
  const filter = useMemo(() => parseFilter(sp, state), [sp, state]);
  const [query, setQuery] = useState(filter.q ?? '');
  const [selected, setSelected] = useState<Txn | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const setFilter = (f: TxnFilter) =>
    setSp(new URLSearchParams(filterSearch(f).slice(1)), { replace: true, state: filterState(f) });

  // debounce search into the filter (kept in history.state, never in the URL)
  useEffect(() => {
    const id = setTimeout(() => {
      if ((filter.q ?? '') !== query) setFilter({ ...filter, q: query || undefined });
    }, 200);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const result = useMemo(() => applyFilter(m, filter), [m, filter]);
  const total = result.lines.reduce((s, l) => s + l.amount, 0);

  const days = useMemo<DayGroup[]>(() => {
    const by = new Map<string, Txn[]>();
    for (let i = result.txns.length - 1; i >= 0; i--) {
      const t = result.txns[i];
      let a = by.get(t.value_date);
      if (!a) by.set(t.value_date, (a = []));
      a.push(t);
    }
    return [...by.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([day, txns]) => ({
        day,
        txns,
        net: txns.reduce((s, t) => s + (result.contribution.get(t.id) ?? 0), 0),
      }));
  }, [result]);

  // Page size resets whenever the filter changes (keyed by the URL query).
  const filterKey = sp.toString();
  const [paging, setPaging] = useState({ key: filterKey, n: PAGE });
  const shown = paging.key === filterKey ? paging.n : PAGE;
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting))
        setPaging((p) => ({ key: filterKey, n: (p.key === filterKey ? p.n : PAGE) + PAGE }));
    });
    io.observe(el);
    return () => io.disconnect();
  }, [days.length, shown, filterKey]);

  const months = [...m.months].reverse();
  const activeMonth =
    filter.from &&
    filter.to &&
    filter.from.slice(0, 7) === filter.to.slice(0, 7) &&
    filter.from.endsWith('-01')
      ? filter.from.slice(0, 7)
      : null;
  const refYear = Number(m.today.slice(0, 4));
  const filterCount = (
    ['kind', 'group', 'cat', 'acct', 'event', 'merchant', 'review', 'note'] as const
  ).filter((k) => filter[k]).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Activity</h1>
        <span className="text-sm text-ink-2" data-testid="txn-count">
          {plural(result.txns.length, 'transaction')}
        </span>
      </div>

      <div className="sticky top-12 z-10 -mx-4 flex flex-col gap-2 bg-bg/95 px-4 pt-1 pb-2 backdrop-blur lg:top-0">
        <div className="flex gap-2">
          <label className="flex h-11 flex-1 items-center gap-2 rounded-xl border border-line bg-surface px-3 focus-within:border-accent">
            <Search size={18} className="text-ink-3" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Merchant, description, note or 12,5"
              className="min-w-0 flex-1 bg-transparent text-[16px] outline-none"
              aria-label="Search transactions"
            />
          </label>
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            className={`relative flex size-11 shrink-0 items-center justify-center rounded-xl border ${
              filterCount ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface text-ink-2'
            }`}
            aria-label="Filters"
          >
            <SlidersHorizontal size={18} />
            {filterCount > 0 && (
              <span className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full bg-accent text-[11px] text-accent-ink">
                {filterCount}
              </span>
            )}
          </button>
        </div>
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
          <Chip
            active={!filter.from && !filter.to}
            onClick={() => setFilter({ ...filter, from: undefined, to: undefined })}
          >
            All time
          </Chip>
          {months.map((mo) => (
            <Chip
              key={mo}
              active={activeMonth === mo}
              onClick={() => setFilter({ ...filter, ...monthRangeFilter(mo), label: undefined })}
            >
              {fmtMonthShort(mo)}
            </Chip>
          ))}
        </div>
      </div>

      {!isEmptyFilter({ ...filter, q: undefined }) && (
        <div className="flex items-center gap-2 rounded-xl bg-accent-soft px-3 py-2 text-sm">
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-accent">{filter.label ?? describe(filter, m)}</div>
            <div className="num text-ink-2" data-testid="filter-total">
              {result.lineBased && filter.kind === 'expense' ? 'Spent ' : 'Net '}
              {formatEUR(result.lineBased && filter.kind === 'expense' ? -total : total, {
                plus: !(result.lineBased && filter.kind === 'expense'),
              })}
            </div>
          </div>
          <button
            className="flex size-9 items-center justify-center rounded-full text-ink-2"
            onClick={() => {
              setQuery('');
              setFilter({});
            }}
            aria-label="Clear filters"
          >
            <X size={18} />
          </button>
        </div>
      )}

      {days.length === 0 && <Empty>No transactions match.</Empty>}
      <div className="flex flex-col gap-3">
        {days.slice(0, shown).map((g) => (
          <section key={g.day} className="overflow-hidden rounded-2xl border border-line bg-surface">
            <h2 className="flex items-center justify-between bg-surface-2/60 px-3 py-1.5 text-xs font-medium text-ink-2">
              <span>{fmtDayHeader(g.day, refYear)}</span>
              <span className="num">{formatEUR(g.net, { plus: true })}</span>
            </h2>
            <div className="divide-y divide-line">
              {g.txns.map((t) => (
                <TxnRow
                  key={t.id}
                  t={t}
                  onOpen={setSelected}
                  contribution={result.lineBased ? result.contribution.get(t.id) : undefined}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
      {shown < days.length && <div ref={sentinel} className="skeleton h-12" aria-hidden="true" />}

      <TxnDetail t={selected} onClose={() => setSelected(null)} actions={actions} />
      <FilterSheet open={filtersOpen} onOpenChange={setFiltersOpen} filter={filter} setFilter={setFilter} />
    </div>
  );
}

function describe(f: TxnFilter, m: ReturnType<typeof useModel>): string {
  const parts: string[] = [];
  if (f.kind === 'expense') parts.push('Spending');
  if (f.kind === 'income') parts.push('Income');
  if (f.kind === 'reporting') parts.push('Income and spending');
  if (f.kind === 'transfer') parts.push('Transfers');
  if (f.cat) parts.push(m.ds.categories.get(f.cat)?.name ?? f.cat);
  if (f.group) parts.push(f.group);
  if (f.merchant) parts.push(f.merchant);
  if (f.acct) parts.push(m.ds.accounts.get(f.acct)?.name ?? f.acct);
  if (f.event) parts.push(m.ds.events.find((e) => e.id === f.event)?.name ?? f.event);
  if (f.review) parts.push('Needs review');
  if (f.note) parts.push('Has note');
  if (f.from && f.to && f.from.slice(0, 7) === f.to.slice(0, 7) && f.from.endsWith('-01'))
    parts.push(fmtMonth(f.from.slice(0, 7)));
  else if (f.from || f.to) parts.push(`${f.from ? fmtDate(f.from) : '…'} – ${f.to ? fmtDate(f.to) : '…'}`);
  return parts.join(' · ') || 'Filtered';
}

function FilterSheet({
  open,
  onOpenChange,
  filter,
  setFilter,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  filter: TxnFilter;
  setFilter: (f: TxnFilter) => void;
}) {
  const m = useModel();
  const groups = [...new Set([...m.ds.categories.values()].map((c) => c.group)), 'Unitemized'];
  const set = (patch: Partial<TxnFilter>) => setFilter({ ...filter, ...patch, label: undefined });
  const sel = 'h-11 w-full rounded-xl border border-line bg-surface px-3 text-[16px]';
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Filters">
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Kind
          <select
            className={sel}
            value={filter.kind ?? ''}
            onChange={(e) => set({ kind: (e.target.value || undefined) as TxnFilter['kind'] })}
          >
            <option value="">Everything</option>
            <option value="expense">Spending</option>
            <option value="income">Income</option>
            <option value="transfer">Transfers (neutral)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Group
          <select
            className={sel}
            value={filter.group ?? ''}
            onChange={(e) => set({ group: e.target.value || undefined })}
          >
            <option value="">Any group</option>
            {groups.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Category
          <select
            className={sel}
            value={filter.cat ?? ''}
            onChange={(e) => set({ cat: e.target.value || undefined })}
          >
            <option value="">Any category</option>
            {[...m.ds.categories.values()].map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            {[...m.ds.accounts.values()]
              .filter((a) => a.tracked !== 'true')
              .map((a) => (
                <option key={a.id} value={`unitemized-${a.id}`}>
                  Unitemized · {a.name}
                </option>
              ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Account
          <select
            className={sel}
            value={filter.acct ?? ''}
            onChange={(e) => set({ acct: e.target.value || undefined })}
          >
            <option value="">Any account</option>
            {[...m.ds.accounts.values()].map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Event
          <select
            className={sel}
            value={filter.event ?? ''}
            onChange={(e) => set({ event: e.target.value || undefined })}
          >
            <option value="">Any event</option>
            {m.ds.events
              .filter((e) => e.status !== 'dismissed')
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
          <Chip active={!!filter.review} onClick={() => set({ review: !filter.review })}>
            Needs review
          </Chip>
          <Chip active={!!filter.note} onClick={() => set({ note: !filter.note })}>
            Has note
          </Chip>
        </div>
        <button className="h-11 rounded-xl border border-line" onClick={() => setFilter({ q: filter.q })}>
          Clear filters
        </button>
      </div>
    </Sheet>
  );
}
