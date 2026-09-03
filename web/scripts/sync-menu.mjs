#!/usr/bin/env node
// Copies the canonical menu (server/src/data/menu.json) into src/data/menu.json.
// The server copy is the single source of truth; prices are INTEGER CENTS.
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '../../server/src/data/menu.json');
const target = resolve(here, '../src/data/menu.json');

try {
  const raw = readFileSync(source, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.items) || !Array.isArray(parsed.categories)) {
    throw new Error('menu.json is missing items[] or categories[]');
  }
  for (const item of parsed.items) {
    const full = item?.prices?.full;
    if (!Number.isInteger(full)) {
      throw new Error(`item ${item?.id}: prices.full must be an integer cents value`);
    }
    const half = item?.prices?.half;
    if (half !== null && !Number.isInteger(half)) {
      throw new Error(`item ${item?.id}: prices.half must be integer cents or null`);
    }
  }
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  console.log(`[sync-menu] ${parsed.items.length} items synced -> src/data/menu.json`);
} catch (error) {
  console.error(`[sync-menu] failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
