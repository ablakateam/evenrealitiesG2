import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Mail, MessageSquare, ArrowLeft } from 'lucide-react';
import { Card, CardBody, PageHeading, Spinner, EmptyState, Badge, Button } from '@/components/ui';
import { apiGet, apiPost } from '@/lib/api';

interface InboxItem {
  id: number;
  channel: 'sms' | 'email';
  contact_id: number | null;
  from_address: string;
  subject: string | null;
  body: string;
  received_at: string;
  read_at: string | null;
}

interface InboxDetail extends InboxItem {
  contact_name: string | null;
  raw_payload_json: string | null;
}

export function Inbox() {
  const qc = useQueryClient();
  const [open, setOpen] = useState<number | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const list = useQuery({
    queryKey: ['inbox', unreadOnly],
    queryFn: () =>
      apiGet<{ items: InboxItem[]; unread_count: number }>(`/api/inbox?limit=50${unreadOnly ? '&unread=true' : ''}`),
    refetchInterval: 20_000,
  });

  if (open !== null) {
    return <InboxThread id={open} onBack={() => setOpen(null)} onRead={() => qc.invalidateQueries({ queryKey: ['inbox'] })} />;
  }

  return (
    <>
      <PageHeading
        title="Inbox"
        subtitle={list.data ? `${list.data.unread_count} unread` : 'Incoming SMS and email'}
      />
      <div className="mb-4">
        <Button variant={unreadOnly ? 'primary' : 'outline'} size="sm" onClick={() => setUnreadOnly(!unreadOnly)}>
          {unreadOnly ? 'Showing unread' : 'Show unread only'}
        </Button>
      </div>

      {list.isLoading && <Spinner />}
      {list.data && list.data.items.length === 0 && (
        <EmptyState>{unreadOnly ? 'Nothing unread.' : 'No messages yet.'}</EmptyState>
      )}

      <div className="space-y-2">
        {list.data?.items.map((m) => (
          <Card key={m.id} bracketed={false}>
            <CardBody
              className="flex cursor-pointer items-start gap-3 py-3"
              {...{ onClick: () => setOpen(m.id) }}
            >
              {m.channel === 'email' ? (
                <Mail size={16} className="mt-0.5 shrink-0 text-ink-faint" />
              ) : (
                <MessageSquare size={16} className="mt-0.5 shrink-0 text-ink-faint" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-ink">{m.from_address}</span>
                  {!m.read_at && <span className="dot dot-ok" />}
                </div>
                {m.subject && <div className="truncate text-xs text-ink-muted">{m.subject}</div>}
                <div className="truncate text-xs text-ink-faint">{m.body}</div>
              </div>
              <span className="shrink-0 text-xs text-ink-faint">{relTime(m.received_at)}</span>
            </CardBody>
          </Card>
        ))}
      </div>
    </>
  );
}

function InboxThread({ id, onBack, onRead }: { id: number; onBack: () => void; onRead: () => void }) {
  const detail = useQuery({
    queryKey: ['inbox', id],
    queryFn: () => apiGet<InboxDetail>(`/api/inbox/${id}`),
  });
  const markRead = useMutation({
    mutationFn: () => apiPost(`/api/inbox/${id}/read`, {}),
    onSuccess: onRead,
  });

  return (
    <>
      <button onClick={onBack} className="mb-4 flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft size={15} /> Inbox
      </button>
      {detail.isLoading && <Spinner />}
      {detail.data && (
        <Card>
          <CardBody className="pt-5">
            <div className="mb-3 flex items-center gap-2">
              <Badge tone="idle">{detail.data.channel.toUpperCase()}</Badge>
              {detail.data.read_at ? (
                <span className="text-xs text-ink-faint">read</span>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => markRead.mutate()}>
                  Mark read
                </Button>
              )}
            </div>
            <div className="text-sm font-medium text-ink">
              {detail.data.contact_name ?? detail.data.from_address}
            </div>
            <div className="text-xs text-ink-faint">
              {detail.data.from_address} · {new Date(detail.data.received_at).toLocaleString()}
            </div>
            {detail.data.subject && (
              <div className="mt-3 text-sm font-medium text-ink">{detail.data.subject}</div>
            )}
            <div className="mt-3 whitespace-pre-wrap text-sm text-ink-muted">{detail.data.body}</div>
          </CardBody>
        </Card>
      )}
    </>
  );
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
