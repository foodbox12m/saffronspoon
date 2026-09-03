/**
 * Baileys WhatsApp adapter (no Twilio account required).
 *
 * Baileys drives WhatsApp Web directly by pairing with a phone via QR code. It
 * is the zero-cost path and good for getting started, with real trade-offs you
 * should know about before choosing it:
 *
 *   * It is an unofficial client. WhatsApp can ban the number.
 *   * The process must stay alive and hold session files on disk, so it needs a
 *     persistent host (Render with a disk, a VPS) — not a serverless function.
 *   * Restarting from a cold disk means re-scanning the QR code.
 *
 * For a real business, Twilio is the sturdier choice. This module is therefore
 * OPTIONAL and loaded lazily: `@whiskeysockets/baileys` is not in package.json,
 * so nothing breaks if you never use it. Install it only if you set
 * WHATSAPP_PROVIDER=baileys:
 *
 *   npm install @whiskeysockets/baileys qrcode-terminal
 */

import { config } from '../config.js';
import type { InboundWhatsAppMessage } from './twilio.js';

type MessageHandler = (message: InboundWhatsAppMessage) => Promise<void>;

interface BaileysSocket {
  ev: { on: (event: string, listener: (payload: unknown) => void) => void };
  sendMessage: (jid: string, content: { text: string }) => Promise<unknown>;
  user?: { id: string };
}

let socket: BaileysSocket | null = null;

/** Convert a WhatsApp JID (14085551234@s.whatsapp.net) to +14085551234. */
function jidToPhone(jid: string): string {
  const digits = jid.split('@')[0]?.split(':')[0] ?? '';
  return digits ? `+${digits}` : '';
}

function phoneToJid(phone: string): string {
  const digits = phone.replace(/[^\d]/g, '');
  return `${digits}@s.whatsapp.net`;
}

export async function startBaileys(onMessage: MessageHandler): Promise<void> {
  let baileys: Record<string, unknown>;
  try {
    // Dynamic import through an indirect specifier so this optional dependency is
    // not required at compile time. A missing package becomes the clear message
    // below rather than a module-resolution failure at build or boot.
    const specifier = '@whiskeysockets/baileys';
    baileys = (await import(/* @vite-ignore */ specifier)) as unknown as Record<string, unknown>;
  } catch {
    throw new Error(
      'WHATSAPP_PROVIDER=baileys but @whiskeysockets/baileys is not installed.\n' +
        'Run: npm install @whiskeysockets/baileys qrcode-terminal\n' +
        'Or set WHATSAPP_PROVIDER=twilio instead.',
    );
  }

  const makeWASocket = (baileys.default ?? baileys.makeWASocket) as (options: unknown) => BaileysSocket;
  const useMultiFileAuthState = baileys.useMultiFileAuthState as (
    folder: string,
  ) => Promise<{ state: unknown; saveCreds: () => Promise<void> }>;
  const DisconnectReason = baileys.DisconnectReason as Record<string, number>;

  const { state, saveCreds } = await useMultiFileAuthState(config.whatsapp.baileys.authDir);

  socket = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    // Identify as a desktop client; mobile identifiers are more ban-prone.
    browser: ['saffron & spoon', 'Desktop', '1.0.0'],
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  socket.ev.on('creds.update', () => {
    void saveCreds();
  });

  socket.ev.on('connection.update', (payload) => {
    const update = payload as {
      connection?: string;
      lastDisconnect?: { error?: { output?: { statusCode?: number } } };
      qr?: string;
    };

    if (update.qr) {
      // eslint-disable-next-line no-console
      console.log('[baileys] Scan this QR code with WhatsApp → Linked devices.');
    }

    if (update.connection === 'open') {
      // eslint-disable-next-line no-console
      console.log(`[baileys] connected as ${socket?.user?.id ?? 'unknown'}`);
    }

    if (update.connection === 'close') {
      const statusCode = update.lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason?.loggedOut;

      if (loggedOut) {
        // eslint-disable-next-line no-console
        console.error('[baileys] logged out. Delete the auth dir and re-pair.');
        return;
      }

      // eslint-disable-next-line no-console
      console.warn(`[baileys] connection closed (${statusCode ?? 'unknown'}) — reconnecting in 5s.`);
      setTimeout(() => {
        void startBaileys(onMessage);
      }, 5_000);
    }
  });

  socket.ev.on('messages.upsert', (payload) => {
    const batch = payload as {
      type?: string;
      messages?: Array<{
        key?: { remoteJid?: string; fromMe?: boolean; id?: string };
        pushName?: string;
        message?: {
          conversation?: string;
          extendedTextMessage?: { text?: string };
          imageMessage?: { mimetype?: string; caption?: string };
        };
      }>;
    };

    if (batch.type !== 'notify') return;

    for (const raw of batch.messages ?? []) {
      // Ignore our own messages and group chats.
      if (raw.key?.fromMe) continue;
      const jid = raw.key?.remoteJid ?? '';
      if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') continue;

      const text =
        raw.message?.conversation ??
        raw.message?.extendedTextMessage?.text ??
        raw.message?.imageMessage?.caption ??
        '';

      const media = raw.message?.imageMessage
        ? [{ url: '', contentType: raw.message.imageMessage.mimetype ?? 'image/jpeg' }]
        : [];

      if (!text && media.length === 0) continue;

      void onMessage({
        from: jidToPhone(jid),
        to: config.whatsapp.businessNumber,
        body: text,
        messageSid: raw.key?.id ?? '',
        ...(raw.pushName ? { profileName: raw.pushName } : {}),
        media,
      }).catch((error: unknown) => {
        // eslint-disable-next-line no-console
        console.error('[baileys] handler failed', error);
      });
    }
  });
}

export async function sendBaileysMessage(to: string, body: string): Promise<void> {
  if (!socket) {
    // eslint-disable-next-line no-console
    console.warn('[baileys] socket not connected — message not sent.');
    return;
  }
  await socket.sendMessage(phoneToJid(to), { text: body });
}

export function baileysReady(): boolean {
  return socket !== null;
}
