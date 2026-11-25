import { totalsOf } from '../../core/aggregates';
import { useModel } from '../../state/store';
import { formatEUR, fmtMonth } from '../lib/format';

export function Home() {
  const m = useModel();
  const month = m.today.slice(0, 7);
  const t = totalsOf(month, m.summary[month]);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{fmtMonth(month)}</h1>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Spent', t.spent],
          ['Income', t.income],
          ['Saved', t.saved],
        ].map(([label, v]) => (
          <div key={label} className="rounded-2xl border border-line bg-surface p-4">
            <div className="text-sm text-ink-2">{label}</div>
            <div className="num mt-1 text-xl font-semibold">{formatEUR(v as number)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
