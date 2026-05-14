import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, ArrowDownLeft, Download } from 'lucide-react';
import { Card, CardBody, CardHeader, CardTitle, PageHeading, Spinner, EmptyState, Select, Button } from '@/components/ui';
import { apiGet, type HistoryItem, type HistoryStats } from '@/lib/api';

export function Activity() {
  const [channel, setChannel] = useState('');
  const [direction, setDirection] = useState('');

  const stats = useQuery({
    queryKey: ['history-stats'],
    queryFn: () => apiGet<HistoryStats>('/api/history/stats'),
  });
  const history = useQuery({
    queryKey: ['history', channel, direction],
    queryFn: () => {
      const params = new URLSearchParams({ limit: '200' });
      if (channel) params.set('channel', channel);
      if (direction) params.set('direction', direction);
      return apiGet<{ items: HistoryItem[]; total: number }>(`/api/history?${params}`);
    },
  });

  function exportCsv() {
    const rows = history.data?.items ?? [];
    const header = 'id,channel,direction,contact,status,tone,subject,body,created_at';
    const lines = rows.map((r) =>
      [
        r.id,
        r.channel,
        r.direction,
        csvCell(r.contact_name ?? ''),
        r.status,
        r.tone ?? '',
        csvCell(r.subject ?? ''),
        csvCell(r.body),
        r.created_at,
      ].join(','),
    );
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vox-activity-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageHeading title="Activity" subtitle="Every send and receive, with cost tracking" />

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Roll-up</CardTitle>
        </CardHeader>
        <CardBody>
          {stats.isLoading && <Spinner />}
          {stats.data && (
            <div className="grid grid-cols-3 gap-4 text-sm">
              <Metric label="Sent (total)" value={stats.data.sent.total} />
              <Metric label="Received (total)" value={stats.data.received.total} />
              <Metric label="Failed (total)" value={stats.data.failed.total} tone={stats.data.failed.total > 0 ? 'bad' : undefined} />
              <Metric label="Sent today" value={stats.data.sent.today} />
              <Metric label="Tokens (total)" value={stats.data.tokens.total} />
              <Metric label="Cost 30d" value={`$${(stats.data.cost_cents.last_30d / 100).toFixed(2)}`} />
            </div>
          )}
        </CardBody>
      </Card>

      <div className="mb-4 flex items-center gap-2">
        <Select
          value={channel}
          onChange={setChannel}
          options={[
            { value: '', label: 'All channels' },
            { value: 'sms', label: 'SMS' },
            { value: 'email', label: 'Email' },
          ]}
        />
        <Select
          value={direction}
          onChange={setDirection}
          options={[
            { value: '', label: 'Both directions' },
            { value: 'out', label: 'Outbound' },
            { value: 'in', label: 'Inbound' },
          ]}
        />
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={!history.data?.items.length}>
          <Download size={14} /> CSV
        </Button>
      </div>

      {history.isLoading && <Spinner />}
      {history.data && history.data.items.length === 0 && <EmptyState>No activity matches these filters.</EmptyState>}

      <div className="space-y-1.5">
        {history.data?.items.map((h) => (
          <Card key={h.id}>
            <CardBody className="flex items-center gap-3 py-2.5 text-sm">
              {h.direction === 'out' ? (
                <ArrowUpRight size={14} className="shrink-0 text-ink-faint" />
              ) : (
                <ArrowDownLeft size={14} className="shrink-0 text-phos" />
              )}
              <span className="w-10 shrink-0 text-xs uppercase text-ink-faint">{h.channel}</span>
              <span className="w-28 shrink-0 truncate text-ink-muted">{h.contact_name ?? '—'}</span>
              <span className="flex-1 truncate text-ink">{h.subject ?? h.body}</span>
              {h.tone && <span className="shrink-0 text-xs text-ink-faint">{h.tone}</span>}
              <StatusText status={h.status} />
            </CardBody>
          </Card>
        ))}
      </div>
    </>
  );
}

function Metric({ label, value, tone }: { label: string; value: number | string; tone?: 'bad' }) {
  return (
    <div>
      <div className={`text-xl font-semibold ${tone === 'bad' ? 'text-danger' : 'text-ink'}`}>{value}</div>
      <div className="mt-0.5 text-xs text-ink-muted">{label}</div>
    </div>
  );
}

function StatusText({ status }: { status: string }) {
  const ok = ['sent', 'delivered', 'queued'].includes(status);
  const bad = ['failed', 'undelivered'].includes(status);
  return <span className={`shrink-0 text-xs ${ok ? 'text-phos' : bad ? 'text-danger' : 'text-ink-faint'}`}>{status}</span>;
}

function csvCell(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
