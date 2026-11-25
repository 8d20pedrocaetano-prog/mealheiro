/**
 * First-run and empty states (M6): a welcome on Home while the data repo has no transactions, a "no data
 * yet" card for screens that need some, and one-time hints the owner can dismiss (kept per device).
 */
import { ChevronRight, Inbox, Lightbulb, Target, Upload, Wallet, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Card } from './ui';

const STEPS = [
  {
    to: '/more/import',
    icon: Upload,
    title: 'Import a statement',
    text: 'The PDF from the CGD app: share it to Mealheiro, or pick the file.',
  },
  {
    to: '/more/accounts',
    icon: Wallet,
    title: 'Check your accounts',
    text: 'Say which ones are tracked. Money sent to the others counts as spending.',
  },
  {
    to: '/more/review',
    icon: Inbox,
    title: 'Clear the review inbox',
    text: 'Name the people and shops the rules could not place.',
  },
  {
    to: '/plan',
    icon: Target,
    title: 'Set a budget',
    text: 'A monthly limit for everything or for one category.',
  },
];

export function Welcome() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4" data-testid="welcome">
      <Card className="p-5">
        <h1 className="text-xl font-semibold">Welcome to Mealheiro</h1>
        <p className="mt-1 text-sm text-ink-2">
          See where your money goes, month by month. It all starts with a bank statement.
        </p>
        <Link
          to="/more/import"
          className="mt-4 flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 font-semibold text-accent-ink"
        >
          <Upload size={18} aria-hidden="true" /> Import your first statement
        </Link>
      </Card>
      <Card className="overflow-hidden">
        <h2 className="px-4 pt-3 pb-1 text-sm font-semibold text-ink-2">Getting started</h2>
        <ol className="divide-y divide-line">
          {STEPS.map((s, i) => (
            <li key={s.to}>
              <Link to={s.to} className="flex min-h-14 items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                <span className="num flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 font-medium">
                    <s.icon size={16} className="text-ink-3" aria-hidden="true" />
                    {s.title}
                  </span>
                  <span className="block text-xs text-ink-3">{s.text}</span>
                </span>
                <ChevronRight size={18} className="text-ink-3" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ol>
      </Card>
      <p className="px-2 text-center text-sm text-ink-3">
        Spent cash? Tap <strong className="font-semibold text-ink-2">+</strong> to log it now. It is matched
        to the withdrawal when that arrives with your next import.
      </p>
    </div>
  );
}

/** For screens that need transactions before they can show anything. */
export function NoDataYet({ what }: { what: string }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5 text-center" data-testid="no-data">
      <p className="text-sm text-ink-2">{what}</p>
      <Link
        to="/more/import"
        className="mx-auto mt-3 flex min-h-11 w-fit items-center gap-2 rounded-xl border border-line px-4 text-sm font-medium"
      >
        <Upload size={16} aria-hidden="true" /> Import a statement
      </Link>
    </section>
  );
}

const KEY = 'mealheiro.hints.dismissed';

function dismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

/** A tip shown until the owner closes it (remembered on this device only). */
export function Hint({ id, children }: { id: string; children: ReactNode }) {
  const [hidden, setHidden] = useState(() => dismissed().includes(id));
  if (hidden) return null;
  return (
    <div
      className="flex items-start gap-2 rounded-2xl border border-line bg-accent-soft py-1 pl-3 text-sm"
      role="note"
      data-testid={`hint-${id}`}
    >
      <Lightbulb size={16} className="mt-2.5 shrink-0 text-accent" aria-hidden="true" />
      <p className="flex-1 py-2 text-ink-2">{children}</p>
      <button
        type="button"
        className="flex size-11 shrink-0 items-center justify-center text-ink-3"
        aria-label="Dismiss tip"
        onClick={() => {
          setHidden(true);
          try {
            localStorage.setItem(KEY, JSON.stringify([...new Set([...dismissed(), id])]));
          } catch {
            /* private window: hidden for this visit only */
          }
        }}
      >
        <X size={16} />
      </button>
    </div>
  );
}
