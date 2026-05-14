import express, { type Express, type ErrorRequestHandler } from 'express';
import pinoHttp from 'pino-http';
import { log } from './log.js';
import { healthRouter } from './routes/health.js';
import { configRouter } from './routes/config.js';
import { llmRouter } from './routes/llm.js';
import { composeRouter } from './routes/compose.js';
import { smsRouter } from './routes/sms.js';
import { twilioWebhookRouter } from './routes/twilio-webhooks.js';
import { emailRouter } from './routes/email.js';
import { emailAccountRouter } from './routes/email-account.js';
import { inboxRouter } from './routes/inbox.js';
import { contactsRouter } from './routes/contacts.js';
import { templatesRouter } from './routes/templates.js';
import { historyRouter } from './routes/history.js';
import { integrationsRouter } from './routes/integrations.js';
import { accountRouter } from './routes/account.js';
import { idleRouter } from './routes/idle.js';

export function buildApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // CORS — the HUD + dashboard run in WebView / browser contexts whose origin
  // we can't enumerate ahead of time (the Even Realities App injects an origin
  // for installed .ehpk packages). Every API route is bearer-secret gated, so
  // an open Access-Control-Allow-Origin is acceptable: the secret is the real
  // auth boundary, not the origin. We also answer the OPTIONS preflight that
  // JSON bodies / the Authorization header trigger.
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(express.json({ limit: '1mb' }));
  app.use(
    pinoHttp({
      logger: log,
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    }),
  );

  app.use(healthRouter);
  app.use(configRouter);
  app.use(llmRouter);
  app.use(composeRouter);
  app.use(smsRouter);
  app.use(twilioWebhookRouter);
  app.use(emailRouter);
  app.use(emailAccountRouter);
  app.use(inboxRouter);
  app.use(contactsRouter);
  app.use(templatesRouter);
  app.use(historyRouter);
  app.use(integrationsRouter);
  app.use(accountRouter);
  app.use(idleRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    log.error({ err }, 'unhandled error');
    res.status(500).json({ error: 'internal_error' });
  };
  app.use(errorHandler);

  return app;
}
