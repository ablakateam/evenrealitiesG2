import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiDelete, ApiError } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardBody, Button, Input, InlineNote } from '@/components/ui';

/**
 * Set or remove the dashboard password.
 *
 * The shared secret is a fine machine credential and a poor human one: 32
 * random characters that live in this dashboard, which is what you need them
 * to open. A password breaks that circularity — sign in with something you can
 * remember, then come here to fetch a pairing link.
 *
 * It is an alternative door, not a weaker one: logging in with the password
 * returns the same shared secret the dashboard has always used, and every
 * request after that is identical.
 */

const MIN_LENGTH = 10;

export function DashboardPassword() {
  const qc = useQueryClient();
  const [value, setValue] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const status = useQuery({
    queryKey: ['password-status'],
    queryFn: () => apiGet<{ password_set: boolean }>('/api/auth/login'),
  });
  const isSet = status.data?.password_set ?? false;

  // One field, not two.
  //
  // The confirm field was worse than useless here: with a valid password typed
  // and confirm still empty, the button was disabled and NOTHING on screen said
  // why — the mismatch hint only rendered once confirm was non-empty. A reveal
  // toggle catches typos without ever producing a dead button.
  const tooShort = value.length > 0 && value.length < MIN_LENGTH;
  const canSave = value.length >= MIN_LENGTH && !busy;

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await apiPost('/api/account/password', { password: value });
      setValue('');
      setReveal(false);
      setSaved(true);
      await qc.invalidateQueries({ queryKey: ['password-status'] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save the password.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await apiDelete('/api/account/password');
      await qc.invalidateQueries({ queryKey: ['password-status'] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not remove the password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mb-3">
      <CardHeader>
        <CardTitle>Dashboard password</CardTitle>
      </CardHeader>
      <CardBody>
        <p className="mb-4 text-sm text-ink-muted">
          {isSet
            ? 'Set. You can sign in with this instead of pasting the VOX secret.'
            : 'Not set — signing in currently requires pasting the 32-character VOX secret. A password is easier, especially on a phone.'}
        </p>

        <div className="mb-1.5 flex items-baseline justify-between">
          <label className="text-xs font-medium text-ink-muted">
            {isSet ? 'New password' : 'Password'}
          </label>
          <button
            type="button"
            className="text-xs text-ink-faint underline underline-offset-2 hover:text-ink"
            onClick={() => setReveal(!reveal)}
          >
            {reveal ? 'Hide' : 'Show'}
          </button>
        </div>
        <Input
          type={reveal ? 'text' : 'password'}
          autoComplete="new-password"
          placeholder={`at least ${MIN_LENGTH} characters`}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
          }}
          onKeyDown={(e) => e.key === 'Enter' && canSave && void save()}
        />

        {/* The button's disabled state must ALWAYS be explained. */}
        {value.length === 0 ? (
          <p className="mt-2 text-xs text-ink-faint">
            Pick something you can remember — at least {MIN_LENGTH} characters.
          </p>
        ) : tooShort ? (
          <p className="mt-2 text-xs text-ink-faint">
            {MIN_LENGTH - value.length} more character{MIN_LENGTH - value.length === 1 ? '' : 's'}.
          </p>
        ) : null}
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        {saved && <p className="mt-2 text-xs text-phos">Saved.</p>}

        <div className="mt-4 flex gap-2">
          <Button onClick={() => void save()} disabled={!canSave}>
            {busy ? 'Saving…' : isSet ? 'Change password' : 'Set password'}
          </Button>
          {isSet && (
            <Button variant="ghost" onClick={() => void remove()} disabled={busy}>
              Remove
            </Button>
          )}
        </div>

        <div className="mt-4">
          <InlineNote>
          Signing in with the password returns the same shared secret the dashboard already uses —
          a different door, not a different level of access. Rotating the secret keeps the password
          working; it is re-linked to the new secret automatically.
        </InlineNote>
        </div>
      </CardBody>
    </Card>
  );
}
