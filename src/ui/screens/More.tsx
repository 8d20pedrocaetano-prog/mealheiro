import { useApp } from '../../state/store';

export function More() {
  const leave = useApp((s) => s.leave);
  const source = useApp((s) => s.source);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">More</h1>
      <div className="rounded-2xl border border-line bg-surface p-4">
        <p className="text-sm text-ink-2">
          {source?.kind === 'demo'
            ? 'You are looking at synthetic demo data. Edits stay in memory.'
            : 'Connected.'}
        </p>
        <button className="mt-3 h-11 rounded-xl border border-line px-4 text-sm font-medium" onClick={leave}>
          {source?.kind === 'demo' ? 'Leave demo' : 'Disconnect'}
        </button>
      </div>
    </div>
  );
}
