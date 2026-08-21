import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Star, Trash2, Pencil } from 'lucide-react';
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

interface Contact {
  id: number;
  name: string;
  phone_e164: string | null;
  email: string | null;
  default_channel: string | null;
  favorite: boolean;
  tags: string[];
  last_sent_at: string | null;
}

export function Contacts() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [favOnly, setFavOnly] = useState(false);
  const [editing, setEditing] = useState<Contact | 'new' | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);

  const contacts = useQuery({
    queryKey: ['contacts', q, favOnly],
    queryFn: () =>
      apiGet<{ items: Contact[]; total: number }>(
        `/api/contacts?${q ? `q=${encodeURIComponent(q)}&` : ''}${favOnly ? 'favorites_only=true' : ''}`,
      ),
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: ['contacts'] });

  const toggleFav = useMutation({
    mutationFn: (c: Contact) => apiPut(`/api/contacts/${c.id}`, { favorite: !c.favorite }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/contacts/${id}`),
    onSuccess: refresh,
  });

  return (
    <>
      <PageHeading title="Contacts" subtitle={contacts.data ? `${contacts.data.total} saved` : 'People you message'} />

      <div className="mb-4 flex gap-2">
        <Input placeholder="Search name, phone, email" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button variant={favOnly ? 'primary' : 'outline'} onClick={() => setFavOnly(!favOnly)}>
          ★
        </Button>
        <Button variant="outline" onClick={() => setCsvOpen(true)}>
          Import
        </Button>
        <Button variant="primary" onClick={() => setEditing('new')}>
          + Add
        </Button>
      </div>

      {contacts.isLoading && <Spinner />}
      {contacts.data && contacts.data.items.length === 0 && (
        <EmptyState>No contacts yet — add one or import a CSV.</EmptyState>
      )}

      <div className="space-y-2">
        {contacts.data?.items.map((c) => (
          <Card key={c.id}>
            <CardBody className="flex items-center gap-2 py-3 sm:gap-3">
              <button
                onClick={() => toggleFav.mutate(c)}
                aria-label={c.favorite ? 'Unfavourite' : 'Favourite'}
                className="grid h-touch w-touch shrink-0 place-items-center rounded-lg hover:bg-bg-inset lg:h-8 lg:w-8"
              >
                <Star size={16} className={c.favorite ? 'fill-phos text-phos' : 'text-ink-faint'} />
              </button>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-ink">{c.name}</div>
                <div className="truncate text-xs text-ink-muted">
                  {[c.phone_e164, c.email].filter(Boolean).join(' · ') || 'no contact info'}
                </div>
              </div>
              <button onClick={() => setEditing(c)} aria-label="Edit contact" className="grid h-touch w-touch shrink-0 place-items-center rounded-lg text-ink-faint hover:bg-bg-inset hover:text-ink lg:h-8 lg:w-8">
                <Pencil size={15} />
              </button>
              <button onClick={() => remove.mutate(c.id)} aria-label="Delete contact" className="grid h-touch w-touch shrink-0 place-items-center rounded-lg text-ink-faint hover:bg-bg-inset hover:text-danger lg:h-8 lg:w-8">
                <Trash2 size={15} />
              </button>
            </CardBody>
          </Card>
        ))}
      </div>

      {editing && (
        <ContactModal
          contact={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
      {csvOpen && (
        <CsvModal
          onClose={() => setCsvOpen(false)}
          onSaved={() => {
            setCsvOpen(false);
            refresh();
          }}
        />
      )}
    </>
  );
}

function ContactModal({
  contact,
  onClose,
  onSaved,
}: {
  contact: Contact | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState({
    name: contact?.name ?? '',
    phone: contact?.phone_e164 ?? '',
    email: contact?.email ?? '',
  });
  const [err, setErr] = useState('');
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name.trim(),
        phone: f.phone.trim() || undefined,
        email: f.email.trim() || undefined,
      };
      return contact ? apiPut(`/api/contacts/${contact.id}`, body) : apiPost('/api/contacts', body);
    },
    onSuccess: onSaved,
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'save failed'),
  });
  return (
    <Modal open onClose={onClose} title={contact ? 'Edit contact' : 'Add contact'}>
      <Field label="Name">
        <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </Field>
      <Field label="Phone">
        <Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+1…" />
      </Field>
      <Field label="Email">
        <Input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      </Field>
      {err && <InlineNote tone="bad">{err}</InlineNote>}
      <Button
        variant="primary"
        className="mt-3 w-full"
        disabled={!f.name.trim() || (!f.phone.trim() && !f.email.trim()) || save.isPending}
        onClick={() => save.mutate()}
      >
        {save.isPending ? 'Saving…' : 'Save'}
      </Button>
    </Modal>
  );
}

function CsvModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [csv, setCsv] = useState('');
  const [result, setResult] = useState('');
  const imp = useMutation({
    mutationFn: () => apiPost<{ inserted: number; parsed: number }>('/api/contacts/csv', { csv: csv.trim() }),
    onSuccess: (r) => {
      setResult(`imported ${r.inserted} of ${r.parsed}`);
      setTimeout(onSaved, 900);
    },
    onError: (e) => setResult(e instanceof ApiError ? e.message : 'import failed'),
  });
  return (
    <Modal open onClose={onClose} title="Import contacts (CSV)">
      <Field label="CSV — header row: name, phone, email">
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={7}
          placeholder={'name,phone,email\nAlex Morgan,+14155550142,alex@example.com'}
          className="w-full rounded-lg border border-line bg-bg-inset px-3 py-2 font-mono text-xs text-ink placeholder:text-ink-faint focus:border-phos/50 focus:outline-none"
        />
      </Field>
      {result && <InlineNote tone={result.startsWith('imported') ? 'ok' : 'bad'}>{result}</InlineNote>}
      <Button variant="primary" className="mt-3 w-full" disabled={!csv.trim() || imp.isPending} onClick={() => imp.mutate()}>
        {imp.isPending ? 'Importing…' : 'Import'}
      </Button>
    </Modal>
  );
}
