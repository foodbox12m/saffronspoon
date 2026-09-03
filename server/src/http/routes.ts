/**
 * REST API.
 *
 * Every route resolves a principal, then goes through the same `callTool`
 * pipeline the agent uses. The HTTP layer therefore adds no new authority — it
 * is a transport, not a second set of business rules. The only logic here is
 * request shaping and the hosted payment page.
 */

import express, { type Request, type Response, type Router } from 'express';
import { config } from '../config.js';
import { getMenu } from '../domain/menu.js';
import { formatCents } from '../domain/pricing.js';
import { getStore, getSupabaseStore } from '../db/store.js';
import { buildPaymentInstruction, generatePaymentQrDataUrl } from '../payments/zelle.js';
import { callTool } from '../mcp/tools.js';
import {
  auditLog,
  AuthError,
  bearerFromHeader,
  issueGuestToken,
  issueStaffToken,
  principalFromToken,
  scopesForRole,
  type Principal,
} from '../security/index.js';
import { handleCustomerMessage } from '../agent/orchestrator.js';
import {
  handleInboundWhatsApp,
  notifyAdmins,
  subjectForPhone,
  webHandoffToken,
  whatsappDeepLink,
} from '../whatsapp/index.js';
import { parseTwilioWebhook, validateTwilioSignature } from '../whatsapp/twilio.js';

/** Resolve the caller. Missing token → a fresh anonymous customer principal. */
function resolvePrincipal(request: Request): Principal {
  const header = request.headers.authorization;
  if (!header) {
    // Anonymous browsing is allowed; the subject is per-request so it cannot be
    // used to reach an existing order.
    return { subject: `anon:${request.ip ?? 'unknown'}`, role: 'customer', scopes: scopesForRole('customer') };
  }
  return principalFromToken(bearerFromHeader(header));
}

