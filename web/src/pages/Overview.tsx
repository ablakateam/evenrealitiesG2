import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowUpRight, ArrowDownLeft, ArrowRight } from 'lucide-react';
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  PageHeading,
  Spinner,
  StatusDot,
  EmptyState,
} from '@/components/ui';
import {
  apiGet,
  type HealthResponse,
  type HistoryStats,
  type HistoryItem,
  type IntegrationView,
} from '@/lib/api';

export function Overview() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => apiGet<HealthResponse>('/api/health'),
  });
  const stats = useQuery({
    queryKey: ['history-stats'],
    queryFn: () => apiGet<HistoryStats>('/api/history/stats'),
  });
  const recent = useQuery({
    queryKey: ['history-recent'],
    queryFn: () => apiGet<{ items: HistoryItem[] }>('/api/history?limit=6'),
  });
  const integrations = useQuery({
    queryKey: ['integrations'],
    queryFn: () => apiGet<{ integrations: IntegrationView[] }>('/api/integrations'),
  });

  // "Setup incomplete" if Twilio or no AI provider is configured.
  const unconfigured = integrations.data?.integrations.filter((i) => !i.configured) ?? [];
  const needsSetup =
    integrations.data &&
    (unconfigured.some((i) => i.provider === 'twilio') ||
      !integrations.data.integrations.some(
        (i) => ['openai', 'anthropic', 'openrouter', 'ollama-cloud'].includes(i.provider) && i.configured,
      ));

  return (
    <>
      <PageHeading eyebrow="Ground station" title="Overview" subtitle="VOX server status and recent activity" />

      {needsSetup && (
        <Link
          to="/setup"
          className="mb-4 flex w-full items-center justify-between gap-3 rounded-card border border-phos/30 bg-phos/5 px-4 py-3 text-left transition-colors hover:bg-phos/10"
        >
          <span className="text-sm text-ink">
            <span className="font-medium text-phos">Finish setup</span> — some integrations aren't connected yet.
          </span>
          <ArrowRight size={16} className="text-phos" />
        </Link>
      )}

      {/* Status block — the one surface that is genuinely live, so it is
          the one that carries the trace. */}
      <Card className="mb-4 animate-rise" live={health.data !== undefined && !health.isError}>
        <CardHeader>
          <CardTitle>Status</CardTitle>
          {health.data && (
            <span className="text-xs text-ink-faint">
              schema v{health.data.schema_version} · {health.data.node}
            </span>
          )}
        </CardHeader>
        <CardBody>
          {health.isLoading && <Spinner />}
          {health.isError && <p className="text-sm text-danger">Server unreachable.</p>}
          {health.data && (
            <div className="flex items-center gap-2 font-mono text-[13px]">
              <StatusDot tone="ok" live />
              <span className="text-ink">vox-server</span>
              <span className="text-ink-faint">·</span>
              <span className="text-ink-muted">
                up {formatUptime(health.data.uptime_seconds)}
              </span>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Today block */}
      <Card className="mb-4 animate-rise [animation-delay:60ms]">
        <CardHeader>
          <CardTitle>Today</CardTitle>
        </CardHeader>
        <CardBody>
          {stats.isLoading && <Spinner />}
          {stats.data && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
              <Stat label="Sent" value={stats.data.sent.today} />
              <Stat label="Failed" value={stats.data.failed.today} tone={stats.data.failed.today > 0 ? 'bad' : 'idle'} />
              <Stat label="Received" value={stats.data.received.today} />
              <Stat label="Total sent" value={stats.data.sent.total} />
              <Stat label="Tokens today" value={stats.data.tokens.today} />
              <Stat
                label="Cost (30d)"
                value={`$${(stats.data.cost_cents.last_30d / 100).toFixed(2)}`}
              />
            </div>
          )}
        </CardBody>
      </Card>

      {/* Recent activity */}
      <Card className="animate-rise [animation-delay:120ms]">
        <CardHeader>
          <CardTitle>Recent</CardTitle>
        </CardHeader>
        <CardBody>
          {recent.isLoading && <Spinner />}
          {recent.data && recent.data.items.length === 0 && (
            <EmptyState>No activity yet — your first send will appear here.</EmptyState>
          )}
          {recent.data && recent.data.items.length > 0 && (
            <ul className="divide-y divide-line">
              {recent.data.items.map((item) => (
                <li key={item.id} className="py-2.5 text-sm">
                  <div className="flex items-center gap-2">
                    {item.direction === 'out' ? (
                      <ArrowUpRight size={15} className="shrink-0 text-ink-faint" />
                    ) : (
                      <ArrowDownLeft size={15} className="shrink-0 text-phos" />
                    )}
                    <span className="eyebrow shrink-0">{item.channel}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink-muted">
                      {item.contact_name ?? '—'}
                    </span>
                    <StatusBadge status={item.status} />
                  </div>
                  <p className="mt-1 line-clamp-2 break-words pl-[23px] text-ink">
                    {item.subject ?? item.body}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  );
}

function Stat({
  label,
  value,
  tone = 'idle',
}: {
  label: string;
  value: number | string;
  tone?: 'idle' | 'bad';
}) {
  return (
    <div className="min-w-0">
      {/* Display face + tabular figures: these are readings, and readings
          should not reflow as their digits change. */}
      <div
        className={`tabular font-display text-[22px] font-600 leading-none tracking-tight ${
          tone === 'bad' ? 'text-danger' : 'text-ink'
        }`}
      >
        {value}
      </div>
      <div className="eyebrow mt-2 truncate">{label}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const ok = ['sent', 'delivered', 'queued'].includes(status);
  const bad = ['failed', 'undelivered'].includes(status);
  return (
    <span
      className={`shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] ${
        ok ? 'text-phos' : bad ? 'text-danger' : 'text-ink-faint'
      }`}
    >
      {status}
    </span>
  );
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
}
