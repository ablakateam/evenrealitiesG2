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
              'group relative flex min-h-touch items-center gap-3 rounded-lg px-3 py-2',
              'font-mono text-[13px] tracking-wide transition-colors',
              // A phosphor rail on the active row, drawn on the container
              // edge rather than as a background wash — the same way the
              // glasses mark a selected list item.
              isActive
                ? 'bg-bg-inset text-ink before:absolute before:left-0 before:top-1/2 before:h-4 before:w-[2px] before:-translate-y-1/2 before:rounded-full before:bg-phos before:shadow-[0_0_8px_rgba(57,255,106,.7)]'
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
      <span className="font-display text-[15px] font-700 tracking-[0.2em] text-ink">VOX</span>
      <span className="rounded border border-phos/25 bg-phos/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-phos">
        G2
      </span>
      <span className="ml-auto animate-blink font-mono text-[13px] text-phos/70" aria-hidden="true">
        _
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
        className="min-h-touch w-full rounded-lg px-3 py-2 text-left font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint hover:bg-bg-inset hover:text-ink-muted"
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
