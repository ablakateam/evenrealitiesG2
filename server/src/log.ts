import pino from 'pino';
import { env } from './env.js';

export const log = pino({
  level: env.LOG_LEVEL,
  base: { service: 'vox-server' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.secret', '*.token'],
    censor: '[redacted]',
  },
});
