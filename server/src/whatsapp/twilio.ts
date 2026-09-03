/**
 * Twilio WhatsApp adapter.
 *
 * Inbound: Twilio POSTs form-encoded webhooks. We verify the X-Twilio-Signature
 * HMAC before trusting a single field — without it, anyone who learns the
 * webhook URL can impersonate a customer and place orders.
 *
 * Outbound: plain REST call to the Messages API. No SDK, to keep the dependency
 * surface small.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

export interface InboundWhatsAppMessage {
  /** E.164 with the whatsapp: prefix stripped, e.g. +14085551234 */
  from: string;
  to: string;
  body: string;
  messageSid: string;
  profileName?: string;
  /** Media the customer attached — used for Zelle payment screenshots. */
  media: Array<{ url: string; contentType: string }>;
}

/**
 * Twilio's signature scheme: HMAC-SHA1 over the full URL concatenated with each
 * POST parameter sorted by key, keyed with the auth token.
 * https://www.twilio.com/docs/usage/security#validating-requests
 */
export function validateTwilioSignature(input: {
  signature: string | undefined;
  url: string;
  params: Record<string, string>;
  authToken: string;
}): boolean {
  if (!input.signature || !input.authToken) return false;

  const sortedKeys = Object.keys(input.params).sort();
  let payload = input.url;
  for (const key of sortedKeys) {
    payload += key + (input.params[key] ?? '');
  }

  const expected = createHmac('sha1', input.authToken).update(Buffer.from(payload, 'utf8')).digest('base64');

  const provided = Buffer.from(input.signature);
  const computed = Buffer.from(expected);
  if (provided.length !== computed.length) return false;
  return timingSafeEqual(provided, computed);
}

function stripPrefix(value: string): string {
  return value.replace(/^whatsapp:/i, '').trim();
}

/** Turn a Twilio webhook body into our internal shape. */
export function parseTwilioWebhook(params: Record<string, string>): InboundWhatsAppMessage {
  const mediaCount = Number.parseInt(params.NumMedia ?? '0', 10) || 0;
  const media: InboundWhatsAppMessage['media'] = [];

  for (let index = 0; index < Math.min(mediaCount, 5); index += 1) {
    const url = params[`MediaUrl${index}`];
    const contentType = params[`MediaContentType${index}`];
    if (url) media.push({ url, contentType: contentType ?? 'application/octet-stream' });
  }

  return {
    from: stripPrefix(params.From ?? ''),
    to: stripPrefix(params.To ?? ''),
    body: params.Body ?? '',
    messageSid: params.MessageSid ?? params.SmsMessageSid ?? '',
    ...(params.ProfileName ? { profileName: params.ProfileName } : {}),
    media,
  };
}

/**
 * Send a WhatsApp message. WhatsApp caps message bodies, so long replies are
 * split on paragraph boundaries rather than truncated mid-sentence.
 */
export async function sendTwilioMessage(to: string, body: string): Promise<void> {
  const { accountSid, authToken, from } = config.whatsapp.twilio;

  if (!accountSid || !authToken || !from) {
    // eslint-disable-next-line no-console
    console.warn('[twilio] not configured — message not sent. Body was:\n', body);
    return;
  }

  for (const chunk of splitForWhatsApp(body)) {
    const form = new URLSearchParams({
      To: to.startsWith('whatsapp:') ? to : `whatsapp:${to}`,
      From: from.startsWith('whatsapp:') ? from : `whatsapp:${from}`,
      Body: chunk,
    });

    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Twilio send failed (${response.status}): ${detail.slice(0, 300)}`);
    }
  }
}

const WHATSAPP_MAX_CHARS = 1_500;

export function splitForWhatsApp(body: string, max = WHATSAPP_MAX_CHARS): string[] {
  const text = body.trim();
  if (text.length <= max) return [text];

  const chunks: string[] = [];
  let current = '';

  for (const paragraph of text.split(/\n\n+/)) {
    if (paragraph.length > max) {
      // A single oversized paragraph: fall back to sentence boundaries.
      for (const sentence of paragraph.split(/(?<=[.!?])\s+/)) {
        if ((current + ' ' + sentence).trim().length > max) {
          if (current) chunks.push(current.trim());
          current = sentence;
        } else {
          current = `${current} ${sentence}`.trim();
        }
      }
      continue;
    }

    if ((current + '\n\n' + paragraph).trim().length > max) {
      if (current) chunks.push(current.trim());
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

/**
 * Fetch a media attachment (a Zelle screenshot). Twilio media URLs require the
 * account credentials, so this cannot be done from the browser.
 */
export async function fetchTwilioMedia(url: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  const { accountSid, authToken } = config.whatsapp.twilio;
  if (!accountSid || !authToken) return null;

  const response = await fetch(url, {
    headers: { authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}` },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) return null;

  const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
  if (!/^image\/(png|jpe?g|webp)$|^application\/pdf$/i.test(contentType)) {
    // Refuse anything that is not a plausible payment proof.
    return null;
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > 5 * 1024 * 1024) return null;

  return { buffer: Buffer.from(arrayBuffer), contentType };
}
