import { WHATSAPP_NUMBER } from './env';
import { formatCents } from './money';
import { findItem } from './menu';
import type { CartLine, EventDetails, Menu, Quote, TraySize } from '../types';

const sizeLabel = (size: TraySize) => (size === 'full' ? 'Full tray' : 'Half tray');

export function buildOrderMessage(
  menu: Menu,
  cart: CartLine[],
  quote: Quote,
  details?: Partial<EventDetails>,
  memoCode?: string,
): string {
  const lines: string[] = ['Hi saffron & spoon! I would like to place a catering order.', ''];
  cart.forEach((line) => {
    const item = findItem(menu, line.itemId);
    const unit = quote.lines.find((q) => q.itemId === line.itemId && q.size === line.size);
    lines.push(
      `• ${line.quantity} × ${item?.name ?? line.itemId} — ${sizeLabel(line.size)} (${formatCents(
        unit?.lineTotalCents ?? 0,
        menu.currency,
      )})`,
    );
  });
  lines.push('', `Order total: ${formatCents(quote.totalCents, menu.currency)}`);
  if (details?.name) lines.push(`Name: ${details.name}`);
  if (details?.phone) lines.push(`Phone: ${details.phone}`);
  if (details?.date) lines.push(`Event date: ${details.date}`);
  if (details?.guestCount) lines.push(`Guests: ${details.guestCount}`);
  if (details?.address) lines.push(`Delivery address: ${details.address}`);
  if (details?.notes) lines.push(`Notes: ${details.notes}`);
  if (memoCode) lines.push(`Reference: ${memoCode}`);
  return lines.join('\n');
}

export function whatsappLink(message: string): string {
  const base = WHATSAPP_NUMBER ? `https://wa.me/${WHATSAPP_NUMBER}` : 'https://wa.me/';
  return `${base}?text=${encodeURIComponent(message)}`;
}
