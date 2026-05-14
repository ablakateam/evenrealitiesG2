import { PageHeading, EmptyState } from '@/components/ui';

/**
 * Placeholder pages — wired into the router now so navigation works in P8.
 * Each is fully built out in P10 (Dashboard surfaces).
 */
function Stub({ title, subtitle, note }: { title: string; subtitle: string; note: string }) {
  return (
    <>
      <PageHeading title={title} subtitle={subtitle} />
      <EmptyState>{note}</EmptyState>
    </>
  );
}

export const InboxPage = () => (
  <Stub
    title="Inbox"
    subtitle="Incoming SMS and email"
    note="Inbox thread view ships in P10. The /api/inbox + SSE stream are already live."
  />
);

export const ContactsPage = () => (
  <Stub
    title="Contacts"
    subtitle="People you message"
    note="Contact list, add/edit, CSV import, and Google sync ship in P10. The /api/contacts CRUD is already live."
  />
);

export const TemplatesPage = () => (
  <Stub
    title="Templates"
    subtitle="Quick-send phrases"
    note="Template editor with drag-reorder ships in P10. 12 defaults are already seeded server-side."
  />
);

export const ActivityPage = () => (
  <Stub
    title="Activity"
    subtitle="Send + receive log with cost tracking"
    note="Filterable activity table + CSV export ships in P10. The /api/history endpoint is already live."
  />
);

export const IntegrationsPage = () => (
  <Stub
    title="Integrations"
    subtitle="Twilio, Email, AI providers"
    note="Per-service integration cards ship in P10. Twilio + Migadu email + OpenAI are configured server-side."
  />
);

export const PreferencesPage = () => (
  <Stub
    title="Preferences"
    subtitle="Voice, AI, notifications, smart features"
    note="Preferences panels ship in P10. The /api/config GET/PUT is already live."
  />
);

export const DiagnosticsPage = () => (
  <Stub
    title="Diagnostics"
    subtitle="End-to-end health checks"
    note="One-tap 'run all tests' panel ships in P10."
  />
);

export const AccountPage = () => (
  <Stub
    title="Account"
    subtitle="Pairing and secret rotation"
    note="Pairing QR + secret rotation ship in P10."
  />
);
