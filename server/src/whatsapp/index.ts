/**
 * WhatsApp routing layer.
 *
 * Provider-agnostic: the rest of the app calls `sendWhatsApp` and
 * `handleInboundWhatsApp` and never knows whether Twilio or Baileys is behind it.
 *
 * This is also where the two shortcut commands live. "PAID" and a memo code are
 * handled deterministically rather than being left to the model, because those
 * are the two messages where a misunderstanding costs money.
 */

import { config } from '../config.js';
import { handleCustomerMessage } from '../agent/orchestrator.js';
import { getStore } from '../db/store.js';
import { formatCents } from '../domain/pricing.js';
import { extractMemoCode } from '../payments/zelle.js';
import { callTool } from '../mcp/tools.js';
import { issueToken, scopesForRole, type Principal } from '../security/index.js';
import { sendBaileysMessage, startBaileys } from './baileys.js';
import { sendTwilioMessage, type InboundWhatsAppMessage } from './twilio.js';

export type { InboundWhatsAppMessage };

/** Stable identity for a WhatsApp customer, used as the JWT subject. */
export function subjectForPhone(phone: string): string {
  return `whatsapp:${phone.replace(/[^\d+]/g, '')}`;
}

function principalForPhone(phone: string, displayName?: string): Principal {
  const subject = subjectForPhone(phone);
  return {
    subject,
    role: 'agent',
    scopes: scopesForRole('agent'),
    ...(displayName ? { displayName } : {}),
  };
}

/** Mint a short-lived token so the web app can resume a WhatsApp order. */
export function webHandoffToken(phone: string): string {
  return issueToken({ subject: subjectForPhone(phone), role: 'customer' }, 3_600);
}

export async function sendWhatsApp(to: string, body: string): Promise<void> {
  switch (config.whatsapp.provider) {
    case 'twilio':
      await sendTwilioMessage(to, body);
      return;
    case 'baileys':
      await sendBaileysMessage(to, body);
      return;
    default:
      // eslint-disable-next-line no-console
      console.warn(`[whatsapp] provider "none" — reply to ${to} not sent:\n${body}`);
  }
}

/** Notify the owner when something needs a human. */
export async function notifyAdmins(body: string): Promise<void> {
  const recipients = config.ops.adminNotifyNumbers;
  if (recipients.length === 0) {
    // eslint-disable-next-line no-console
    console.info(`[whatsapp] no ADMIN_NOTIFY_NUMBERS set. Alert was:\n${body}`);
    return;
  }

  await Promise.allSettled(recipients.map((recipient) => sendWhatsApp(recipient, body)));
}

const PAID_PATTERN = /^\s*(paid|i\s*(have\s*)?paid|payment\s*(sent|done)|sent|done)\b/i;

/**
 * Deterministic handling for "PAID".
 * Returns a reply string when it handled the message, or null to fall through
 * to the agent.
 */
async function handlePaidShortcut(
  message: InboundWhatsAppMessage,
  principal: Principal,
): Promise<string | null> {
  const looksLikePaid = PAID_PATTERN.test(message.body);
  const memoInMessage = extractMemoCode(message.body);
  const hasProofImage = message.media.some((item) => item.contentType.startsWith('image/'));

  if (!looksLikePaid && !memoInMessage && !hasProofImage) return null;

  const store = getStore();

  // Prefer an explicit memo code; otherwise use the customer's latest unpaid order.
  let order = memoInMessage ? await store.getOrderByMemoCode(memoInMessage) : null;

  if (!order) {
    const recent = await store.listOrdersByOwner(principal.subject, 5);
    order = recent.find((candidate) => candidate.paymentStatus === 'unpaid') ?? recent[0] ?? null;
  }

  if (!order) {
    if (memoInMessage) {
      return `I couldn't find an order with the code ${memoInMessage}. Could you double-check it? It looks like SS-4K7QP.`;
    }
    return null; // No order yet — let the agent take the conversation.
  }

  if (order.paymentStatus === 'verified') {
    return `That one's already confirmed — order ${order.memoCode} for ${order.event.date} is locked in. Nothing else needed.`;
  }

  const result = await callTool(
    'claim_payment',
    {
      orderId: order.id,
      note: message.body.slice(0, 400),
      ...(hasProofImage ? { proofUrl: 'whatsapp-media' } : {}),
    },
    principal,
  );

  if (!result.ok) {
    return `I couldn't record that just now — ${result.error?.message ?? 'please try again in a moment'}.`;
  }

  await notifyAdmins(
    [
      '*Payment claimed*',
      `Order: ${order.memoCode}`,
      `Customer: ${order.customer.name || message.profileName || message.from} (${message.from})`,
      `Event: ${order.event.date} · ${order.event.guestCount} guests`,
      `Amount: ${formatCents(order.totalCents)} (deposit ${formatCents(order.depositDueCents)})`,
      hasProofImage ? 'Screenshot attached in WhatsApp.' : 'No screenshot attached.',
      '',
      'Match it against the bank deposit, then verify it.',
    ].join('\n'),
  );

  return [
    `Got it — I've logged your payment for *${order.memoCode}*.`,
    '',
    `Amount on file: ${formatCents(order.totalCents)}.`,
    '',
    "Our team will match it against the bank deposit and confirm. You'll hear from us shortly — it isn't locked in until then.",
    hasProofImage ? '' : 'If you have a screenshot, send it over and it speeds things up.',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Entry point for an inbound WhatsApp message from any provider.
 */
export async function handleInboundWhatsApp(message: InboundWhatsAppMessage): Promise<string> {
  const principal = principalForPhone(message.from, message.profileName);

  try {
    const shortcut = await handlePaidShortcut(message, principal);
    if (shortcut) {
      await sendWhatsApp(message.from, shortcut);
      return shortcut;
    }

    const reply = await handleCustomerMessage({
      principal,
      channel: 'whatsapp',
      participant: subjectForPhone(message.from),
      message: message.body,
    });

    await sendWhatsApp(message.from, reply.text);
    return reply.text;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[whatsapp] inbound handling failed', error);
    const apology =
      'Sorry — something went wrong on our side. Please send that again, or order here: ' + config.webAppUrl;
    await sendWhatsApp(message.from, apology).catch(() => undefined);
    return apology;
  }
}

/** Start the provider's long-lived connection, if it needs one. */
export async function startWhatsApp(): Promise<void> {
  if (config.whatsapp.provider !== 'baileys') return;
  await startBaileys(async (message) => {
    await handleInboundWhatsApp(message);
  });
}

/** wa.me deep link with a prefilled first message. */
export function whatsappDeepLink(prefilledText?: string): string {
  const number = config.whatsapp.businessNumber.replace(/[^\d]/g, '');
  const text = prefilledText ?? "Hi! I'd like a catering quote.";
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}
