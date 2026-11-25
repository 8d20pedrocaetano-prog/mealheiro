import { useApp } from '../../state/store';

export function Connect() {
  const startDemo = useApp((s) => s.startDemo);
  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col justify-center gap-6 p-6">
      <div className="flex items-center gap-3">
        <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" className="size-14 rounded-2xl" />
        <div>
          <h1 className="text-2xl font-semibold">Mealheiro</h1>
          <p className="text-ink-2">Your spending and savings, from your own files.</p>
        </div>
      </div>
      <div className="rounded-2xl border border-line bg-surface p-4">
        <h2 className="font-medium">Connect your data repo</h2>
        <p className="mt-1 text-sm text-ink-2">Connecting to GitHub arrives in the next milestone (M2).</p>
      </div>
      <button
        className="h-12 rounded-xl bg-accent font-medium text-accent-ink"
        onClick={() => void startDemo()}
      >
        Try the demo
      </button>
      <p className="text-center text-xs text-ink-3">Demo data is synthetic. Nothing leaves this device.</p>
    </div>
  );
}
