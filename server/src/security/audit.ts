/**
 * Hash-chained audit log.
 *
 * Every privileged decision — tool call, policy denial, payment claim, staff
 * verification — appends an entry whose hash covers the previous entry's hash.
 * Any retroactive edit or deletion breaks the chain, which `verifyChain`
 * detects. This matters because money moves out-of-band over Zelle: the log is
 * the record of who confirmed what, and when.
 */

import { createHash } from 'node:crypto';

export type AuditOutcome = 'allowed' | 'denied' | 'error';

export interface AuditEntry {
  seq: number;
  at: string;
  actor: string;
  actorRole: string;
  action: string;
  outcome: AuditOutcome;
  /** Order id, item id, conversation id — whatever the action targeted. */
  target?: string;
  reason?: string;
  /** Small, non-sensitive detail bag. Never store raw payment proofs here. */
  meta?: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

const GENESIS_HASH = '0'.repeat(64);
const MAX_IN_MEMORY_ENTRIES = 5_000;

/** Keys that must never be persisted, even if a caller passes them. */
const REDACT_KEYS = new Set([
  'token',
  'authorization',
  'password',
  'secret',
  'apikey',
  'api_key',
  'jwt',
  'servicerolekey',
  'authtoken',
]);

function sanitiseMeta(meta: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (REDACT_KEYS.has(key.toLowerCase().replace(/[-_\s]/g, ''))) {
      output[key] = '[redacted]';
      continue;
    }
    if (typeof value === 'string') {
      output[key] = value.length > 300 ? `${value.slice(0, 300)}…` : value;
    } else if (value === null || ['number', 'boolean'].includes(typeof value)) {
      output[key] = value;
    } else {
      try {
        const serialised = JSON.stringify(value);
        output[key] = serialised.length > 300 ? `${serialised.slice(0, 300)}…` : JSON.parse(serialised);
      } catch {
        output[key] = '[unserialisable]';
      }
    }
  }
  return output;
}

function computeHash(entry: Omit<AuditEntry, 'hash'>): string {
  // Stable field order — the hash must be reproducible.
  const canonical = JSON.stringify({
    seq: entry.seq,
    at: entry.at,
    actor: entry.actor,
    actorRole: entry.actorRole,
    action: entry.action,
    outcome: entry.outcome,
    target: entry.target ?? null,
    reason: entry.reason ?? null,
    meta: entry.meta ?? null,
    prevHash: entry.prevHash,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export interface AuditSink {
  persist(entry: AuditEntry): void | Promise<void>;
}

export class AuditLog {
  private entries: AuditEntry[] = [];
  private lastHash = GENESIS_HASH;
  private seq = 0;
  private sink?: AuditSink;

  /** Attach durable storage (Supabase). Until then entries stay in memory. */
  setSink(sink: AuditSink): void {
    this.sink = sink;
  }

  append(input: {
    actor: string;
    actorRole: string;
    action: string;
    outcome: AuditOutcome;
    target?: string;
    reason?: string;
    meta?: Record<string, unknown>;
  }): AuditEntry {
    this.seq += 1;

    const base: Omit<AuditEntry, 'hash'> = {
      seq: this.seq,
      at: new Date().toISOString(),
      actor: input.actor,
      actorRole: input.actorRole,
      action: input.action,
      outcome: input.outcome,
      target: input.target,
      reason: input.reason,
      meta: sanitiseMeta(input.meta),
      prevHash: this.lastHash,
    };

    const entry: AuditEntry = { ...base, hash: computeHash(base) };
    this.lastHash = entry.hash;

    this.entries.push(entry);
    if (this.entries.length > MAX_IN_MEMORY_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_IN_MEMORY_ENTRIES);
    }

    if (this.sink) {
      void Promise.resolve(this.sink.persist(entry)).catch((error: unknown) => {
        // Never let audit persistence failure break the request path, but make
        // it loud — a silent audit gap is worse than a noisy log.
        // eslint-disable-next-line no-console
        console.error('[audit] failed to persist entry', { seq: entry.seq, error: String(error) });
      });
    }

    return entry;
  }

  /** Recompute the chain. Returns the first index that fails, or null if intact. */
  verifyChain(): { intact: true } | { intact: false; brokenAtSeq: number; detail: string } {
    let expectedPrev = this.entries[0]?.prevHash ?? GENESIS_HASH;

    for (const entry of this.entries) {
      if (entry.prevHash !== expectedPrev) {
        return {
          intact: false,
          brokenAtSeq: entry.seq,
          detail: `prevHash mismatch: expected ${expectedPrev.slice(0, 12)}…, found ${entry.prevHash.slice(0, 12)}…`,
        };
      }
      const { hash, ...rest } = entry;
      const recomputed = computeHash(rest);
      if (recomputed !== hash) {
        return {
          intact: false,
          brokenAtSeq: entry.seq,
          detail: `entry contents were modified after write`,
        };
      }
      expectedPrev = hash;
    }

    return { intact: true };
  }

  tail(limit = 50): AuditEntry[] {
    return this.entries.slice(-Math.max(1, Math.min(limit, 500)));
  }

  forTarget(target: string, limit = 50): AuditEntry[] {
    return this.entries.filter((entry) => entry.target === target).slice(-limit);
  }

  get headHash(): string {
    return this.lastHash;
  }

  get size(): number {
    return this.seq;
  }
}

/** Process-wide audit log. */
export const auditLog = new AuditLog();
