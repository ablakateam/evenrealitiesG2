import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { getDb } from '../db.js';
import { log } from '../log.js';

export const telemetryRouter = Router();

const ErrorSchema = z.object({
  message: z.string().min(1).max(1000),
  stack: z.string().max(8000).nullable().optional(),
  page: z.string().max(100).nullable().optional(),
  sdk_version: z.string().max(40).optional(),
  app_version: z.string().max(40).optional(),
});

/**
 * POST /api/telemetry/error
 *
 * Lightweight crash dump intake from the HUD or dashboard. Stored in
 * client_errors for offline review (pm2 logs has the live tail). Best-
 * effort by design — the HUD never blocks on this round-trip.
 */
telemetryRouter.post('/api/telemetry/error', requireAuth, (req, res) => {
  const parsed = ErrorSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
    return;
  }
  const userId = req.user!.id;
  try {
    getDb()
      .prepare(
        `INSERT INTO client_errors (user_id, message, stack, page, sdk_version, app_version)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        userId,
        parsed.data.message,
        parsed.data.stack ?? null,
        parsed.data.page ?? null,
        parsed.data.sdk_version ?? null,
        parsed.data.app_version ?? null,
      );
    res.json({ ok: true });
  } catch (err) {
    log.warn({ err }, 'telemetry insert failed');
    res.status(500).json({ error: 'telemetry_insert_failed' });
  }
});
