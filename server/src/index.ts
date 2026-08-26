import { env } from './env.js';
import { log } from './log.js';
import { initCrypto } from './crypto.js';
import { getDb, closeDb } from './db.js';
import { ensureUserExists } from './auth.js';
import { buildApp } from './app.js';
import { imapManager } from './mail/manager.js';

async function main(): Promise<void> {
  await initCrypto();
  getDb();
  await ensureUserExists();

  const app = buildApp();
  const server = app.listen(env.PORT, env.HOST, () => {
    log.info(
      { host: env.HOST, port: env.PORT, env: env.NODE_ENV, db: env.DB_PATH },
      `vox-server listening on ${env.HOST}:${env.PORT}`,
    );
  });

  // Spawn IMAP IDLE workers for any configured email accounts. Don't block
  // server start on this — workers can take seconds to connect.
  void imapManager.startAll().catch((err) => {
    log.error({ err: err instanceof Error ? err.message : String(err) }, 'imap-manager startAll failed');
  });

  const shutdown = (signal: string): void => {
    log.info({ signal }, 'received shutdown signal, closing');
    void imapManager.stopAll().catch((err) => {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, 'imap-manager stopAll error');
    });
    server.close((err) => {
      if (err) log.error({ err }, 'http server close error');
      closeDb();
      process.exit(err ? 1 : 0);
    });
    setTimeout(() => {
      log.warn('graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('uncaughtException', (err) => {
    log.fatal({ err }, 'uncaughtException');
    process.exit(1);
  });
  process.on('unhandledRejection', (err) => {
    log.fatal({ err }, 'unhandledRejection');
    process.exit(1);
  });
}

main().catch((err) => {
  log.fatal({ err }, 'server failed to start');
  process.exit(1);
});
