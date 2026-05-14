import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, ArrowDownLeft } from 'lucide-react';
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
import { apiGet, type HealthResponse, type HistoryStats, type HistoryItem } from '@/lib/api';

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

  return (
    <>
      <PageHeading title="Overview" subtitle="VOX server status and recent activity" />

      {/* Status block */}
      <Card className="mb-4">
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
            <div className="flex items-center gap-2 text-sm">
              <StatusDot tone="ok" />
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
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Today</CardTitle>
        </CardHeader>
        <CardBody>
          {stats.isLoading && <Spinner />}
          {stats.data && (
            <div className="grid grid-cols-3 gap-4">
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
      <Card>
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
                <li key={item.id} className="flex items-center gap-3 py-2.5 text-sm">
                  {item.direction === 'out' ? (
                    <ArrowUpRight size={15} className="shrink-0 text-ink-faint" />
                  ) : (
                    <ArrowDownLeft size={15} className="shrink-0 text-phos" />
                  )}
                  <span className="w-12 shrink-0 text-xs uppercase text-ink-faint">{item.channel}</span>
                  <span className="shrink-0 text-ink-muted">{item.contact_name ?? '—'}</span>
                  <span className="flex-1 truncate text-ink">{item.subject ?? item.body}</span>
                  <StatusBadge status={item.status} />
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
    <div>
      <div className={`text-2xl font-semibold ${tone === 'bad' ? 'text-danger' : 'text-ink'}`}>
        {value}
      </div>
      <div className="mt-0.5 text-xs text-ink-muted">{label}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const ok = ['sent', 'delivered', 'queued'].includes(status);
  const bad = ['failed', 'undelivered'].includes(status);
  return (
    <span
      className={`shrink-0 text-xs ${ok ? 'text-phos' : bad ? 'text-danger' : 'text-ink-faint'}`}
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