function sendToolResult(response: Response, result: Awaited<ReturnType<typeof callTool>>): void {
  if (result.ok) {
    response.json(result.data);
    return;
  }

  const status =
    result.error?.code === 'rate_limited'
      ? 429
      : result.error?.code === 'missing_scope' || result.error?.code === 'not_owner'
        ? 403
        : result.error?.code === 'invalid_input'
          ? 400
          : 422;

  response.status(status).json({ error: result.error?.code, message: result.error?.message });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function createRouter(): Router {
  const router = express.Router();

  // ---------------------------------------------------------------------------
  // Health
  // ---------------------------------------------------------------------------
  router.get('/health', async (_request, response) => {
    const store = getStore();
    const health = await store.healthCheck();
    const chain = auditLog.verifyChain();

    response.status(health.ok ? 200 : 503).json({
      status: health.ok ? 'ok' : 'degraded',
      store: store.backend,
      storeDetail: health.detail,
      whatsapp: config.whatsapp.provider,
      agent: config.agent.enabled ? 'enabled' : 'deterministic-fallback',
      auditEntries: auditLog.size,
      auditChainIntact: chain.intact,
      version: '1.0.0',
    });
  });

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------
  router.post('/api/auth/guest', (request, response) => {
    const body = request.body as { sessionId?: string } | undefined;
    const { token, subject } = issueGuestToken(body?.sessionId);
    response.json({ token, subject, expiresInSeconds: config.security.accessTokenTtlSeconds });
  });

  router.post('/api/auth/staff', (request, response) => {
    const body = (request.body ?? {}) as { accessCode?: string; staffId?: string };
    try {
      const token = issueStaffToken(String(body.accessCode ?? ''), String(body.staffId ?? ''));
      response.json({ token, expiresInSeconds: config.security.accessTokenTtlSeconds });
    } catch (error) {
      const authError = error as AuthError;
      response.status(authError.status ?? 401).json({ error: authError.code, message: authError.message });
    }
  });

  // ---------------------------------------------------------------------------
  // Menu — public
  // ---------------------------------------------------------------------------
  router.get('/api/menu', (_request, response) => {
    const menu = getMenu();
    response.set('cache-control', 'public, max-age=300');
    response.json({
      currency: menu.currency,
      trayServings: menu.trayServings,
      categories: menu.categories,
      items: menu.items.map((item) => ({
        id: item.id,
        name: item.name,
        category: item.category,
        description: item.description,
        prices: item.prices,
        spice: item.spice,
        protein: item.protein,
        allergens: item.allergens,
        dietary: item.dietary,
        popular: Boolean(item.popular),
        fullTrayOnly: item.prices.half === null,
      })),
      whatsappLink: whatsappDeepLink(),
    });
  });

  // ---------------------------------------------------------------------------
  // Quote / orders
  // ---------------------------------------------------------------------------
  router.post('/api/quote', async (request, response) => {
    const principal = resolvePrincipal(request);
    const body = (request.body ?? {}) as { items?: unknown; guestCount?: unknown };
    const result = await callTool('quote_order', { items: body.items, guestCount: body.guestCount }, principal);
    sendToolResult(response, result);
  });

  router.post('/api/orders', async (request, response) => {
    const principal = resolvePrincipal(request);
    const result = await callTool('place_order', request.body, principal);

    if (result.ok) {
      const data = result.data as { memoCode: string; totalDisplay: string; orderId: string };
      const body = (request.body ?? {}) as { customer?: { name?: string }; event?: { date?: string } };
      void notifyAdmins(
        [
          '*New order placed*',
          `Code: ${data.memoCode}`,
          `Customer: ${body.customer?.name ?? 'unknown'}`,
          `Event: ${body.event?.date ?? 'unknown'}`,
          `Total: ${data.totalDisplay}`,
          'Awaiting Zelle payment.',
        ].join('\n'),
      ).catch(() => undefined);
    }

    sendToolResult(response, result);
  });

  router.get('/api/orders/:id', async (request, response) => {
    const principal = resolvePrincipal(request);
    const result = await callTool('check_order_status', { orderId: request.params.id }, principal);
    sendToolResult(response, result);
  });

  router.post('/api/orders/:id/claim-payment', async (request, response) => {
    const principal = resolvePrincipal(request);
    const body = (request.body ?? {}) as { note?: string; proofUrl?: string };
    const result = await callTool(
      'claim_payment',
      { orderId: request.params.id, note: body.note, proofUrl: body.proofUrl },
      principal,
    );

    if (result.ok) {
      const store = getStore();
      const order = await store.getOrder(String(request.params.id));
      if (order) {
        void notifyAdmins(
          [
            '*Payment claimed (web)*',
            `Order: ${order.memoCode}`,
            `Customer: ${order.customer.name} (${order.customer.phone})`,
            `Event: ${order.event.date}`,
            `Amount: ${formatCents(order.totalCents)}`,
            body.proofUrl ? 'Proof uploaded.' : 'No proof uploaded.',
          ].join('\n'),
        ).catch(() => undefined);
      }
    }

    sendToolResult(response, result);
  });

  /** Signed upload URL so proof images never transit our server. */
  router.post('/api/orders/:id/proof-upload-url', async (request, response) => {
    const principal = resolvePrincipal(request);
    const body = (request.body ?? {}) as { filename?: string };

    const supabase = getSupabaseStore();
    if (!supabase) {
      response.status(501).json({
        error: 'storage_unavailable',
        message: 'File upload needs Supabase storage configured. Ask the customer to send the screenshot on WhatsApp.',
      });
      return;
    }

    // Reuse the ownership check by reading the order through the tool layer first.
    const check = await callTool('check_order_status', { orderId: request.params.id }, principal);
    if (!check.ok) {
      sendToolResult(response, check);
      return;
    }

    try {
      const upload = await supabase.createProofUploadUrl(
        String(request.params.id),
        String(body.filename ?? 'proof.png'),
      );
      response.json(upload);
    } catch (error) {
      response.status(500).json({ error: 'upload_url_failed', message: String(error) });
    }
  });

  // ---------------------------------------------------------------------------
  // Staff
  // ---------------------------------------------------------------------------
  router.get('/api/staff/pending-payments', async (request, response) => {
    try {
      const principal = resolvePrincipal(request);
      const result = await callTool('list_pending_payments', { limit: 50 }, principal);
      sendToolResult(response, result);
    } catch (error) {
      const authError = error as AuthError;
      response.status(authError.status ?? 401).json({ error: authError.code, message: authError.message });
    }
  });

  router.post('/api/staff/verify-payment', async (request, response) => {
    try {
      const principal = resolvePrincipal(request);
      const result = await callTool('verify_payment', request.body, principal);

      if (result.ok) {
        const data = result.data as { memoCode: string; paymentStatus: string };
        const store = getStore();
        const order = await store.getOrder(String((request.body as { orderId?: string })?.orderId ?? ''));
        if (order && data.paymentStatus === 'verified') {
          // Tell the customer their order is actually confirmed.
          const { sendWhatsApp } = await import('../whatsapp/index.js');
          void sendWhatsApp(
            order.customer.phone,
            [
              `Payment confirmed — your order *${order.memoCode}* is locked in.`,
              '',
              `${order.event.date} · ${order.event.guestCount} guests`,
              `Total: ${formatCents(order.totalCents)}`,
              '',
              'We will be in touch the day before to confirm the delivery window. Thank you.',
            ].join('\n'),
          ).catch(() => undefined);
        }
      }

      sendToolResult(response, result);
    } catch (error) {
      const authError = error as AuthError;
      response.status(authError.status ?? 401).json({ error: authError.code, message: authError.message });
    }
  });

  router.get('/api/staff/audit', async (request, response) => {
    try {
      const principal = resolvePrincipal(request);
      if (!principal.scopes.includes('admin:all') && !principal.scopes.includes('payment:read:any')) {
        response.status(403).json({ error: 'missing_scope', message: 'Staff access required.' });
        return;
      }
      const limit = Number.parseInt(String(request.query.limit ?? '50'), 10) || 50;
      response.json({
        chain: auditLog.verifyChain(),
        headHash: auditLog.headHash,
        total: auditLog.size,
        entries: auditLog.tail(limit),
      });
    } catch (error) {
      const authError = error as AuthError;
      response.status(authError.status ?? 401).json({ error: authError.code, message: authError.message });
    }
  });

  // ---------------------------------------------------------------------------
  // Web chat (same agent as WhatsApp)
  // ---------------------------------------------------------------------------
  router.post('/api/chat', async (request, response) => {
    const principal = resolvePrincipal(request);
    const body = (request.body ?? {}) as { message?: string; sessionId?: string };

    if (!body.message || typeof body.message !== 'string') {
      response.status(400).json({ error: 'missing_message', message: 'Send { "message": "..." }.' });
      return;
    }

    const reply = await handleCustomerMessage({
      principal,
      channel: 'web',
      participant: body.sessionId ?? principal.subject,
      message: body.message,
    });

    response.json(reply);
  });

  // ---------------------------------------------------------------------------
  // Twilio webhook
  // ---------------------------------------------------------------------------
  router.post('/webhooks/twilio', async (request, response) => {
    const params = (request.body ?? {}) as Record<string, string>;

    if (config.whatsapp.twilio.validateSignature) {
      const url = `${config.publicBaseUrl.replace(/\/+$/, '')}/webhooks/twilio`;
      const valid = validateTwilioSignature({
        signature: request.headers['x-twilio-signature'] as string | undefined,
        url,
        params,
        authToken: config.whatsapp.twilio.authToken,
      });

      if (!valid) {
        auditLog.append({
          actor: `ip:${request.ip ?? 'unknown'}`,
          actorRole: 'service',
          action: 'webhook.twilio',
          outcome: 'denied',
          reason: 'Invalid Twilio signature',
        });
        response.status(403).type('text/xml').send('<Response></Response>');
        return;
      }
    }

    // Acknowledge immediately; Twilio times out at 15s and the agent can be slower.
    response.status(200).type('text/xml').send('<Response></Response>');

    const message = parseTwilioWebhook(params);
    if (!message.from) return;

    void handleInboundWhatsApp(message).catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[webhook] twilio handling failed', error);
    });
  });

  // ---------------------------------------------------------------------------
  // Hosted payment page — the QR target.
  // ---------------------------------------------------------------------------
  router.get('/pay/:orderId', async (request, response) => {
    const order = await getStore().getOrder(String(request.params.orderId));

    if (!order) {
      response.status(404).type('html').send('<h1>Order not found</h1><p>Check the link and try again.</p>');
      return;
    }

    const instruction = buildPaymentInstruction({
      memoCode: order.memoCode,
      totalCents: order.totalCents,
      depositDueCents: order.depositDueCents,
    });

    const qr = await generatePaymentQrDataUrl(order.id).catch(() => '');
    const paidLabel = order.paymentStatus === 'verified' ? 'Payment confirmed' : null;

    // Self-contained page, no external assets, strict CSP. It only ever shows
    // the memo code and amount — no customer contact details.
    response
      .set(
        'content-security-policy',
        "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
      )
      .type('html').send(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Pay ${escapeHtml(order.memoCode)} — saffron &amp; spoon</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;padding:24px;background:#111013;color:#f4efe6;
       font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  .card{max-width:420px;margin:0 auto;background:#1a181d;border:1px solid #2e2b33;
        border-radius:18px;padding:28px 24px}
  h1{margin:0 0 4px;font-size:1.35rem;letter-spacing:-.01em}
  .muted{color:#a49c92;font-size:.9rem;margin:0 0 22px}
  .amount{font-size:2.4rem;font-weight:700;letter-spacing:-.02em;color:#f0b64a;margin:0}
  .amount-label{font-size:.78rem;text-transform:uppercase;letter-spacing:.09em;color:#a49c92;margin:0 0 2px}
  dl{margin:22px 0 0;display:grid;gap:12px}
  dt{font-size:.74rem;text-transform:uppercase;letter-spacing:.09em;color:#a49c92}
  dd{margin:3px 0 0;font-size:1.05rem;word-break:break-word}
  .memo{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:1.5rem;
        font-weight:700;color:#f0b64a;letter-spacing:.06em}
  .qr{margin:24px 0 0;text-align:center}
  .qr img{width:190px;height:190px;border-radius:12px;background:#fff;padding:10px}
  ol{margin:22px 0 0;padding-left:20px;color:#ddd4c8}
  ol li{margin-bottom:9px}
  .banner{margin:0 0 18px;padding:11px 14px;border-radius:10px;font-size:.9rem;
          background:#1d2a1f;border:1px solid #2f4a34;color:#a8d8b0}
  .warn{margin:22px 0 0;padding:12px 14px;border-radius:10px;font-size:.85rem;
        background:#2a2118;border:1px solid #4a3a25;color:#e0c9a3}
</style></head>
<body><div class="card">
  ${paidLabel ? `<p class="banner">✓ ${escapeHtml(paidLabel)} — nothing further needed.</p>` : ''}
  <h1>saffron &amp; spoon</h1>
  <p class="muted">Order ${escapeHtml(order.memoCode)} · ${escapeHtml(order.event.date)}</p>

  <p class="amount-label">${instruction.isDeposit ? 'Deposit due now' : 'Amount due'}</p>
  <p class="amount">${escapeHtml(instruction.amountDisplay)}</p>

  <dl>
    <div><dt>Send with Zelle to</dt><dd>${escapeHtml(instruction.zelleId)}</dd></div>
    <div><dt>Recipient name</dt><dd>${escapeHtml(instruction.recipientName)}</dd></div>
    <div><dt>Memo / note — required</dt><dd class="memo">${escapeHtml(instruction.memoCode)}</dd></div>
    ${
      instruction.balanceCents > 0
        ? `<div><dt>Balance on delivery</dt><dd>${escapeHtml(formatCents(instruction.balanceCents))}</dd></div>`
        : ''
    }
  </dl>

  ${qr ? `<div class="qr"><img src="${qr}" alt="QR code linking to this payment page"></div>` : ''}

  <ol>${instruction.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>

  <p class="warn">Your order is confirmed only once we have matched your payment and messaged you back. Always include the memo code.</p>
</div></body></html>`);
  });

  /** WhatsApp deep link, so the landing page can stay static. */
  router.get('/api/whatsapp-link', (request, response) => {
    const text = typeof request.query.text === 'string' ? request.query.text.slice(0, 400) : undefined;
    response.json({ url: whatsappDeepLink(text), number: config.whatsapp.businessNumber });
  });

  /**
   * Hand a WhatsApp customer over to the web app.
   *
   * Staff-only: minting a token bound to someone else's phone number is exactly
   * the capability an attacker would want, so it is not something an anonymous
   * caller can do. The agent sends the plain web app link instead.
   */
  router.post('/api/handoff', (request, response) => {
    try {
      const principal = resolvePrincipal(request);
      if (!principal.scopes.includes('order:read:any') && !principal.scopes.includes('admin:all')) {
        response.status(403).json({ error: 'missing_scope', message: 'Staff access required.' });
        return;
      }

      const body = (request.body ?? {}) as { phone?: string };
      if (!body.phone || !/^\+?[\d\s()-]{7,20}$/.test(body.phone)) {
        response.status(400).json({ error: 'missing_phone', message: 'A valid phone number is required.' });
        return;
      }

      response.json({
        subject: subjectForPhone(body.phone),
        token: webHandoffToken(body.phone),
        expiresInSeconds: 3_600,
        url: config.webAppUrl,
      });
    } catch (error) {
      const authError = error as AuthError;
      response.status(authError.status ?? 401).json({ error: authError.code, message: authError.message });
    }
  });

  return router;
}
