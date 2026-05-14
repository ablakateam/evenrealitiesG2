import { getDb } from './db.js';
import { getEmailAccount } from './mail/account.js';
import { configuredProviders, createProvider } from './llm/factory.js';
import { credsSource } from './integrations.js';
import { CATALOG } from './llm/models.js';
import { imapManager } from './mail/manager.js';

export type CheckStatus = 'ok' | 'fail' | 'skip';

export interface DiagnosticCheck {
  name: string;
  status: CheckStatus;
  latency_ms?: number;
  detail: string;
}

/**
 * Run every end-to-end health check we can do server-side and return a
 * per-check report. Powers the dashboard's "Run all tests" panel.
 */
export async function runDiagnostics(userId: number): Promise<DiagnosticCheck[]> {
  const checks: DiagnosticCheck[] = [];

  // 1. Database
  try {
    const t0 = Date.now();
    const row = getDb().prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
    checks.push({
      name: 'Database',
      status: 'ok',
      latency_ms: Date.now() - t0,
      detail: `SQLite reachable · ${row.c} user(s)`,
    });
  } catch (err) {
    checks.push({ name: 'Database', status: 'fail', detail: err instanceof Error ? err.message : String(err) });
  }

  // 2. Twilio credentials
  const twilioSrc = credsSource(userId, 'twilio');
  checks.push({
    name: 'Twilio',
    status: twilioSrc === 'none' ? 'skip' : 'ok',
    detail:
      twilioSrc === 'none'
        ? 'not configured — add credentials in Integrations'
        : `credentials present (source: ${twilioSrc}) · live send needs a destination number`,
  });

  // 3. Email account + IMAP IDLE
  const emailRow = getEmailAccount(userId);
  if (!emailRow) {
    checks.push({ name: 'Email account', status: 'skip', detail: 'no email account configured' });
  } else {
    const imapOk = emailRow.imap_status === 'live';
    checks.push({
      name: 'Email · IMAP IDLE',
      status: imapOk ? 'ok' : emailRow.imap_status === 'error' ? 'fail' : 'skip',
      detail: imapOk
        ? `live · ${emailRow.email_address} · last sync ${emailRow.last_synced_at ?? 'n/a'}`
        : `status: ${emailRow.imap_status}${emailRow.last_error ? ' · ' + emailRow.last_error : ''}`,
    });
  }
  checks.push({
    name: 'IMAP workers',
    status: 'ok',
    detail: `${imapManager.size()} worker(s) running`,
  });

  // 4. Each configured LLM provider — a tiny live round-trip
  const providers = configuredProviders(userId);
  if (providers.length === 0) {
    checks.push({ name: 'LLM providers', status: 'skip', detail: 'no AI provider configured' });
  } else {
    for (const provider of providers) {
      const model = CATALOG[provider].default;
      try {
        const llm = createProvider(provider, userId);
        const result = await llm.complete({
          systemPrompt: 'Reply with exactly: OK',
          userMessage: 'ping',
          model,
          maxTokens: 8,
          temperature: 0,
        });
        checks.push({
          name: `LLM · ${provider}`,
          status: 'ok',
          latency_ms: result.latency_ms,
          detail: `${model} responded "${result.text.trim().slice(0, 20)}"`,
        });
      } catch (err) {
        checks.push({
          name: `LLM · ${provider}`,
          status: 'fail',
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return checks;
}
