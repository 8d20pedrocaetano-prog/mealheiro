import {
  CalendarRange,
  ChartColumn,
  ChevronRight,
  Database,
  Download,
  Inbox,
  ListFilter,
  LogOut,
  RefreshCw,
  Tags,
  Upload,
  Wallet,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useApp, useModel } from '../../state/store';
import { Card } from '../components/ui';
import { fmtDate, plural } from '../lib/format';
import { badgeCount } from '../lib/review';
import { download } from '../lib/download';
import { effectiveFiles, exportZip } from '../../sync/export';

function exportAll() {
  const { files, base, ops } = useApp.getState();
  const zip = exportZip(effectiveFiles(files, base, ops), new Date());
  download(zip.bytes, zip.name, 'application/zip');
}

function Item({
  to,
  icon,
  label,
  sub,
  badge,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  sub?: string;
  badge?: number;
}) {
  return (
    <Link to={to} className="flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-surface-2">
      <span className="text-ink-2">{icon}</span>
      <span className="flex-1">
        <span className="block font-medium">{label}</span>
        {sub && <span className="block text-xs text-ink-3">{sub}</span>}
      </span>
      {!!badge && (
        <span className="num rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-ink">
          {badge}
        </span>
      )}
      <ChevronRight size={18} className="text-ink-3" />
    </Link>
  );
}

export function More() {
  const m = useModel();
  const source = useApp((s) => s.source);
  const sync = useApp((s) => s.sync);
  const ops = useApp((s) => s.ops);
  const leaveDemo = useApp((s) => s.leaveDemo);
  const forgetDevice = useApp((s) => s.forgetDevice);
  const syncNow = useApp((s) => s.syncNow);
  const lock = useApp((s) => s.lock);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const review = badgeCount(m);
  const proposals = m.proposals.length;
  const lastImport = m.ds.imports
    .map((i) => i.imported_at.slice(0, 10))
    .sort()
    .pop();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">More</h1>
      <Card className="divide-y divide-line overflow-hidden">
        <Item
          to="/more/review"
          icon={<Inbox size={20} />}
          label="Review"
          sub={review ? `${plural(review, 'item')} need you` : 'Inbox clear'}
          badge={review}
        />
        <Item
          to="/more/events"
          icon={<CalendarRange size={20} />}
          label="Events"
          sub={proposals ? `${plural(proposals, 'proposed trip')} to look at` : 'Trips, stages and tags'}
          badge={proposals}
        />
        <Item
          to="/insights/year"
          icon={<ChartColumn size={20} />}
          label="Year in review"
          sub="Income, spending and saving, year by year"
        />
        <Item
          to="/more/import"
          icon={<Upload size={20} />}
          label="Imports"
          sub={lastImport ? `Last import ${fmtDate(lastImport)}` : 'No imports yet'}
        />
      </Card>

      <Card className="divide-y divide-line overflow-hidden">
        <Item
          to="/more/accounts"
          icon={<Wallet size={20} />}
          label="Accounts"
          sub="Tracked or not, balances"
        />
        <Item to="/more/categories" icon={<Tags size={20} />} label="Categories" sub="Add, rename, merge" />
        <Item
          to="/more/rules"
          icon={<ListFilter size={20} />}
          label="Rules"
          sub={`${plural(m.ds.rules.length, 'rule')}, in order`}
        />
      </Card>

      <Card className="p-4">
        <div className="flex items-start gap-3">
          <Database size={20} className="mt-0.5 text-ink-2" />
          <div className="min-w-0 flex-1 text-sm">
            {source?.kind === 'demo' ? (
              <p className="text-ink-2">
                Synthetic demo data. Edits stay in memory and vanish when you leave.
              </p>
            ) : source?.kind === 'github' ? (
              <>
                <p className="font-medium">
                  {source.owner}/{source.repo} <span className="text-ink-3">({source.branch})</span>
                </p>
                <p className="text-ink-2">
                  {sync.state === 'syncing'
                    ? 'Syncing…'
                    : sync.state === 'offline'
                      ? 'Offline: showing the last synced data'
                      : sync.state === 'error'
                        ? `Sync error: ${sync.error}`
                        : ops.length
                          ? `${ops.length} change${ops.length === 1 ? '' : 's'} waiting to sync`
                          : `Synced${sync.lastSync ? ` ${sync.lastSync.slice(11, 16)}` : ''}`}
                </p>
              </>
            ) : null}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className="flex h-11 items-center gap-2 rounded-xl border border-line px-3 text-sm"
            onClick={exportAll}
            data-testid="export-zip"
          >
            <Download size={16} /> Export all data
          </button>
          {source?.kind === 'github' && (
            <>
              <button
                className="flex h-11 items-center gap-2 rounded-xl border border-line px-3 text-sm"
                onClick={() => void syncNow()}
              >
                <RefreshCw size={16} /> Sync now
              </button>
              <button className="h-11 rounded-xl border border-line px-3 text-sm" onClick={lock}>
                Lock
              </button>
            </>
          )}
          {source?.kind === 'demo' && (
            <button
              className="flex h-11 items-center gap-2 rounded-xl border border-line px-3 text-sm"
              onClick={leaveDemo}
            >
              <LogOut size={16} /> Leave demo
            </button>
          )}
        </div>
      </Card>

      {source?.kind === 'github' && (
        <Card className="p-4 text-sm">
          {confirmWipe ? (
            <>
              <p className="text-ink-2">
                Wipe this device? This clears the cached data, the encrypted token, any changes not yet
                synced, and the offline copy of the app. Your data repo is untouched.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  className="h-11 rounded-xl border border-line px-3"
                  onClick={() => setConfirmWipe(false)}
                >
                  Cancel
                </button>
                <button
                  className="h-11 rounded-xl bg-bad px-3 text-white"
                  onClick={() => void forgetDevice()}
                >
                  Wipe this device
                </button>
              </div>
            </>
          ) : (
            <button className="text-bad underline" onClick={() => setConfirmWipe(true)}>
              Wipe this device
            </button>
          )}
        </Card>
      )}
      <p className="text-center text-xs text-ink-3">Mealheiro {__APP_VERSION__}</p>
    </div>
  );
}
