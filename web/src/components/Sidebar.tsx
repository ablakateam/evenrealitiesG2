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

export const NAV = [
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

/**
 * Navigation list, shared by the desktop rail and the mobile drawer.
 *
 * Rows are `min-h-touch` (44px, Apple HIG) rather than the 36px the desktop
 * design used — a nav item is the single most-tapped control in the app and
 * was the least forgiving.
 */
export function NavList({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            [
              'flex min-h-touch items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
              isActive
                ? 'bg-bg-inset text-ink font-medium'
                : 'text-ink-muted hover:bg-bg-inset hover:text-ink',
            ].join(' ')
          }
        >
          {({ isActive }) => (
            <>
              <Icon size={18} className={isActive ? 'text-phos' : ''} />
              {label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

export function SidebarBrand() {
  return (
    <div className="flex h-14 shrink-0 items-center gap-2 px-5">
      <span className="text-base font-bold tracking-tight text-ink">VOX</span>
      <span className="rounded bg-phos/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-phos">
        G2
      </span>
    </div>
  );
}

export function SignOutButton({ onNavigate }: { onNavigate?: () => void }) {
  const { clearSecret } = useAuth();
  return (
    <div className="shrink-0 border-t border-line px-3 py-3 pb-safe">
      <button
        onClick={() => {
          onNavigate?.();
          clearSecret();
        }}
        className="min-h-touch w-full rounded-lg px-3 py-2 text-left text-xs text-ink-faint hover:bg-bg-inset hover:text-ink-muted"
      >
        Sign out
      </button>
    </div>
  );
}

/** Desktop rail. Hidden below `lg` — the drawer in Layout takes over there. */
export function Sidebar() {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-bg lg:flex">
      <SidebarBrand />
      <NavList />
      <SignOutButton />
    </aside>
  );
}
