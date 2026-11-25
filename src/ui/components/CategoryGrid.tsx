import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useModel } from '../../state/store';
import { groupedCategories } from '../lib/categories';
import { CategoryIcon } from '../lib/icons';
import { groupColor, tint } from '../lib/palette';

function Tile({ id, active, onPick }: { id: string; active: boolean; onPick: (id: string) => void }) {
  const m = useModel();
  const c = m.ds.categories.get(id);
  if (!c) return null;
  const color = groupColor(c.group);
  return (
    <button
      type="button"
      onClick={() => onPick(id)}
      aria-pressed={active}
      className={`flex min-h-[76px] flex-col items-center justify-start gap-1 rounded-xl border px-1 pt-2 pb-1.5 text-center text-xs leading-tight ${
        active ? 'border-accent bg-accent-soft font-semibold' : 'border-transparent hover:bg-surface-2'
      }`}
    >
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-full"
        style={{ background: tint(color, 0.8), color }}
      >
        <CategoryIcon name={c.icon} size={18} />
      </span>
      <span className="line-clamp-2">{c.name}</span>
    </button>
  );
}

/**
 * The category picker used by the detail sheet, Quick add, cash itemising and the review inbox.
 * With `top`, shows those first and the rest behind "More…".
 */
export function CategoryGrid({
  value,
  onPick,
  kinds,
  top,
}: {
  value?: string;
  onPick: (id: string) => void;
  kinds?: string[];
  top?: string[];
}) {
  const m = useModel();
  const [all, setAll] = useState(!top);
  const [q, setQ] = useState('');
  const groups = useMemo(() => groupedCategories(m, kinds), [m, kinds]);
  const needle = q.trim().toLowerCase();

  if (!all && top)
    return (
      <div className="grid grid-cols-4 gap-1">
        {top.map((id) => (
          <Tile key={id} id={id} active={value === id} onPick={onPick} />
        ))}
        {value && !top.includes(value) && <Tile id={value} active onPick={onPick} />}
        <button
          type="button"
          onClick={() => setAll(true)}
          className="col-span-4 min-h-11 rounded-xl text-sm text-accent hover:bg-surface-2"
        >
          More categories…
        </button>
      </div>
    );

  return (
    <div className="flex flex-col gap-2">
      <label className="flex h-11 items-center gap-2 rounded-xl border border-line bg-surface px-3 focus-within:border-accent">
        <Search size={16} className="text-ink-3" aria-hidden="true" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find a category"
          aria-label="Find a category"
          className="min-w-0 flex-1 bg-transparent text-[16px] outline-none"
        />
      </label>
      {groups.map(({ group, cats }) => {
        const shown = needle ? cats.filter((c) => c.name.toLowerCase().includes(needle)) : cats;
        if (!shown.length) return null;
        return (
          <div key={group}>
            <div className="px-1 pt-1 text-xs font-medium text-ink-3">{group}</div>
            <div className="grid grid-cols-4 gap-1">
              {shown.map((c) => (
                <Tile key={c.id} id={c.id} active={value === c.id} onPick={onPick} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
