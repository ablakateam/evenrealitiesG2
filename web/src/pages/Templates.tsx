import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronUp, ChevronDown, Trash2, Pencil } from 'lucide-react';
import {
  Card,
  CardBody,
  PageHeading,
  Spinner,
  Button,
  Input,
  Field,
  Modal,
  EmptyState,
  InlineNote,
} from '@/components/ui';
import { apiGet, apiPost, apiPut, apiDelete, ApiError } from '@/lib/api';

interface Template {
  id: number;
  label: string;
  body: string;
  sort_order: number;
}

export function Templates() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Template | 'new' | null>(null);

  const templates = useQuery({
    queryKey: ['templates'],
    queryFn: () => apiGet<{ items: Template[] }>('/api/templates'),
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['templates'] });

  const remove = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/templates/${id}`),
    onSuccess: refresh,
  });
  const reorder = useMutation({
    mutationFn: (order: number[]) => apiPost('/api/templates/reorder', { order }),
    onSuccess: refresh,
  });

  const items = templates.data?.items ?? [];

  function move(idx: number, dir: -1 | 1) {
    const next = [...items];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap]!, next[idx]!];
    reorder.mutate(next.map((t) => t.id));
  }

  return (
    <>
      <PageHeading
        title="Templates"
        subtitle={`${items.length} quick-send phrases`}
      />
      <div className="mb-4">
        <Button variant="primary" onClick={() => setEditing('new')}>
          + Add template
        </Button>
      </div>

      {templates.isLoading && <Spinner />}
      {items.length === 0 && !templates.isLoading && <EmptyState>No templates yet.</EmptyState>}

      <div className="space-y-2">
        {items.map((t, idx) => (
          <Card key={t.id}>
            <CardBody className="flex items-center gap-2 py-3 sm:gap-3">
              <div className="flex shrink-0 flex-col">
                <button onClick={() => move(idx, -1)} disabled={idx === 0} className="text-ink-faint hover:text-ink disabled:opacity-30">
                  <ChevronUp size={14} />
                </button>
                <button
                  onClick={() => move(idx, 1)}
                  disabled={idx === items.length - 1}
                  className="text-ink-faint hover:text-ink disabled:opacity-30"
                >
                  <ChevronDown size={14} />
                </button>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-ink">{t.label}</div>
                <div className="truncate text-xs text-ink-muted">{t.body}</div>
              </div>
              <button onClick={() => setEditing(t)} className="grid h-touch w-touch shrink-0 place-items-center rounded-lg text-ink-faint hover:bg-bg-inset hover:text-ink lg:h-8 lg:w-8">
                <Pencil size={15} />
              </button>
              <button onClick={() => remove.mutate(t.id)} className="grid h-touch w-touch shrink-0 place-items-center rounded-lg text-ink-faint hover:bg-bg-inset hover:text-danger lg:h-8 lg:w-8">
                <Trash2 size={15} />
              </button>
            </CardBody>
          </Card>
        ))}
      </div>

      {editing && (
        <TemplateModal
          template={editing === 'new' ? null : editing}
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

function TemplateModal({
  template,
  onClose,
  onSaved,
}: {
  template: Template | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState({ label: template?.label ?? '', body: template?.body ?? '' });
  const [err, setErr] = useState('');
  const save = useMutation({
    mutationFn: () => {
      const body = { label: f.label.trim(), body: f.body.trim() };
      return template ? apiPut(`/api/templates/${template.id}`, body) : apiPost('/api/templates', body);
    },
    onSuccess: onSaved,
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'save failed'),
  });
  return (
    <Modal open onClose={onClose} title={template ? 'Edit template' : 'Add template'}>
      <Field label="Label" hint="short name shown in the picker">
        <Input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="Running late" />
      </Field>
      <Field label="Body" hint="the message text">
        <textarea
          value={f.body}
          onChange={(e) => setF({ ...f, body: e.target.value })}
          rows={3}
          className="w-full rounded-lg border border-line bg-bg-inset px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-phos/50 focus:outline-none"
          placeholder="I'm running ~10 minutes late, sorry!"
        />
      </Field>
      {err && <InlineNote tone="bad">{err}</InlineNote>}
      <Button
        variant="primary"
        className="mt-3 w-full"
        disabled={!f.label.trim() || !f.body.trim() || save.isPending}
        onClick={() => save.mutate()}
      >
        {save.isPending ? 'Saving…' : 'Save'}
      </Button>
    </Modal>
  );
}
