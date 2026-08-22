import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Layout } from '@/components/Layout';
import { Welcome } from '@/pages/Welcome';
import { Overview } from '@/pages/Overview';
import { Wizard } from '@/pages/Wizard';
import { Inbox } from '@/pages/Inbox';
import { Contacts } from '@/pages/Contacts';
import { Templates } from '@/pages/Templates';
import { Activity } from '@/pages/Activity';
import { Integrations } from '@/pages/Integrations';
import { Preferences } from '@/pages/Preferences';
import { Diagnostics } from '@/pages/Diagnostics';
import { Account } from '@/pages/Account';
import { Connect } from '@/pages/Connect';
import { PairLanding } from '@/pages/PairLanding';

export function App() {
  const { isAuthed } = useAuth();

  return (
    <BrowserRouter>
      <Routes>
        {!isAuthed ? (
          <>
            <Route path="/connect" element={<Connect />} />
            <Route path="/p/:code" element={<PairLanding />} />
            <Route path="/welcome" element={<Welcome />} />
            <Route path="*" element={<Navigate to="/welcome" replace />} />
          </>
        ) : (
          <>
            <Route path="/welcome" element={<Navigate to="/" replace />} />
            {/* Re-connecting while already signed in just swaps the stored secret. */}
            <Route path="/connect" element={<Connect />} />
            {/* A pairing link opened in a browser explains itself rather than
                redirecting — the code is for the app, not for this device. */}
            <Route path="/p/:code" element={<PairLanding />} />
            {/* Onboarding wizard — full-screen, outside the dashboard shell */}
            <Route path="/setup" element={<Wizard />} />
            <Route element={<Layout />}>
              <Route path="/" element={<Overview />} />
              <Route path="/inbox" element={<Inbox />} />
              <Route path="/contacts" element={<Contacts />} />
              <Route path="/templates" element={<Templates />} />
              <Route path="/activity" element={<Activity />} />
              <Route path="/integrations" element={<Integrations />} />
              <Route path="/preferences" element={<Preferences />} />
              <Route path="/diagnostics" element={<Diagnostics />} />
              <Route path="/account" element={<Account />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </>
        )}
      </Routes>
    </BrowserRouter>
  );
}
