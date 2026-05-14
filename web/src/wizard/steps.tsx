import { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { Check, Loader2, ExternalLink } from 'lucide-react';
import { Button, Input, Card, CardBody } from '@/components/ui';
import { apiPut, apiPost, ApiError } from '@/lib/api';
import { readSecret } from '@/lib/auth';

/* ----------------------------------------------------------------------------
 * Shared bits
 * -------------------------------------------------------------------------- */
type TestState = { status: 'idle' | 'testing' | 'ok' | 'error'; message?: string };

function TestResult({ state }: { state: TestState }) {
  if (state.status === 'idle') return null;
  if (state.status === 'testing')
    return (
      <p className="mt-2 flex items-center gap-2 text-xs text-ink-muted">
        <Loader2 size={13} className="animate-spin" /> testing…
      </p>
    );
  if (state.status === 'ok')
    return (
      <p className="mt-2 flex items-center gap-2 text-xs text-phos">
        <Check size={13} /> {state.message ?? 'works'}
      </p>
    );
  return <p className="mt-2 text-xs text-danger">{state.message ?? 'failed'}</p>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <label className="mb-1 block text-xs font-medium text-ink-muted">{label}</label>
      {children}
    </div>
  );
}

interface StepProps {
  onNext: () => void;
  onSkip?: () => void;
}

/* ----------------------------------------------------------------------------
 * Step 1 — Welcome
 * -------------------------------------------------------------------------- */
