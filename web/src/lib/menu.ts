import menuData from '../data/menu.json';
import type { CartLine, Menu, MenuItem, Quote, TraySize } from '../types';

/**
 * Bundled snapshot of server/src/data/menu.json (kept in sync by
 * scripts/sync-menu.mjs via the predev/prebuild hooks). Used for instant first
 * paint and as the offline fallback; GET /api/menu wins when reachable.
 */
export const localMenu = menuData as Menu;

export function isFullTrayOnly(item: MenuItem): boolean {
  return item.fullTrayOnly === true || item.prices.half === null;
}

export function unitPriceCents(item: MenuItem, size: TraySize): number {
  const price = size === 'half' ? item.prices.half : item.prices.full;
  return price ?? item.prices.full;
}

export function itemsByCategory(menu: Menu, categoryId: string): MenuItem[] {
  return menu.items.filter((item) => item.category === categoryId);
}

export function findItem(menu: Menu, itemId: string): MenuItem | undefined {
  return menu.items.find((item) => item.id === itemId);
}

/** Preview-only rate. The server /api/quote figure is authoritative. */
export const PREVIEW_TAX_BPS = 825;

/**
 * Local preview quote — instant UI feedback only, all integer cents.
 * Reconciled against POST /api/quote before payment.
 */
export function previewQuote(menu: Menu, cart: CartLine[]): Quote {
  const lines = cart.map((line) => {
    const item = findItem(menu, line.itemId);
    const unit = item ? unitPriceCents(item, line.size) : 0;
    return {
      itemId: line.itemId,
      size: line.size,
      quantity: line.quantity,
      unitPriceCents: unit,
      lineTotalCents: unit * line.quantity,
      name: item?.name,
    };
  });
  const subtotalCents = lines.reduce((total, line) => total + line.lineTotalCents, 0);
  const taxCents = Math.round((subtotalCents * PREVIEW_TAX_BPS) / 10000);
  const deliveryCents = 0;
  return {
    lines,
    subtotalCents,
    taxCents,
    deliveryCents,
    totalCents: subtotalCents + taxCents + deliveryCents,
  };
}

export function totalTrays(cart: CartLine[]): number {
  return cart.reduce((count, line) => count + line.quantity, 0);
}

/** Rough guest coverage from tray servings, for a helpful hint in the cart. */
export function estimatedGuests(menu: Menu, cart: CartLine[]): number {
  const servings = menu.trayServings;
  if (!servings) return 0;
  return cart.reduce(
    (guests, line) => guests + servings[line.size].min * line.quantity,
    0,
  );
}
