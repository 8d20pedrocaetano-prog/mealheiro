import { CloudOff, RefreshCw, TriangleAlert, Check } from 'lucide-react';
import { useApp } from '../../state/store';

/** Honest sync state (CLAUDE.md #6): synced / N changes waiting / offline / error with retry. */
export function SyncBadge() {
  const source = useApp((s) => s.source);
  const sync = useApp((s) => s.sync);
  const pending = useApp((s) => s.ops.length);
  const syncNow = useApp((s) => s.syncNow);
  const flush = useApp((s) => s.flush);

  if (source?.kind === 'demo') {
    return (
      <span
        className="rounded-full bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn"
        title="Demo data, edits stay in memory"
      >
        Demo{pending ? ` · ${pending} edit${pending === 1 ? '' : 's'} in memory` : ''}
      </span>
    );
  }
  if (source?.kind !== 'github') return null;

  const retry = () => void (pending ? flush() : syncNow());
  let icon = <Check size={14} />;
  let text = 'Synced';
  let cls = 'text-ink-3';
  if (sync.state === 'syncing') {
    icon = <RefreshCw size={14} className="animate-spin motion-reduce:animate-none" />;
    text = pending ? `Saving ${pending}…` : 'Syncing…';
  } else if (sync.state === 'offline') {
    icon = <CloudOff size={14} />;
    text = pending ? `Offline · ${pending} waiting` : 'Offline';
    cls = 'text-warn';
  } else if (sync.state === 'error') {
    icon = <TriangleAlert size={14} />;
    text = 'Sync error · retry';
    cls = 'text-bad';
  } else if (pending) {
    icon = <RefreshCw size={14} />;
    text = `${pending} change${pending === 1 ? '' : 's'} waiting to sync`;
    cls = 'text-warn';
  }
  return (
    <button
      type="button"
      onClick={retry}
      title={sync.error ?? (sync.lastSync ? `Last sync ${sync.lastSync.replace('T', ' ')}` : undefined)}
      className={`flex h-8 items-center gap-1 rounded-full px-2 text-xs font-medium ${cls}`}
      data-testid="sync-badge"
    >
      {icon}
      <span>{text}</span>
    </button>
  );
}
