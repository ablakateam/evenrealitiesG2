import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import crypto from 'node:crypto';

const tmpRoot = mkdtempSync(join(tmpdir(), 'vox-test-'));

process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.env.DB_PATH = join(tmpRoot, 'vox-test.db');
process.env.MASTER_KEY = crypto.randomBytes(32).toString('base64');
process.env.BOOTSTRAP_SECRET = 'test-bootstrap-secret-please-rotate';
process.env.LOG_LEVEL = 'fatal';
process.env.TWILIO_WEBHOOK_BASE_URL = 'https://test.example.com';