export function StepWelcome({ onNext }: StepProps) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-ink">Let's set up VOX</h2>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">
        A few quick connections and you'll be sending SMS + email from your G2,
        hands-free. You'll wire up:
      </p>
      <ul className="mt-4 space-y-2 text-sm text-ink">
        {[
          'Twilio — for sending and receiving SMS',
          'An email account — Gmail, Outlook, iCloud, or any IMAP/SMTP',
          'An AI provider — for voice transcription and tone rewrites',
          'Contacts — import a CSV or add a few by hand',
        ].map((line) => (
          <li key={line} className="flex items-start gap-2">
            <span className="dot dot-ok mt-1.5" />
            {line}
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-ink-faint">Takes about 3 minutes. You can skip steps and come back.</p>
      <Button variant="primary" className="mt-6 w-full" onClick={onNext}>
        Get started →
      </Button>
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * Step 2 — Twilio
 * -------------------------------------------------------------------------- */
export function StepTwilio({ onNext, onSkip }: StepProps) {
  const [sid, setSid] = useState('');
  const [token, setToken] = useState('');
  const [from, setFrom] = useState('');
  const [msgSid, setMsgSid] = useState('');
  const [test, setTest] = useState<TestState>({ status: 'idle' });
  const [testTo, setTestTo] = useState('');

  async function saveAndContinue() {
    setTest({ status: 'testing' });
    try {
      await apiPut('/api/integrations', {
        provider: 'twilio',
        sid: sid.trim(),
        token: token.trim(),
        from_number: from.trim() || undefined,
        messaging_service_sid: msgSid.trim() || undefined,
      });
      // If a test number was given, fire a real SMS; otherwise just confirm save.
      if (testTo.trim()) {
        await apiPost('/api/integrations/twilio/test', { to: testTo.trim() });
        setTest({ status: 'ok', message: `test SMS sent to ${testTo.trim()}` });
      } else {
        setTest({ status: 'ok', message: 'credentials saved' });
      }
      setTimeout(onNext, 700);
    } catch (err) {
      setTest({ status: 'error', message: err instanceof ApiError ? err.message : 'save failed' });
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-ink">Connect Twilio</h2>
      <p className="mb-4 mt-1 text-sm text-ink-muted">Powers SMS send + receive.</p>
      <Field label="Account SID">
        <Input value={sid} onChange={(e) => setSid(e.target.value)} placeholder="AC…" />
      </Field>
      <Field label="Auth Token">
        <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="••••••••" />
      </Field>
      <Field label="Messaging Service SID (recommended)">
        <Input value={msgSid} onChange={(e) => setMsgSid(e.target.value)} placeholder="MG… (or use a From number below)" />
      </Field>
      <Field label="From number (E.164)">
        <Input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="+1…" />
      </Field>
      <Field label="Send a test SMS to (optional)">
        <Input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="+1… your phone, to verify" />
      </Field>
      <TestResult state={test} />
      <div className="mt-5 flex gap-2">
        <Button
          variant="primary"
          className="flex-1"
          disabled={!sid.trim() || !token.trim() || test.status === 'testing'}
          onClick={saveAndContinue}
        >
          {testTo.trim() ? 'Test & continue →' : 'Save & continue →'}
        </Button>
        {onSkip && (
          <Button variant="ghost" onClick={onSkip}>
            Skip
          </Button>
        )}
      </div>
      <a
        href="https://console.twilio.com"
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-flex items-center gap-1 text-xs text-ink-faint hover:text-ink-muted"
      >
        Don't have Twilio? Open the console <ExternalLink size={11} />
      </a>
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * Step 3 — Email (custom IMAP/SMTP; OAuth one-click is a later release)
 * -------------------------------------------------------------------------- */
export function StepEmail({ onNext, onSkip }: StepProps) {
  const [provider, setProvider] = useState<'gmail' | 'outlook' | 'icloud' | 'custom'>('gmail');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [custom, setCustom] = useState({ smtp_host: '', smtp_port: '', imap_host: '', imap_port: '' });
  const [test, setTest] = useState<TestState>({ status: 'idle' });

  async function saveAndContinue() {
    setTest({ status: 'testing' });
    try {
      const body: Record<string, unknown> = { provider, email_address: email.trim(), password: password.trim() };
      if (provider === 'custom') {
        body.smtp_host = custom.smtp_host.trim();
        body.smtp_port = Number(custom.smtp_port) || undefined;
        body.smtp_security = 'ssl';
        body.imap_host = custom.imap_host.trim();
        body.imap_port = Number(custom.imap_port) || undefined;
        body.imap_security = 'ssl';
      }
      await apiPut('/api/email-account', body);
      await apiPost('/api/email-account/test', {});
      setTest({ status: 'ok', message: 'email account connected' });
      setTimeout(onNext, 700);
    } catch (err) {
      setTest({ status: 'error', message: err instanceof ApiError ? err.message : 'connection failed' });
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-ink">Connect your email</h2>
      <p className="mb-4 mt-1 text-sm leading-relaxed text-ink-muted">
        Sends from your real account — sent mail lands in your normal Sent
        folder, replies arrive in your normal inbox.
      </p>
      <Field label="Provider">
        <div className="grid grid-cols-4 gap-1.5">
          {(['gmail', 'outlook', 'icloud', 'custom'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setProvider(p)}
              className={`rounded-lg border px-2 py-2 text-xs capitalize transition-colors ${
                provider === p
                  ? 'border-phos/50 bg-phos/10 text-phos'
                  : 'border-line text-ink-muted hover:border-line-strong'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Email address">
        <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
      </Field>
      <Field label={provider === 'custom' ? 'Password' : 'App password'}>
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
      </Field>
      {provider !== 'custom' && provider !== 'icloud' && (
        <p className="-mt-1 mb-3 text-xs text-ink-faint">
          {provider === 'gmail' ? 'Gmail' : 'Outlook'} needs an app password — enable 2FA, then create one in
          your account security settings.
        </p>
      )}
      {provider === 'custom' && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="SMTP host">
            <Input value={custom.smtp_host} onChange={(e) => setCustom({ ...custom, smtp_host: e.target.value })} placeholder="smtp.example.com" />
          </Field>
          <Field label="SMTP port">
            <Input value={custom.smtp_port} onChange={(e) => setCustom({ ...custom, smtp_port: e.target.value })} placeholder="465" />
          </Field>
          <Field label="IMAP host">
            <Input value={custom.imap_host} onChange={(e) => setCustom({ ...custom, imap_host: e.target.value })} placeholder="imap.example.com" />
          </Field>
          <Field label="IMAP port">
            <Input value={custom.imap_port} onChange={(e) => setCustom({ ...custom, imap_port: e.target.value })} placeholder="993" />
          </Field>
        </div>
      )}
      <TestResult state={test} />
      <div className="mt-5 flex gap-2">
        <Button
          variant="primary"
          className="flex-1"
          disabled={!email.trim() || !password.trim() || test.status === 'testing'}
          onClick={saveAndContinue}
        >
          Connect & continue →
        </Button>
        {onSkip && (
          <Button variant="ghost" onClick={onSkip}>
            Skip
          </Button>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * Step 4 — AI provider
 * -------------------------------------------------------------------------- */
export function StepAI({ onNext, onSkip }: StepProps) {
  const [openai, setOpenai] = useState('');
  const [anthropic, setAnthropic] = useState('');
  const [test, setTest] = useState<TestState>({ status: 'idle' });

  async function saveAndContinue() {
    setTest({ status: 'testing' });
    try {
      if (openai.trim()) {
        await apiPut('/api/integrations', { provider: 'openai', api_key: openai.trim() });
        await apiPost('/api/integrations/openai/test', {});
      }
      if (anthropic.trim()) {
        await apiPut('/api/integrations', { provider: 'anthropic', api_key: anthropic.trim() });
        await apiPost('/api/integrations/anthropic/test', {});
      }
      setTest({ status: 'ok', message: 'AI provider connected' });
      setTimeout(onNext, 700);
    } catch (err) {
      setTest({ status: 'error', message: err instanceof ApiError ? err.message : 'test failed' });
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-ink">Connect an AI provider</h2>
      <p className="mb-4 mt-1 text-sm leading-relaxed text-ink-muted">
        OpenAI is required — it powers Whisper voice transcription. Anthropic is
        optional; it's an alternative for the tone rewrites.
      </p>
      <Field label="OpenAI API key (required)">
        <Input type="password" value={openai} onChange={(e) => setOpenai(e.target.value)} placeholder="sk-…" />
      </Field>
      <Field label="Anthropic API key (optional)">
        <Input type="password" value={anthropic} onChange={(e) => setAnthropic(e.target.value)} placeholder="sk-ant-…" />
      </Field>
      <TestResult state={test} />
      <div className="mt-5 flex gap-2">
        <Button
          variant="primary"
          className="flex-1"
          disabled={!openai.trim() || test.status === 'testing'}
          onClick={saveAndContinue}
        >
          Test & continue →
        </Button>
        {onSkip && (
          <Button variant="ghost" onClick={onSkip}>
            Skip
          </Button>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * Step 5 — Contacts
 * -------------------------------------------------------------------------- */
export function StepContacts({ onNext, onSkip }: StepProps) {
  const [mode, setMode] = useState<'csv' | 'manual'>('csv');
  const [csv, setCsv] = useState('');
  const [manual, setManual] = useState({ name: '', phone: '', email: '' });
  const [test, setTest] = useState<TestState>({ status: 'idle' });

  async function importCsv() {
    setTest({ status: 'testing' });
    try {
      const res = await apiPost<{ inserted: number; parsed: number }>('/api/contacts/csv', { csv: csv.trim() });
      setTest({ status: 'ok', message: `imported ${res.inserted} of ${res.parsed} contacts` });
      setTimeout(onNext, 900);
    } catch (err) {
      setTest({ status: 'error', message: err instanceof ApiError ? err.message : 'import failed' });
    }
  }

  async function addManual() {
    setTest({ status: 'testing' });
    try {
      await apiPost('/api/contacts', {
        name: manual.name.trim(),
        phone: manual.phone.trim() || undefined,
        email: manual.email.trim() || undefined,
      });
      setTest({ status: 'ok', message: `added ${manual.name.trim()}` });
      setManual({ name: '', phone: '', email: '' });
    } catch (err) {
      setTest({ status: 'error', message: err instanceof ApiError ? err.message : 'add failed' });
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-ink">Add your contacts</h2>
      <p className="mb-4 mt-1 text-sm text-ink-muted">Import a CSV, or add a few by hand to get started.</p>
      <div className="mb-4 grid grid-cols-2 gap-1.5">
        {(['csv', 'manual'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-lg border px-3 py-2 text-xs capitalize transition-colors ${
              mode === m ? 'border-phos/50 bg-phos/10 text-phos' : 'border-line text-ink-muted hover:border-line-strong'
            }`}
          >
            {m === 'csv' ? 'Import CSV' : 'Add by hand'}
          </button>
        ))}
      </div>

      {mode === 'csv' ? (
        <>
          <Field label="CSV (header row: name, phone, email)">
            <textarea
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              rows={6}
              placeholder={'name,phone,email\nAlex Morgan,+14155550142,alex@example.com'}
              className="w-full rounded-lg border border-line bg-bg-inset px-3 py-2 font-mono text-xs text-ink placeholder:text-ink-faint focus:border-phos/50 focus:outline-none focus:ring-1 focus:ring-phos/30"
            />
          </Field>
          <TestResult state={test} />
          <div className="mt-4 flex gap-2">
            <Button variant="primary" className="flex-1" disabled={!csv.trim() || test.status === 'testing'} onClick={importCsv}>
              Import & continue →
            </Button>
            {onSkip && (
              <Button variant="ghost" onClick={onSkip}>
                Skip
              </Button>
            )}
          </div>
        </>
      ) : (
        <>
          <Field label="Name">
            <Input value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} placeholder="Alex Morgan" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Phone">
              <Input value={manual.phone} onChange={(e) => setManual({ ...manual, phone: e.target.value })} placeholder="+1…" />
            </Field>
            <Field label="Email">
              <Input value={manual.email} onChange={(e) => setManual({ ...manual, email: e.target.value })} placeholder="alex@…" />
            </Field>
          </div>
          <TestResult state={test} />
          <div className="mt-4 flex gap-2">
            <Button
              variant="outline"
              disabled={!manual.name.trim() || (!manual.phone.trim() && !manual.email.trim())}
              onClick={addManual}
            >
              + Add
            </Button>
            <Button variant="primary" className="flex-1" onClick={onNext}>
              Continue →
            </Button>
            {onSkip && (
              <Button variant="ghost" onClick={onSkip}>
                Skip
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * Step 6 — Done + pairing QR
 * -------------------------------------------------------------------------- */
export function StepDone({ onFinish }: { onFinish: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);

  // The pairing payload — server origin + the shared secret. The HUD app
  // consumes this on first launch (wired in a later phase).
  const payload = JSON.stringify({
    server: window.location.origin,
    secret: readSecret() ?? '',
  });

  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, payload, {
        width: 200,
        margin: 1,
        color: { dark: '#39ff6a', light: '#0a0b0d' },
      }).catch(() => {
        /* canvas render failure is non-fatal — copy-as-text still works */
      });
    }
  }, [payload]);

  return (
    <div className="text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-phos/10">
        <Check size={24} className="text-phos" />
      </div>
      <h2 className="text-lg font-semibold text-ink">You're set up</h2>
      <p className="mb-5 mt-1 text-sm text-ink-muted">
        Scan this on your glasses to pair, then put them on and try a voice message.
      </p>
      <div className="mx-auto mb-4 w-fit rounded-card border border-line bg-bg-inset p-3">
        <canvas ref={canvasRef} />
      </div>
      <button
        onClick={() => {
          navigator.clipboard?.writeText(payload).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="text-xs text-ink-faint hover:text-ink-muted"
      >
        {copied ? 'copied ✓' : 'copy pairing code as text'}
      </button>
      <Button variant="primary" className="mt-6 w-full" onClick={onFinish}>
        Go to dashboard →
      </Button>
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * Re-export a small card wrapper used by the shell
 * -------------------------------------------------------------------------- */
export { Card, CardBody };
