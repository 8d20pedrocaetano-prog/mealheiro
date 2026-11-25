import { useEffect, useMemo, useRef, useState } from 'react';
import type { Txn } from '../../core/dataset';
import { useModel } from '../../state/store';
import { TxnRow } from '../components/TxnRow';
import { fmtDayHeader, formatEUR } from '../lib/format';

interface DayGroup {
  day: string;
  txns: Txn[];
  net: number;
}

const PAGE = 40;

export function Activity() {
  const m = useModel();
  const days = useMemo<DayGroup[]>(() => {
    const by = new Map<string, Txn[]>();
    for (let i = m.ds.txns.length - 1; i >= 0; i--) {
      const t = m.ds.txns[i];
      let a = by.get(t.value_date);
      if (!a) by.set(t.value_date, (a = []));
      a.push(t);
    }
    return [...by.entries()].map(([day, txns]) => ({
      day,
      txns,
      net: txns.reduce((s, t) => {
        const e = m.view.eff.get(t.id)!;
        return e.kind === 'transfer' || e.excluded ? s : s + t.amount;
      }, 0),
    }));
  }, [m]);

  const [shown, setShown] = useState(PAGE);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setShown((n) => n + PAGE);
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const refYear = Number(m.today.slice(0, 4));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Activity</h1>
        <span className="text-sm text-ink-2" data-testid="txn-count">
          {m.ds.txns.length} transactions
        </span>
      </div>
      <div className="flex flex-col gap-3">
        {days.slice(0, shown).map((g) => (
          <section key={g.day} className="overflow-hidden rounded-2xl border border-line bg-surface">
            <h2 className="flex items-center justify-between bg-surface-2/60 px-3 py-1.5 text-xs font-medium text-ink-2">
              <span>{fmtDayHeader(g.day, refYear)}</span>
              <span className="num">{formatEUR(g.net, { plus: true })}</span>
            </h2>
            <div className="divide-y divide-line">
              {g.txns.map((t) => (
                <TxnRow key={t.id} t={t} />
              ))}
            </div>
          </section>
        ))}
      </div>
      {shown < days.length && <div ref={sentinel} className="skeleton h-12" aria-hidden="true" />}
    </div>
  );
}
