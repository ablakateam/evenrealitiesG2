import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  PageHeading,
  Spinner,
  StatusDot,
  Button,
  Input,
  Field,
  Modal,
  InlineNote,
} from '@/components/ui';
import { apiGet, apiPut, apiPost, apiDelete, ApiError, type IntegrationView, type EmailAccountView } from '@/lib/api';

const LLM_PROVIDERS = ['openai', 'anthropic', 'openrouter', 'ollama-cloud'] as const;
const PROVIDER_LABEL: Record<string, string> = {
  twilio: 'Twilio · SMS',
  openai: 'OpenAI',
  anthropic: 'Anthropic Claude',
  openrouter: 'OpenRouter',
  'ollama-cloud': 'Ollama Cloud',
};

export function Integrations() {
  const qc = useQueryClient();
  const integrations = useQuery({
    queryKey: ['integrations'],
    queryFn: () => apiGet<{ integrations: IntegrationView[] }>('/api/integrations'),
  });
  const email = useQuery({
    queryKey: ['email-account'],
    queryFn: async () => {
      try {
        return await apiGet<EmailAccountView>('/api/email-account');
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
  });

  const [editing, setEditing] = useState<string | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['integrations'] });
    void qc.invalidateQueries({ queryKey: ['email-account'] });
  };

  return (
    <>
      <PageHeading eyebrow="Connected services" title="Integrations" subtitle="Twilio, your email account, and AI providers" />

      {integrations.isLoading && <Spinner />}

      {/* Twilio */}
      {integrations.data && (
        <IntegrationCard
          view={integrations.data.integrations.find((i) => i.provider === 'twilio')!}
          onEdit={() => setEditing('twilio')}
          onTest={async () => {
            await apiPost('/api/integrations/twilio/test', {});
            refresh();
          }}
          onRemove={async () => {
            await apiDelete('/api/integrations/twilio');
            refresh();
          }}
        />
      )}

      {/* Email account */}
      <EmailCard account={email.data ?? null} loading={email.isLoading} onChanged={refresh} />

      {/* LLM providers */}
      {integrations.data &&
        LLM_PROVIDERS.map((p) => {
          const view = integrations.data.integrations.find((i) => i.provider === p);
          if (!view) return null;
          return (
            <IntegrationCard
              key={p}
              view={view}
              onEdit={() => setEditing(p)}
              onTest={async () => {
                await apiPost(`/api/integrations/${p}/test`, {});
                refresh();
              }}
              onRemove={async () => {
                await apiDelete(`/api/integrations/${p}`);
                refresh();
              }}
            />
          );
        })}

      {/* Edit modals */}
      {editing === 'twilio' && (
        <TwilioModal
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
      {editing && editing !== 'twilio' && (
        <ApiKeyModal
          provider={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </>
  );
}

function IntegrationCard({
  view,
  onEdit,
  onTest,
  onRemove,
}: {
  view: IntegrationView;
  onEdit: () => void;
  onTest: () => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [msg, setMsg] = useState('');

  const tone = view.status === 'configured' ? 'ok' : view.status === 'error' ? 'bad' : 'idle';

  async function runTest() {
    setTestState('testing');
    setMsg('');
    try {
      await onTest();
      setTestState('ok');
      setMsg('test passed');
    } catch (err) {
      setTestState('error');
      setMsg(err instanceof ApiError ? err.message : 'test failed');
    }
  }

  return (
    <Card className="mb-3">
      <CardHeader>
        <span className="flex min-w-0 items-center gap-2">
          <StatusDot tone={tone} />
          <CardTitle>{PROVIDER_LABEL[view.provider] ?? view.provider}</CardTitle>
        </span>
        <span className="text-xs text-ink-faint">
          {view.configured ? `source: ${view.source}` : 'not configured'}
        </span>
      </CardHeader>
      <CardBody>
        {view.configured ? (
          <div className="space-y-1 text-sm text-ink-muted">
            {view.provider === 'twilio' ? (
              <>
                {view.metadata.sid_masked != null && <div>SID {String(view.metadata.sid_masked)}</div>}
                {view.metadata.from_number != null && <div>From {String(view.metadata.from_number)}</div>}
                {view.metadata.has_messaging_service ? <div>Messaging Service configured</div> : null}
              </>
            ) : (
              view.metadata.key_masked != null && <div>Key {String(view.metadata.key_masked)}</div>
            )}
            {view.last_error && <div className="text-danger">{view.last_error}</div>}
          </div>
        ) : (
          <p className="text-sm text-ink-faint">Add credentials to enable this provider.</p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={onEdit}>
            {view.configured ? 'Edit' : 'Configure'}
          </Button>
          {view.configured && (
            <>
              <Button size="sm" variant="ghost" onClick={runTest} disabled={testState === 'testing'}>
                {testState === 'testing' ? 'Testing…' : 'Test'}
              </Button>
              {view.source === 'db' && (
                <Button size="sm" variant="danger" onClick={() => void onRemove()}>
                  Remove
                </Button>
              )}
            </>
          )}
          {testState !== 'idle' && testState !== 'testing' && (
            <InlineNote tone={testState === 'ok' ? 'ok' : 'bad'}>{msg}</InlineNote>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function EmailCard({
  account,
  loading,
  onChanged,
}: {
  account: EmailAccountView | null;
  loading: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const tone = account?.imap_status === 'live' ? 'ok' : account?.imap_status === 'error' ? 'bad' : 'idle';
  return (
    <Card className="mb-3">
      <CardHeader>
        <span className="flex min-w-0 items-center gap-2">
          <StatusDot tone={tone} />
          <CardTitle>Email account</CardTitle>
        </span>
        <span className="text-xs text-ink-faint">{account ? account.provider : 'not configured'}</span>
      </CardHeader>
      <CardBody>
        {loading && <Spinner />}
        {!loading && account && (
          <div className="space-y-1 text-sm text-ink-muted">
            <div>{account.email_address}</div>
            <div>IMAP {account.imap_host} · status: {account.imap_status}</div>
            {account.last_synced_at && <div>last sync {account.last_synced_at}</div>}
            {account.last_error && <div className="text-danger">{account.last_error}</div>}
          </div>
        )}
        {!loading && !account && <p className="text-sm text-ink-faint">No email account connected.</p>}
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            {account ? 'Edit' : 'Connect'}
          </Button>
          {account && (
            <Button
              size="sm"
              variant="danger"
              onClick={async () => {
                await apiDelete('/api/email-account');
                onChanged();
              }}
            >
              Disconnect
            </Button>
          )}
        </div>
      </CardBody>
      {editing && (
        <EmailModal
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChanged();
          }}
        />
      )}
    </Card>
  );
}

/* --- Modals --------------------------------------------------------------- */
function TwilioModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ sid: '', token: '', from_number: '', messaging_service_sid: '' });
  const [err, setErr] = useState('');
  const save = useMutation({
    mutationFn: () =>
      apiPut('/api/integrations', {
        provider: 'twilio',
        sid: f.sid.trim(),
        token: f.token.trim(),
        from_number: f.from_number.trim() || undefined,
        messaging_service_sid: f.messaging_service_sid.trim() || undefined,
      }),
    onSuccess: onSaved,
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'save failed'),
  });
  return (
    <Modal open onClose={onClose} title="Twilio credentials">
      <Field label="Account SID">
        <Input value={f.sid} onChange={(e) => setF({ ...f, sid: e.target.value })} placeholder="AC…" />
      </Field>
      <Field label="Auth Token">
        <Input type="password" value={f.token} onChange={(e) => setF({ ...f, token: e.target.value })} />
      </Field>
      <Field label="Messaging Service SID" hint="recommended; or use a From number">
        <Input value={f.messaging_service_sid} onChange={(e) => setF({ ...f, messaging_service_sid: e.target.value })} placeholder="MG…" />
      </Field>
      <Field label="From number (E.164)">
        <Input value={f.from_number} onChange={(e) => setF({ ...f, from_number: e.target.value })} placeholder="+1…" />
      </Field>
      {err && <InlineNote tone="bad">{err}</InlineNote>}
      <Button variant="primary" className="mt-3 w-full" disabled={!f.sid.trim() || !f.token.trim() || save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? 'Saving…' : 'Save'}
      </Button>
    </Modal>
  );
}

function ApiKeyModal({ provider, onClose, onSaved }: { provider: string; onClose: () => void; onSaved: () => void }) {
  const [key, setKey] = useState('');
  const [err, setErr] = useState('');
  const save = useMutation({
    mutationFn: () => apiPut('/api/integrations', { provider, api_key: key.trim() }),
    onSuccess: onSaved,
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'save failed'),
  });
  return (
    <Modal open onClose={onClose} title={`${PROVIDER_LABEL[provider] ?? provider} API key`}>
      <Field label="API key">
        <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="paste key" />
      </Field>
      {err && <InlineNote tone="bad">{err}</InlineNote>}
      <Button variant="primary" className="mt-3 w-full" disabled={!key.trim() || save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? 'Saving…' : 'Save'}
      </Button>
    </Modal>
  );
}

function EmailModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    provider: 'gmail' as 'gmail' | 'outlook' | 'icloud' | 'custom',
    email_address: '',
    password: '',
    smtp_host: '',
    smtp_port: '',
    imap_host: '',
    imap_port: '',
  });
  const [err, setErr] = useState('');
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        provider: f.provider,
        email_address: f.email_address.trim(),
        password: f.password.trim(),
      };
      if (f.provider === 'custom') {
        body.smtp_host = f.smtp_host.trim();
        body.smtp_port = Number(f.smtp_port) || undefined;
        body.smtp_security = 'ssl';
        body.imap_host = f.imap_host.trim();
        body.imap_port = Number(f.imap_port) || undefined;
        body.imap_security = 'ssl';
      }
      return apiPut('/api/email-account', body);
    },
    onSuccess: onSaved,
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'save failed'),
  });
  return (
    <Modal open onClose={onClose} title="Email account">
      <Field label="Provider">
        <div className="grid grid-cols-2 gap-1.5 xs:grid-cols-3 sm:grid-cols-4">
          {(['gmail', 'outlook', 'icloud', 'custom'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setF({ ...f, provider: p })}
              className={`rounded-lg border px-2 py-1.5 text-xs capitalize ${
                f.provider === p ? 'border-phos/50 bg-phos/10 text-phos' : 'border-line text-ink-muted'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Email address">
        <Input value={f.email_address} onChange={(e) => setF({ ...f, email_address: e.target.value })} />
      </Field>
      <Field label={f.provider === 'custom' ? 'Password' : 'App password'}>
        <Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
      </Field>
      {f.provider === 'custom' && (
        <div className="grid grid-cols-1 gap-2 xs:grid-cols-2">
          <Field label="SMTP host">
            <Input value={f.smtp_host} onChange={(e) => setF({ ...f, smtp_host: e.target.value })} />
          </Field>
          <Field label="SMTP port">
            <Input value={f.smtp_port} onChange={(e) => setF({ ...f, smtp_port: e.target.value })} placeholder="465" />
          </Field>
          <Field label="IMAP host">
            <Input value={f.imap_host} onChange={(e) => setF({ ...f, imap_host: e.target.value })} />
          </Field>
          <Field label="IMAP port">
            <Input value={f.imap_port} onChange={(e) => setF({ ...f, imap_port: e.target.value })} placeholder="993" />
          </Field>
        </div>
      )}
      {err && <InlineNote tone="bad">{err}</InlineNote>}
      <Button
        variant="primary"
        className="mt-3 w-full"
        disabled={!f.email_address.trim() || !f.password.trim() || save.isPending}
        onClick={() => save.mutate()}
      >
        {save.isPending ? 'Connecting…' : 'Connect'}
      </Button>
    </Modal>
  );
}
