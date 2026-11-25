import { useApp } from '../../state/store';

/** Skeleton while the first sync / demo load runs: never a blank screen (SPEC §6). */
export function LoadingScreen({ error }: { error?: string | null }) {
  const source = useApp((s) => s.source);
  if (error) {
    return (
      <div className="mx-auto flex min-h-full max-w-md flex-col justify-center gap-4 p-6">
        <h1 className="text-xl font-semibold">Couldn't load your data</h1>
        <p className="text-ink-2">{error}</p>
        <button
          className="h-11 rounded-xl bg-accent px-4 font-medium text-accent-ink"
          onClick={() =>
            source?.kind === 'github' ? useApp.setState({ phase: 'locked' }) : useApp.getState().leaveDemo()
          }
        >
          Try again
        </button>
      </div>
    );
  }
  return (
    <div className="mx-auto flex max-w-md flex-col gap-3 p-4" aria-busy="true" aria-label="Loading">
      <div className="skeleton h-8 w-40" />
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="skeleton h-24" />
        ))}
      </div>
      <div className="skeleton h-40" />
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="skeleton h-12" />
      ))}
    </div>
  );
}
