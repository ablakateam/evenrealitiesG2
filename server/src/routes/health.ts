import { Router } from 'express';
import { getDb, schemaVersion } from '../db.js';

export const healthRouter = Router();

healthRouter.get('/api/health', (_req, res) => {
  const db = getDb();
  const userCount = (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
  res.json({
    status: 'ok',
    service: 'vox-server',
    phase: 'P2',
    timestamp: new Date().toISOString(),
    uptime_seconds: process.uptime(),
    node: process.version,
    schema_version: schemaVersion(),
    user_count: userCount,
  });
});
