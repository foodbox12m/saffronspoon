/**
 * Zelle payment support.
 *
 * Zelle has no merchant API: money arrives out-of-band in the owner's bank
 * account. So the flow is built around reconciliation rather than capture:
 *
 *   1. Each order gets a short, unambiguous memo code (SS-XXXXX).
 *   2. The customer is told to put that code in the Zelle memo field.
 *   3. The customer marks "I've paid" and may attach a screenshot.
 *   4. A named staff member matches the bank deposit to the memo code and
 *      verifies it. Only then does the order become confirmed.
 *
 * Nothing in this module can mark a payment verified — that requires the
 * `payment:verify` scope and goes through the policy gate.
 */

import { randomInt } from 'node:crypto';
import QRCode from 'qrcode';
import { config } from '../config.js';
import { formatCents } from '../domain/pricing.js';

/**
 * Crockford-style alphabet: no I, L, O or U. Customers read these codes aloud
 * and retype them into a banking app, so visual ambiguity is the enemy.
 */
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 5;

export function generateMemoCode(): string {
  let code = '';
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    code += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  }
  return `SS-${code}`;
}

const MEMO_PATTERN = /^SS-[0-9A-HJ-NP-Z]{5}$/;

export function isValidMemoCode(code: string): boolean {
  return MEMO_PATTERN.test(code.trim().toUpperCase());
}

/**
 * Pull a memo code out of free-form text — a pasted bank memo, a WhatsApp
 * message, an OCR'd screenshot caption. Tolerates missing hyphen, lowercase,
 * and common transcription slips (O→0, I/L→1).
 */
export function extractMemoCode(text: string): string | null {
  const normalised = String(text ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

  const match = /SS([0-9A-Z]{5})/.exec(normalised);
  if (!match?.[1]) return null;

  const corrected = match[1].replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V');
  const candidate = `SS-${corrected}`;
  return isValidMemoCode(candidate) ? candidate : null;
}

export interface PaymentInstruction {
  zelleId: string;
  recipientName: string;
  memoCode: string;
  amountCents: number;
  amountDisplay: string;
  /** True when only a deposit is due right now. */
  isDeposit: boolean;
  balanceCents: number;
  /** Text the customer should copy into the Zelle memo field. */
  memoText: string;
  steps: string[];
}

export function buildPaymentInstruction(input: {
  memoCode: string;
  totalCents: number;
  depositDueCents: number;
  payFull?: boolean;
}): PaymentInstruction {
  const payFull = input.payFull === true || config.payments.depositPercent >= 100;
  const amountCents = payFull ? input.totalCents : input.depositDueCents;
  const balanceCents = Math.max(0, input.totalCents - amountCents);

  const steps = [
    `Open your banking app and choose Zelle.`,
    `Send ${formatCents(amountCents)} to ${config.payments.zelleId} (${config.payments.zelleRecipientName}).`,
    `Put ${input.memoCode} in the memo / note field — this is how we match your payment to your order.`,
    `Come back and tap "I've paid". Attaching a screenshot speeds up confirmation.`,
  ];

  if (balanceCents > 0) {
    steps.push(`The remaining ${formatCents(balanceCents)} is due on delivery.`);
  }

  return {
    zelleId: config.payments.zelleId,
    recipientName: config.payments.zelleRecipientName,
    memoCode: input.memoCode,
    amountCents,
    amountDisplay: formatCents(amountCents),
    isDeposit: !payFull && balanceCents > 0,
    balanceCents,
    memoText: input.memoCode,
    steps,
  };
}

/**
 * QR payload. Zelle publishes no public deep-link URI scheme, so encoding a
 * fake one would produce a code that banking apps reject. Instead the QR points
 * at our own hosted payment page, which shows the Zelle ID, exact amount and
 * memo code. That page works in every camera app and cannot go stale.
 */
export function paymentPageUrl(orderId: string): string {
  const base = config.publicBaseUrl.replace(/\/+$/, '');
  return `${base}/pay/${encodeURIComponent(orderId)}`;
}

export async function generatePaymentQrDataUrl(orderId: string): Promise<string> {
  return QRCode.toDataURL(paymentPageUrl(orderId), {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 512,
    color: { dark: '#1a1a1aff', light: '#ffffffff' },
  });
}

export async function generatePaymentQrPng(orderId: string): Promise<Buffer> {
  return QRCode.toBuffer(paymentPageUrl(orderId), {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 512,
    type: 'png',
  });
}

/** Plain-text payment message for WhatsApp. */
export function formatPaymentInstructionForChat(instruction: PaymentInstruction, orderId: string): string {
  return [
    instruction.isDeposit
      ? `*Deposit due: ${instruction.amountDisplay}*`
      : `*Amount due: ${instruction.amountDisplay}*`,
    '',
    `Zelle to: ${instruction.zelleId}`,
    `Name: ${instruction.recipientName}`,
    `Memo: *${instruction.memoCode}*`,
    '',
    'The memo code is what links your payment to your order — please include it.',
    '',
    `Pay page (with QR): ${paymentPageUrl(orderId)}`,
    '',
    "Once you've sent it, reply *PAID* and send a screenshot if you have one.",
  ].join('\n');
}

/**
 * Reconciliation helper. Given a claimed amount and the amount we expect,
 * classify the match so staff see the discrepancy rather than eyeballing it.
 */
export type ReconciliationVerdict = 'exact' | 'short' | 'over' | 'deposit_only';

export interface Reconciliation {
  verdict: ReconciliationVerdict;
  expectedCents: number;
  receivedCents: number;
  differenceCents: number;
  summary: string;
}

export function reconcile(input: {
  receivedCents: number;
  totalCents: number;
  depositDueCents: number;
}): Reconciliation {
  const { receivedCents, totalCents, depositDueCents } = input;
  const difference = receivedCents - totalCents;

  if (difference === 0) {
    return {
      verdict: 'exact',
      expectedCents: totalCents,
      receivedCents,
      differenceCents: 0,
      summary: `Paid in full (${formatCents(receivedCents)}).`,
    };
  }

  if (depositDueCents > 0 && receivedCents === depositDueCents) {
    return {
      verdict: 'deposit_only',
      expectedCents: totalCents,
      receivedCents,
      differenceCents: difference,
      summary: `Deposit received (${formatCents(receivedCents)}). Balance ${formatCents(totalCents - receivedCents)} due on delivery.`,
    };
  }

  if (difference < 0) {
    return {
      verdict: 'short',
      expectedCents: totalCents,
      receivedCents,
      differenceCents: difference,
      summary: `Short by ${formatCents(Math.abs(difference))}. Expected ${formatCents(totalCents)}, received ${formatCents(receivedCents)}.`,
    };
  }

  return {
    verdict: 'over',
    expectedCents: totalCents,
    receivedCents,
    differenceCents: difference,
    summary: `Overpaid by ${formatCents(difference)} — refund or credit required.`,
  };
}
