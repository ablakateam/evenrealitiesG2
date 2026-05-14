import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Layout } from '@/components/Layout';
import { Welcome } from '@/pages/Welcome';
import { Overview } from '@/pages/Overview';
import { Wizard } from '@/pages/Wizard';
import {
  InboxPage,
  ContactsPage,
  TemplatesPage,
  ActivityPage,
  IntegrationsPage,
  PreferencesPage,
  DiagnosticsPage,
  AccountPage,
} from '@/pages/stubs';

export function App() {
  const { isAuthed } = useAuth();

  return (
    <BrowserRouter>
      <Routes>
        {!isAuthed ? (
          <>
            <Route path="/welcome" element={<Welcome />} />
            <Route path="*" element={<Navigate to="/welcome" replace />} />
          </>
        ) : (
          <>
            <Route path="/welcome" element={<Navigate to="/" replace />} />
            {/* Onboarding wizard — full-screen, outside the dashboard shell */}
            <Route path="/setup" element={<Wizard />} />
            <Route element={<Layout />}>
              <Route path="/" element={<Overview />} />
              <Route path="/inbox" element={<InboxPage />} />
              <Route path="/contacts" element={<ContactsPage />} />
              <Route path="/templates" element={<TemplatesPage />} />
              <Route path="/activity" element={<ActivityPage />} />
              <Route path="/integrations" element={<IntegrationsPage />} />
              <Route path="/preferences" element={<PreferencesPage />} />
              <Route path="/diagnostics" element={<DiagnosticsPage />} />
              <Route path="/account" element={<AccountPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </>
        )}
      </Routes>
    </BrowserRouter>
  );
}
