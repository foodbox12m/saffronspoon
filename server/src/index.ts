/**
 * Express entrypoint.
 *
 * Boot order matters: validate config, validate the menu, load the knowledge
 * base, then open the port. A bad price in menu.json or a missing production
 * secret should stop the deploy, not surface as a wrong total on a customer's
 * quote three hours later.
 */

import express from 'express';
import { assertConfigValid, config, configSummary } from './config.js';
import { assertMenuValid } from './domain/menu.js';
import { getStore } from './db/store.js';
import { initialiseKnowledgeBase } from './kb/ingest-ubereats.js';
import { knowledgeBase } from './kb/store.js';
import { createRouter } from './http/routes.js';
import { auditLog } from './security/index.js';
import { startWhatsApp } from './whatsapp/index.js';

function buildApp(): express.Express {
  const app = express();

  // Behind Render/Vercel/Cloudflare, req.ip must come from X-Forwarded-For or
  // every request looks like it came from the proxy and rate limits collapse
  // into one shared bucket.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // Twilio posts form-encoded; everything else is JSON. Both are capped so a
  // large body cannot be used to exhaust memory.
  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '256kb' }));

  // Security headers. The API serves JSON and one self-contained HTML page, so
  // it never needs to load third-party script or be framed.
  app.use((_request, response, next) => {
    response.set({
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'strict-transport-security': config.isProd ? 'max-age=31536000; includeSubDomains' : '',
      'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    });
    next();
  });

  // CORS restricted to the hosts that actually serve our frontend.
  app.use((request, response, next) => {
    const origin = request.headers.origin;
    if (origin && config.security.allowedOrigins.includes(origin)) {
      response.set({
        'access-control-allow-origin': origin,
        'access-control-allow-headers': 'content-type,authorization',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-max-age': '600',
        vary: 'Origin',
      });
    }

    if (request.method === 'OPTIONS') {
      response.status(204).end();
      return;
    }
    next();
  });

  app.use(createRouter());

  app.use((_request, response) => {
    response.status(404).json({ error: 'not_found' });
  });

  // Final error handler. Never leak a stack trace to a customer.
  app.use(
    (
      error: Error,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ): void => {
      // eslint-disable-next-line no-console
      console.error('[http] unhandled error', error);
      if (response.headersSent) return;
      response.status(500).json({ error: 'internal_error', message: 'Something went wrong. Please try again.' });
    },
  );

  return app;
}

export async function main(): Promise<void> {
  assertConfigValid();
  assertMenuValid();

  const kb = await initialiseKnowledgeBase();
  const store = getStore();
  const health = await store.healthCheck();

  auditLog.append({
    actor: 'system',
    actorRole: 'service',
    action: 'server.boot',
    outcome: 'allowed',
    meta: { store: store.backend, kbDocuments: knowledgeBase.size },
  });

  const app = buildApp();

  const server = app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(
      [
        '',
        '  saffron & spoon — catering ordering agent',
        `  listening on :${config.port}`,
        '',
        ...Object.entries(configSummary()).map(([key, value]) => `  ${key.padEnd(10)} ${String(value)}`),
        `  store      ${health.detail}`,
        `  knowledge  ${knowledgeBase.size} document(s) — ${kb.note}`,
        '',
      ].join('\n'),
    );
  });

  // Long-lived WhatsApp connection, if the provider needs one. A failure here
  // must not take the HTTP API down with it — the web app still works.
  startWhatsApp().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error('[whatsapp] failed to start:', error instanceof Error ? error.message : error);
  });

  const shutdown = (signal: string): void => {
    // eslint-disable-next-line no-console
    console.log(`\n[server] ${signal} received — closing.`);
    auditLog.append({ actor: 'system', actorRole: 'service', action: 'server.shutdown', outcome: 'allowed' });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

const isEntrypoint = process.argv[1]?.match(/(index|server)\.(ts|js)$/);
if (isEntrypoint) {
  main().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error('[server] failed to start:', error);
    process.exit(1);
  });
}

export { buildApp };
