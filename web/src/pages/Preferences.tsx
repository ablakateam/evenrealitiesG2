import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  PageHeading,
  Spinner,
  Switch,
  Select,
  Input,
  InlineNote,
} from '@/components/ui';
import { apiGet, apiPut } from '@/lib/api';

interface Prefs {
  default_channel: string;
  default_tone: string;
  always_grammar_fix: boolean;
  rewrite_provider: string;
  rewrite_model: string;
  voice_language: string;
  confirm_before_send: boolean;
  smart_channel_inference: boolean;
  smart_idle: boolean;
  smart_pause: boolean;
  tone_memory_per_contact: boolean;
  long_press_send_last: boolean;
  always_on_voice: boolean;
  max_recording_seconds: number;
  silence_autostop_seconds: number;
  notify_on_sms: boolean;
  notify_on_email: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  sender_filter: string;
  daily_sms_limit: number;
  daily_email_limit: number;
  daily_token_limit: number;
}

export function Preferences() {
  const qc = useQueryClient();
  const config = useQuery({
    queryKey: ['config'],
    queryFn: () => apiGet<{ preferences: Prefs }>('/api/config'),
  });
  const [local, setLocal] = useState<Prefs | null>(null);
  const [savedNote, setSavedNote] = useState('');

  useEffect(() => {
    if (config.data) setLocal(config.data.preferences);
  }, [config.data]);

  const save = useMutation({
    mutationFn: (patch: Partial<Prefs>) => apiPut<{ preferences: Prefs }>('/api/config', patch),
    onSuccess: (res) => {
      setLocal(res.preferences);
      qc.setQueryData(['config'], res);
      setSavedNote('saved');
      setTimeout(() => setSavedNote(''), 1200);
    },
  });

  function set<K extends keyof Prefs>(key: K, value: Prefs[K]) {
    if (!local) return;
    setLocal({ ...local, [key]: value });
    save.mutate({ [key]: value } as Partial<Prefs>);
  }

  if (config.isLoading || !local) {
    return (
      <>
        <PageHeading eyebrow="Behaviour" title="Preferences" />
        <Spinner />
      </>
    );
  }

  return (
    <>
      <PageHeading title="Preferences" subtitle="Voice, AI, notifications, and smart features" />
      {savedNote && (
        <div className="mb-3">
          <InlineNote tone="ok">{savedNote}</InlineNote>
        </div>
      )}

      {/* Voice & AI */}
      <Section title="Voice & AI">
        <Row label="Default channel">
          <Select
            value={local.default_channel}
            onChange={(v) => set('default_channel', v)}
            options={[
              { value: 'sms', label: 'SMS' },
              { value: 'email', label: 'Email' },
              { value: 'smart', label: 'Smart (last used)' },
            ]}
          />
        </Row>
        <Row label="Default tone">
          <Select
            value={local.default_tone}
            onChange={(v) => set('default_tone', v)}
            options={['casual', 'professional', 'friendly', 'formal', 'sarcastic', 'grammar', 'original'].map((t) => ({
              value: t,
              label: t[0]!.toUpperCase() + t.slice(1),
            }))}
          />
        </Row>
        <Row label="Always apply grammar-fix">
          <Switch checked={local.always_grammar_fix} onChange={(v) => set('always_grammar_fix', v)} label="always grammar fix" />
        </Row>
        <Row label="Rewrite provider">
          <Select
            value={local.rewrite_provider}
            onChange={(v) => set('rewrite_provider', v)}
            options={[
              { value: 'anthropic', label: 'Anthropic' },
              { value: 'openai', label: 'OpenAI' },
              { value: 'openrouter', label: 'OpenRouter' },
              { value: 'ollama-cloud', label: 'Ollama Cloud' },
            ]}
          />
        </Row>
        <Row label="Rewrite model">
          <Input value={local.rewrite_model} onChange={(e) => set('rewrite_model', e.target.value)} className="w-48" />
        </Row>
        <Row label="Voice language">
          <Input value={local.voice_language} onChange={(e) => set('voice_language', e.target.value)} className="w-32" />
        </Row>
        <Row label="Confirm before send">
          <Switch checked={local.confirm_before_send} onChange={(v) => set('confirm_before_send', v)} label="confirm before send" />
        </Row>
        <Row label="Smart channel inference">
          <Switch checked={local.smart_channel_inference} onChange={(v) => set('smart_channel_inference', v)} label="smart channel inference" />
        </Row>
      </Section>

      {/* Voice input */}
      <Section title="Voice input">
        <Row label="Max recording (seconds)">
          <Select
            value={String(local.max_recording_seconds)}
            onChange={(v) => set('max_recording_seconds', Number(v))}
            options={[30, 60, 120].map((n) => ({ value: String(n), label: `${n}s` }))}
          />
        </Row>
        <Row label="Auto-stop on silence (seconds)">
          <Select
            value={String(local.silence_autostop_seconds)}
            onChange={(v) => set('silence_autostop_seconds', Number(v))}
            options={[0, 2, 4, 8].map((n) => ({ value: String(n), label: n === 0 ? 'off' : `${n}s` }))}
          />
        </Row>
        <Row label="Always-on voice while in foreground">
          <Switch checked={local.always_on_voice} onChange={(v) => set('always_on_voice', v)} label="always on voice" />
        </Row>
      </Section>

      {/* Smart features */}
      <Section title="Smart features">
        <Row label="Smart Idle suggestions">
          <Switch checked={local.smart_idle} onChange={(v) => set('smart_idle', v)} label="smart idle" />
        </Row>
        <Row label="Smart Pause auto-send">
          <Switch checked={local.smart_pause} onChange={(v) => set('smart_pause', v)} label="smart pause" />
        </Row>
        <Row label="Tone memory per contact">
          <Switch checked={local.tone_memory_per_contact} onChange={(v) => set('tone_memory_per_contact', v)} label="tone memory per contact" />
        </Row>
        <Row label="Long-press = send last to last">
          <Switch checked={local.long_press_send_last} onChange={(v) => set('long_press_send_last', v)} label="long press send last" />
        </Row>
      </Section>

      {/* Notifications */}
      <Section title="Notifications">
        <Row label="Notify on new SMS">
          <Switch checked={local.notify_on_sms} onChange={(v) => set('notify_on_sms', v)} label="notify on sms" />
        </Row>
        <Row label="Notify on new email">
          <Switch checked={local.notify_on_email} onChange={(v) => set('notify_on_email', v)} label="notify on email" />
        </Row>
        <Row label="Quiet hours start">
          <Input
            value={local.quiet_hours_start ?? ''}
            onChange={(e) => set('quiet_hours_start', e.target.value || null)}
            placeholder="22:00"
            className="w-28"
          />
        </Row>
        <Row label="Quiet hours end">
          <Input
            value={local.quiet_hours_end ?? ''}
            onChange={(e) => set('quiet_hours_end', e.target.value || null)}
            placeholder="07:00"
            className="w-28"
          />
        </Row>
        <Row label="Sender filter">
          <Select
            value={local.sender_filter}
            onChange={(v) => set('sender_filter', v)}
            options={[
              { value: 'anyone', label: 'Anyone' },
              { value: 'contacts', label: 'Contacts only' },
              { value: 'favorites', label: 'Favorites only' },
            ]}
          />
        </Row>
      </Section>

      {/* Cost guardrails */}
      <Section title="Cost guardrails">
        <Row label="Daily SMS limit">
          <Input
            type="number"
            value={local.daily_sms_limit}
            onChange={(e) => set('daily_sms_limit', Number(e.target.value))}
            className="w-28"
          />
        </Row>
        <Row label="Daily email limit">
          <Input
            type="number"
            value={local.daily_email_limit}
            onChange={(e) => set('daily_email_limit', Number(e.target.value))}
            className="w-28"
          />
        </Row>
        <Row label="Daily AI-token limit">
          <Input
            type="number"
            value={local.daily_token_limit}
            onChange={(e) => set('daily_token_limit', Number(e.target.value))}
            className="w-32"
          />
        </Row>
      </Section>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="mb-3">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">{children}</CardBody>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="text-sm text-ink-muted">{label}</span>
      {/* Only inputs and selects stretch. Scoping this with [&>input] and
          [&>select] rather than [&>*] matters: the blanket rule was making
          the Switch 332px wide, so its hit area swallowed the whole row. */}
      <div className="flex w-full justify-start sm:w-auto sm:justify-end [&>input]:w-full [&>select]:w-full sm:[&>input]:w-auto sm:[&>select]:w-auto">
        {children}
      </div>
    </div>
  );
}
