import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

/** App shell — fixed sidebar + scrollable content pane. */
export function Layout() {
  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
