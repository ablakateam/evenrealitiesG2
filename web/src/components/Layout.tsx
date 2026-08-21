import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Menu, X, ArrowLeft } from 'lucide-react';
import { Sidebar, NavList, SidebarBrand, SignOutButton, NAV } from './Sidebar';
import { getReturnTo, goBackToVox } from '@/lib/returnTo';

/**
 * App shell.
 *
 * Desktop (>= lg): fixed 240px rail + scrolling content, as before.
 *
 * Mobile: the rail is hidden entirely and replaced by a sticky top bar with
 * a hamburger and the current page's name, plus a slide-in drawer. The old
 * shell rendered the 240px rail unconditionally, so on a 390px iPhone the
 * content pane got ~150px and every page was sliced down the middle.
 *
 * The header is `pt-safe` and the drawer `pb-safe` so nothing sits under the
 * Dynamic Island or the home indicator.
 */
export function Layout() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  // Close on navigation — otherwise the drawer stays over the page you just
  // asked for.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Lock background scroll while the drawer is open, and restore exactly
  // what was there before (not a hard-coded 'auto').
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Escape closes, for keyboard users and iPad hardware keyboards.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const current = NAV.find((n) => (n.end ? pathname === n.to : pathname.startsWith(n.to)));
  // Present only when the dashboard was opened FROM the VOX companion.
  // Opened directly in a browser there is real chrome, and an app-drawn
  // back button would be a dead end.
  const returnTo = getReturnTo();

  return (
    <div className="flex h-full">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex shrink-0 flex-col border-b border-line bg-bg/95 backdrop-blur pt-safe lg:hidden">
          <div className="flex h-14 items-center gap-1 px-gutter-sm">
            {returnTo && (
              <button
                type="button"
                onClick={goBackToVox}
                aria-label="Back to VOX"
                className="grid h-touch w-touch shrink-0 place-items-center rounded-lg text-phos hover:bg-bg-inset"
              >
                <ArrowLeft size={20} />
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label="Open navigation"
              aria-expanded={open}
              className="grid h-touch w-touch shrink-0 place-items-center rounded-lg text-ink-muted hover:bg-bg-inset hover:text-ink"
            >
              <Menu size={20} />
            </button>
            <span className="truncate text-sm font-semibold text-ink">
              {current?.label ?? 'VOX'}
            </span>
            <span className="ml-auto mr-2 rounded bg-phos/10 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-phos">
              G2
            </span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-gutter py-6 pb-safe sm:py-8">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-y-0 left-0 flex w-[17rem] max-w-[85vw] flex-col border-r border-line bg-bg pt-safe pl-safe shadow-2xl">
            <div className="flex items-center justify-between pr-2">
              <SidebarBrand />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                className="grid h-touch w-touch place-items-center rounded-lg text-ink-muted hover:bg-bg-inset hover:text-ink"
              >
                <X size={20} />
              </button>
            </div>
            <NavList onNavigate={() => setOpen(false)} />
            {returnTo && (
              <div className="shrink-0 border-t border-line px-3 py-2">
                <button
                  onClick={goBackToVox}
                  className="flex min-h-touch w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-phos hover:bg-bg-inset"
                >
                  <ArrowLeft size={18} />
                  Back to VOX
                </button>
              </div>
            )}
            <SignOutButton onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
