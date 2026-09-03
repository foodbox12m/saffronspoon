/**
 * Menu access layer.
 *
 * The menu is loaded once from a static JSON file and frozen. The language
 * model never invents menu items or prices: every lookup goes through this
 * module, and anything it cannot resolve to a known id is rejected.
 */

import menuJson from '../data/menu.json';
import type { Menu, MenuItem, TraySize } from '../types.js';

const menu = menuJson as unknown as Menu;

const byId = new Map<string, MenuItem>();
const byAlias = new Map<string, MenuItem>();

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

for (const item of menu.items) {
  byId.set(item.id, item);
  byAlias.set(normalise(item.name), item);
  for (const alias of item.aliases) byAlias.set(normalise(alias), item);
}

/** Validate the data file at boot so a bad edit cannot reach customers. */
export function assertMenuValid(): void {
  const ids = new Set<string>();
  const categoryIds = new Set(menu.categories.map((category) => category.id));

  for (const item of menu.items) {
    if (ids.has(item.id)) throw new Error(`Duplicate menu item id: ${item.id}`);
    ids.add(item.id);

    if (!categoryIds.has(item.category)) {
      throw new Error(`Menu item ${item.id} references unknown category ${item.category}`);
    }
    if (!Number.isInteger(item.prices.full) || item.prices.full <= 0) {
      throw new Error(`Menu item ${item.id} has an invalid full-tray price (must be integer cents)`);
    }
    if (item.prices.half !== null && (!Number.isInteger(item.prices.half) || item.prices.half <= 0)) {
      throw new Error(`Menu item ${item.id} has an invalid half-tray price (must be integer cents)`);
    }
    if (item.prices.half === null && item.fullTrayOnly !== true && !item.unit) {
      throw new Error(`Menu item ${item.id} has no half price but is not marked fullTrayOnly`);
    }
  }

  for (const item of menu.items) {
    for (const pairing of item.pairings) {
      if (!ids.has(pairing)) {
        throw new Error(`Menu item ${item.id} pairs with unknown item ${pairing}`);
      }
    }
  }
}

export function getMenu(): Menu {
  return menu;
}

export function listItems(): MenuItem[] {
  return menu.items;
}

export function getItem(itemId: string): MenuItem | undefined {
  return byId.get(itemId);
}

/**
 * Resolve free-form customer text ("mutton biryani", "chicken sixty five") to a
 * menu item. Exact id and alias matches win; otherwise we fall back to a token
 * overlap score so near-misses and typos still land. Returns undefined rather
 * than guessing when nothing scores well enough.
 */
export function resolveItem(query: string): MenuItem | undefined {
  const trimmed = query.trim();
  if (!trimmed) return undefined;

  const direct = byId.get(trimmed);
  if (direct) return direct;

  const normalised = normalise(trimmed);
  const alias = byAlias.get(normalised);
  if (alias) return alias;

  const queryTokens = new Set(normalised.split(' ').filter((token) => token.length > 2));
  if (queryTokens.size === 0) return undefined;

  let best: MenuItem | undefined;
  let bestScore = 0;

  for (const item of menu.items) {
    const haystack = normalise([item.name, ...item.aliases, item.protein, item.category].join(' '));
    const itemTokens = new Set(haystack.split(' '));
    let overlap = 0;
    for (const token of queryTokens) if (itemTokens.has(token)) overlap += 1;
    const score = overlap / queryTokens.size;
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }

  return bestScore >= 0.5 ? best : undefined;
}

/** True when the item can be ordered in the requested tray size. */
export function supportsSize(item: MenuItem, size: TraySize): boolean {
  return size === 'full' ? true : item.prices.half !== null;
}

/**
 * The single source of truth for unit price. Throws for unsupported sizes so a
 * hallucinated "half tray of marag" can never be priced.
 */
export function unitPriceCents(item: MenuItem, size: TraySize): number {
  if (size === 'full') return item.prices.full;
  const half = item.prices.half;
  if (half === null) {
    throw new Error(`${item.name} is only available as a full tray.`);
  }
  return half;
}

export function servingsFor(size: TraySize): { min: number; max: number } {
  return menu.trayServings[size];
}

export function itemsByCategory(categoryId: string): MenuItem[] {
  return menu.items.filter((item) => item.category === categoryId);
}

/** Keyword/facet search used by the `search_menu` MCP tool. */
export function searchMenu(options: {
  query?: string;
  category?: string;
  protein?: string;
  maxSpice?: number;
  excludeAllergens?: string[];
  limit?: number;
}): MenuItem[] {
  const { query, category, protein, maxSpice, excludeAllergens = [], limit = 10 } = options;
  const excluded = new Set(excludeAllergens.map((allergen) => allergen.toLowerCase()));

  let results = menu.items.filter((item) => {
    if (category && item.category !== category) return false;
    if (protein && item.protein !== protein.toLowerCase()) return false;
    if (typeof maxSpice === 'number' && item.spice > maxSpice) return false;
    for (const allergen of item.allergens) {
      if (excluded.has(allergen.toLowerCase())) return false;
    }
    return true;
  });

  if (query && query.trim()) {
    const tokens = normalise(query).split(' ').filter((token) => token.length > 2);
    if (tokens.length > 0) {
      results = results
        .map((item) => {
          const haystack = normalise(
            [item.name, ...item.aliases, item.description, item.protein, item.category].join(' '),
          );
          let score = 0;
          for (const token of tokens) if (haystack.includes(token)) score += 1;
          if (item.popular) score += 0.25;
          return { item, score };
        })
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.item);
    }
  } else {
    results = [...results].sort((a, b) => Number(Boolean(b.popular)) - Number(Boolean(a.popular)));
  }

  return results.slice(0, Math.max(1, Math.min(limit, 25)));
}

/** Compact catalogue string injected into the agent's system prompt. */
export function menuForPrompt(): string {
  const lines: string[] = [];
  for (const category of menu.categories) {
    const items = itemsByCategory(category.id);
    if (items.length === 0) continue;
    lines.push(`${category.name}:`);
    for (const item of items) {
      const half = item.prices.half === null
        ? (item.unit ? `per ${item.unit}` : 'full tray only')
        : `half $${item.prices.half / 100}`;
      lines.push(
        `  - ${item.name} (id: ${item.id}) — full $${item.prices.full / 100}, ${half}` +
          ` · spice ${item.spice}/5 · ${item.protein}` +
          (item.allergens.length ? ` · contains ${item.allergens.join(', ')}` : ''),
      );
    }
  }
  return lines.join('\n');
}
