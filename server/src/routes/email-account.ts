import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import {
  deleteEmailAccount,
  getEmailAccount,
  toView,
  upsertEmailAccount,
} from '../mail/account.js';
import { imapManager } from '../mail/manager.js';
import { sendTestEmail, EmailError } from '../mail/smtp.js';
import { log } from '../log.js';

export const emailAccountRouter = Router();

const AccountBody = z.object({
  provider: z.enum(['gmail', 'outlook', 'icloud', 'custom']),
  email_address: z.string().email(),
  display_name: z.string().optional(),
  // password mode:
  username: z.string().optional(),
  password: z.string().optional(),
  smtp_host: z.string().optional(),
  smtp_port: z.number().int().min(1).max(65535).optional(),
  smtp_security: z.enum(['ssl', 'starttls', 'none']).optional(),
  imap_host: z.string().optional(),
  imap_port: z.number().int().min(1).max(65535).optional(),
  imap_security: z.enum(['ssl', 'starttls']).optional(),
  // OAuth mode:
  oauth_refresh_token: z.string().optional(),
  oauth_access_token: z.string().optional(),
  oauth_expires_at: z.string().optional(),
});

/**
 * GET /api/email-account
 * Returns the masked view (no secrets) of the user's email account, or 404 if none.
 */
emailAccountRouter.get('/api/email-account', requireAuth, (req, res) => {
  const row = getEmailAccount(req.user!.id);
  if (!row) {
    res.status(404).json({ error: 'not_configured' });
    return;
  }
  res.json(toView(row));
});

/**
 * PUT /api/email-account
 * Upsert credentials. Restarts the user's IMAP IDLE worker if running.
 */
emailAccountRouter.put('/api/email-account', requireAuth, async (req, res) => {
  const parsed = AccountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
    return;
  }
  const userId = req.user!.id;
  upsertEmailAccount(userId, parsed.data);

  // Boot or restart the IDLE worker for this user.
  try {
    await imapManager.restartWorker(userId);
  } catch (err) {
    log.warn({ err, userId }, 'imap worker restart failed; account saved anyway');
  }

  const row = getEmailAccount(userId);
  res.json(row ? toView(row) : null);
});

/**
 * DELETE /api/email-account
 * Removes credentials and stops the IDLE worker.
 */
emailAccountRouter.delete('/api/email-account', requireAuth, async (req, res) => {
  const userId = req.user!.id;
  await imapManager.stopWorker(userId);
  deleteEmailAccount(userId);
  res.json({ ok: true });
});

/**
 * POST /api/email-account/test
 * Send a test email to the configured address (or override via body.to).
 */
const TestBody = z.object({ to: z.string().email().optional() });

emailAccountRouter.post('/api/email-account/test', requireAuth, async (req, res) => {
  const parsed = TestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
    return;
  }
  const row = getEmailAccount(req.user!.id);
  if (!row) {
    res.status(400).json({ error: 'not_configured' });
    return;
  }
  const to = parsed.data.to ?? row.email_address;
  try {
    const result = await sendTestEmail(req.user!.id, to);
    res.json({ ok: true, to, ...result });
  } catch (err) {
    if (err instanceof EmailError) {
      res.status(502).json({ error: err.code, message: err.message });
      return;
    }
    log.error({ err }, 'test email failed');
    res.status(500).json({ error: 'internal_error' });
  }
});
