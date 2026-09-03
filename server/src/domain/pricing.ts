/**
 * Deterministic pricing.
 *
 * The language model is never allowed to compute a total. It may only call
 * `quoteOrder`, and the number this module returns is the number the customer
 * pays. All arithmetic is integer-cents; rounding happens exactly once, on tax,
 * using round-half-up.
 */

import { config } from '../config.js';
import type { OrderLine, OrderLineInput, Quote, TraySize } from '../types.js';
import { getItem, servingsFor, supportsSize, unitPriceCents } from './menu.js';

const MAX_QUANTITY_PER_LINE = 20;
const MAX_LINES_PER_ORDER = 25;

export class PricingError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'PricingError';
  }
}

function isTraySize(value: unknown): value is TraySize {
  return value === 'full' || value === 'half';
}

/** Round-half-up on a non-negative integer division. */
function roundHalfUp(numerator: number, denominator: number): number {
  return Math.floor((numerator * 2 + denominator) / (denominator * 2));
}

/**
 * Merge duplicate item+size pairs so "2 full trays" and "1 more full tray"
 * collapse into a single, correctly-priced line.
 */
function normaliseLines(inputs: OrderLineInput[]): OrderLineInput[] {
  const merged = new Map<string, OrderLineInput>();

  for (const input of inputs) {
    if (!input || typeof input.itemId !== 'string') {
      throw new PricingError('invalid_line', 'Each order line needs an itemId.');
    }
    if (!isTraySize(input.size)) {
      throw new PricingError('invalid_size', `Tray size must be "full" or "half" (got "${String(input.size)}").`);
    }
    const quantity = Number(input.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new PricingError('invalid_quantity', `Quantity for ${input.itemId} must be a whole number of at least 1.`);
    }

    const key = `${input.itemId}::${input.size}`;
    const existing = merged.get(key);
    if (existing) {
      existing.quantity += quantity;
    } else {
      merged.set(key, { itemId: input.itemId, size: input.size, quantity });
    }
  }

  return [...merged.values()];
}

/**
 * Price an order. Pure function: same input always yields the same output.
 */
export function quoteOrder(inputs: OrderLineInput[], options: { guestCount?: number } = {}): Quote {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new PricingError('empty_order', 'An order needs at least one tray.');
  }

  const normalised = normaliseLines(inputs);

  if (normalised.length > MAX_LINES_PER_ORDER) {
    throw new PricingError(
      'too_many_lines',
      `An order can hold at most ${MAX_LINES_PER_ORDER} distinct trays. Please split it or call us.`,
    );
  }

  const lines: OrderLine[] = [];
  let subtotalCents = 0;
  let servesMin = 0;
  let servesMax = 0;
  const notices: string[] = [];

  for (const input of normalised) {
    const item = getItem(input.itemId);
    if (!item) {
      throw new PricingError('unknown_item', `"${input.itemId}" is not on our menu.`);
    }
    if (input.quantity > MAX_QUANTITY_PER_LINE) {
      throw new PricingError(
        'quantity_too_large',
        `${input.quantity} trays of ${item.name} exceeds our online limit of ${MAX_QUANTITY_PER_LINE}. Call us for large events.`,
      );
    }
    if (!supportsSize(item, input.size)) {
      throw new PricingError('size_unavailable', `${item.name} is only available as a full tray.`);
    }

    const unit = unitPriceCents(item, input.size);
    const lineTotal = unit * input.quantity;
    const serving = servingsFor(input.size);

    lines.push({
      itemId: item.id,
      name: item.name,
      size: input.size,
      quantity: input.quantity,
      unitPriceCents: unit,
      lineTotalCents: lineTotal,
      servesMin: serving.min * input.quantity,
      servesMax: serving.max * input.quantity,
    });

    subtotalCents += lineTotal;
    servesMin += serving.min * input.quantity;
    servesMax += serving.max * input.quantity;
  }

  // Sort for stable output regardless of the order the model listed items in.
  lines.sort((a, b) => (a.itemId === b.itemId ? a.size.localeCompare(b.size) : a.itemId.localeCompare(b.itemId)));

  const taxCents = roundHalfUp(subtotalCents * config.payments.taxBasisPoints, 10_000);

  const qualifiesForFreeDelivery = subtotalCents >= config.payments.freeDeliveryThresholdCents;
  const deliveryCents = qualifiesForFreeDelivery ? 0 : config.payments.deliveryFeeCents;
  if (config.payments.deliveryFeeCents > 0 && qualifiesForFreeDelivery) {
    notices.push('Delivery is on us at this order size.');
  }

  const totalCents = subtotalCents + taxCents + deliveryCents;
  const depositDueCents = roundHalfUp(totalCents * config.payments.depositPercent, 100);

  const guestCount = options.guestCount;
  if (typeof guestCount === 'number' && Number.isFinite(guestCount) && guestCount > 0) {
    if (servesMax < guestCount) {
      notices.push(
        `This feeds roughly ${servesMin}-${servesMax} guests, which is short for ${guestCount}. Consider adding a tray.`,
      );
    } else if (servesMin > guestCount * 1.6) {
      notices.push(
        `This feeds roughly ${servesMin}-${servesMax} guests — comfortably more than ${guestCount}. You could size down.`,
      );
    }
  }

  return {
    lines,
    subtotalCents,
    taxCents,
    deliveryCents,
    totalCents,
    depositDueCents,
    servesMin,
    servesMax,
    currency: 'USD',
    notices,
  };
}

/** Display helper. Cents in, "$1,234.56" out. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(Math.round(cents));
  const dollars = Math.floor(absolute / 100).toLocaleString('en-US');
  const remainder = String(absolute % 100).padStart(2, '0');
  return `${sign}$${dollars}.${remainder}`;
}

/** Plain-text quote for WhatsApp, where we have no rich formatting. */
export function formatQuoteForChat(quote: Quote): string {
  const lines = quote.lines.map(
    (line) =>
      `• ${line.quantity} × ${line.name} (${line.size} tray) — ${formatCents(line.lineTotalCents)}`,
  );

  const parts = [
    ...lines,
    '',
    `Subtotal: ${formatCents(quote.subtotalCents)}`,
    `Tax: ${formatCents(quote.taxCents)}`,
  ];

  if (quote.deliveryCents > 0) parts.push(`Delivery: ${formatCents(quote.deliveryCents)}`);
  parts.push(`*Total: ${formatCents(quote.totalCents)}*`);

  if (config.payments.depositPercent < 100) {
    parts.push(`Deposit to lock your date (${config.payments.depositPercent}%): ${formatCents(quote.depositDueCents)}`);
  }

  parts.push('', `Feeds roughly ${quote.servesMin}-${quote.servesMax} guests.`);
  for (const notice of quote.notices) parts.push(`Note: ${notice}`);

  return parts.join('\n');
}
