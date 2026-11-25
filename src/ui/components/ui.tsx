import type { ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-surface ${className}`}>{children}</section>;
}

export function CardTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-1">
      <h2 className="text-sm font-semibold text-ink-2">{children}</h2>
      {action}
    </div>
  );
}

export function Chip({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-9 shrink-0 rounded-full border px-3 text-sm whitespace-nowrap ${
        active ? 'border-accent bg-accent-soft font-medium text-accent' : 'border-line bg-surface text-ink-2'
      }`}
    >
      {children}
    </button>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-6 text-center text-sm text-ink-3">{children}</p>;
}
