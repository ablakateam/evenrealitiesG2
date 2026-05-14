import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Inbox,
  Users,
  Keyboard,
  BarChart3,
  Plug,
  SlidersHorizontal,
  Wrench,
  CircleUser,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/inbox', label: 'Inbox', icon: Inbox },
  { to: '/contacts', label: 'Contacts', icon: Users },
  { to: '/templates', label: 'Templates', icon: Keyboard },
  { to: '/activity', label: 'Activity', icon: BarChart3 },
  { to: '/integrations', label: 'Integrations', icon: Plug },
  { to: '/preferences', label: 'Preferences', icon: SlidersHorizontal },
  { to: '/diagnostics', label: 'Diagnostics', icon: Wrench },
  { to: '/account', label: 'Account', icon: CircleUser },
];

export function Sidebar() {
  const { clearSecret } = useAuth();
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-bg">
      <div className="flex h-14 items-center gap-2 px-5">
        <span className="text-base font-bold tracking-tight text-ink">VOX</span>
        <span className="rounded bg-phos/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-phos">
          G2
        </span>
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-2">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              [
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-bg-inset text-ink font-medium'
                  : 'text-ink-muted hover:bg-bg-inset hover:text-ink',
              ].join(' ')
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={17} className={isActive ? 'text-phos' : ''} />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-line px-3 py-3">
        <button
          onClick={clearSecret}
          className="w-full rounded-lg px-3 py-2 text-left text-xs text-ink-faint hover:bg-bg-inset hover:text-ink-muted"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
