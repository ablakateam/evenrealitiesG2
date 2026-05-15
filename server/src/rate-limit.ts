import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { getDb } from './db.js';
import { log } from './log.js';

/**
 * Per-user, per-bucket sliding-window-ish rate limiter.
 *
 * We bucket requests into hourly windows keyed by ISO date prefix
 * (YYYY-MM-DDTHH). When a request comes in for a (user, bucket) pair, we
 * upsert the count for the current hour. If the count >= limit, we return
 * 429 with Retry-After set to the seconds until the next hour rolls over.
 *
 * Cheaper than express-rate-limit's in-memory token bucket, and survives
 * server restart since state lives in SQLite. The hourly-window boundary
 * is "good enough" for VOX's traffic profile (single-user, low rate).
 *
 * Buckets are intentionally coarse so a user can't blow their AI budget:
 *   - stt:       60/h    (transcription = expensive Whisper time)
 *   - rewrite: 1200/h    (each compose = ~7 rewrites, so ~170 composes/h)
 *   - sms:      200/h    (outbound SMS spam guard; Twilio costs $)
 *   - email:    400/h    (SMTP is cheaper; allow more)
 */

export interface RateLimitOpts {
  bucket: string;
  limit: number;
}

export function rateLimit(opts: RateLimitOpts): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) {
      // No auth on this route — let the auth middleware handle it.
      next();
      return;
    }
    const userId = user.id;
    const windowStart = new Date().toISOString().slice(0, 13); // 'YYYY-MM-DDTHH'
    try {
      const db = getDb();
      const tx = db.transaction(() => {
        db.prepare(
          `INSERT INTO rate_limit_state (user_id, bucket, window_start, count)
           VALUES (?, ?, ?, 1)
           ON CONFLICT(user_id, bucket, window_start)
             DO UPDATE SET count = count + 1`,
        ).run(userId, opts.bucket, windowStart);
        const row = db
          .prepare(
            'SELECT count FROM rate_limit_state WHERE user_id = ? AND bucket = ? AND window_start = ?',
          )
          .get(userId, opts.bucket, windowStart) as { count: number };
        return row.count;
      });
      const count = tx();
      if (count > opts.limit) {
        const retryAfterSec = secondsUntilNextHour();
        res.setHeader('Retry-After', String(retryAfterSec));
        res.status(429).json({
          error: 'rate_limited',
          bucket: opts.bucket,
          message: `Take a breath — you're going fast. Try again in ${Math.ceil(retryAfterSec / 60)} min.`,
        });
        return;
      }
      next();
    } catch (err) {
      // Fail OPEN on rate-limit errors — never block real work due to a
      // metering bug. Log loudly so the operator notices.
      log.warn({ err, bucket: opts.bucket, userId }, 'rate-limit upsert failed; failing open');
      next();
    }
  };
}

function secondsUntilNextHour(): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(now.getHours() + 1, 0, 0, 0);
  return Math.max(60, Math.floor((next.getTime() - now.getTime()) / 1000));
}
