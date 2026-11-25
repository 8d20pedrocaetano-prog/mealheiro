import { ChartColumn, Ellipsis, House, ListOrdered, Target } from 'lucide-react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { SyncBadge } from './components/SyncBadge';
import { useModel } from '../state/store';
import { badgeCount } from './lib/review';

const NAV = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/activity', label: 'Activity', icon: ListOrdered, end: false },
  { to: '/insights', label: 'Insights', icon: ChartColumn, end: false },
  { to: '/plan', label: 'Plan', icon: Target, end: false },
  { to: '/more', label: 'More', icon: Ellipsis, end: false },
];

/** Bottom tab bar on the phone, left rail on desktop (SPEC §3). */
function Badge({ n, className = '' }: { n: number; className?: string }) {
  if (!n) return null;
  return (
    <span
      className={`num min-w-5 rounded-full bg-accent px-1.5 text-center text-[11px] leading-5 font-semibold text-accent-ink ${className}`}
    >
      {n > 99 ? '99+' : n}
      <span className="sr-only"> to review</span>
    </span>
  );
}

export function Shell() {
  const { pathname } = useLocation();
  const m = useModel();
  const review = badgeCount(m);
  return (
    <div className="flex min-h-full">
      <nav
        aria-label="Main"
        className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col gap-1 border-r border-line bg-surface p-3 lg:flex"
      >
        <div className="mb-4 flex items-center gap-2 px-3 pt-2">
          <img src={`${import.meta.env.BASE_URL}icons/favicon.svg`} alt="" className="size-7" />
          <span className="text-lg font-semibold">Mealheiro</span>
        </div>
        <div className="mb-2 px-1">
          <SyncBadge />
        </div>
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium ${
                isActive ? 'bg-accent-soft text-accent' : 'text-ink-2 hover:bg-surface-2'
              }`
            }
          >
            <Icon size={20} aria-hidden="true" />
            {label}
            {to === '/more' && <Badge n={review} className="ml-auto" />}
          </NavLink>
        ))}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-line bg-bg/95 px-4 backdrop-blur lg:hidden">
          <img src={`${import.meta.env.BASE_URL}icons/favicon.svg`} alt="" className="size-6" />
          <span className="font-semibold">Mealheiro</span>
          <span className="ml-auto">
            <SyncBadge />
          </span>
        </header>
        <main
          key={pathname.split('/')[1]}
          className="mx-auto w-full max-w-6xl flex-1 px-4 pt-3 pb-28 lg:px-8 lg:pt-6 lg:pb-10"
        >
          <Outlet />
        </main>
      </div>

      <nav
        aria-label="Main"
        className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur lg:hidden"
      >
        <ul className="mx-auto grid h-16 max-w-md grid-cols-5">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex h-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                    isActive ? 'text-accent' : 'text-ink-3'
                  }`
                }
              >
                <span className="relative">
                  <Icon size={22} aria-hidden="true" />
                  {to === '/more' && <Badge n={review} className="absolute -top-1.5 left-3.5" />}
                </span>
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
