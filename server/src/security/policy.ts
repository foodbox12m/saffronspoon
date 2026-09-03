/**
 * The single policy gate.
 *
 * Every privileged operation — REST route, MCP tool, WhatsApp action — passes
 * through `enforce()`. One function means one place to reason about
 * authorisation, one place that rate-limits, and one place that writes the audit
 * entry. If code reaches a handler, it was authorised here.
 */

import { config } from '../config.js';
import { auditLog, type AuditOutcome } from './audit.js';
import type { Principal } from './auth.js';
import { createRateLimiter, startRateLimitSweeper, type RateLimiter } from './ratelimit.js';
import { hasScope, type Scope } from './scopes.js';

export class PolicyError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSeconds?: number;

  constructor(code: string, message: string, status: number, retryAfterSeconds?: number) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
    this.name = 'PolicyError';
  }
}

const standardLimiter: RateLimiter = createRateLimiter({
  name: 'standard',
  windowMs: config.security.rateLimitWindowMs,
  maxRequests: config.security.rateLimitMaxRequests,
});

/** The agent loop is the expensive path, so it gets a tighter budget. */
const agentLimiter: RateLimiter = createRateLimiter({
  name: 'agent',
  windowMs: config.security.rateLimitWindowMs,
  maxRequests: config.security.agentRateLimitMaxRequests,
});

/** Writes that move money or state get their own, stricter budget. */
const sensitiveLimiter: RateLimiter = createRateLimiter({
  name: 'sensitive',
  windowMs: config.security.rateLimitWindowMs,
  maxRequests: Math.max(3, Math.floor(config.security.rateLimitMaxRequests / 5)),
  penaltyThreshold: 2,
});

startRateLimitSweeper([standardLimiter, agentLimiter, sensitiveLimiter]);

export type RateClass = 'standard' | 'agent' | 'sensitive' | 'none';

function limiterFor(rateClass: RateClass): RateLimiter | null {
  switch (rateClass) {
    case 'standard':
      return standardLimiter;
    case 'agent':
      return agentLimiter;
    case 'sensitive':
      return sensitiveLimiter;
    case 'none':
      return null;
  }
}

export interface EnforceInput {
  principal: Principal;
  /** Machine-readable action name, e.g. 'order.create' or 'tool.verify_payment'. */
  action: string;
  requiredScope: Scope;
  rateClass?: RateClass;
  /** Id of the thing being acted on. Used for ownership checks and audit. */
  target?: string;
  /**
   * Owner subject of the target, when the action is ownership-sensitive.
   * If set and the principal only holds a `:own` scope, it must match.
   */
  targetOwner?: string;
  meta?: Record<string, unknown>;
}

export interface EnforceResult {
  principal: Principal;
  auditSeq: number;
}

function deny(input: EnforceInput, code: string, message: string, status: number, retryAfterSeconds?: number): never {
  record(input, 'denied', `${code}: ${message}`);
  throw new PolicyError(code, message, status, retryAfterSeconds);
}

function record(input: EnforceInput, outcome: AuditOutcome, reason?: string): number {
  const entry = auditLog.append({
    actor: input.principal.subject,
    actorRole: input.principal.role,
    action: input.action,
    outcome,
    target: input.target,
    reason,
    meta: input.meta,
  });
  return entry.seq;
}

/**
 * Authorise an action. Throws `PolicyError` on refusal, returns the principal
 * plus the audit sequence number on success.
 */
export function enforce(input: EnforceInput): EnforceResult {
  const { principal, requiredScope, rateClass = 'standard' } = input;

  if (!principal?.subject || !principal.role) {
    deny(input, 'no_principal', 'Authentication is required.', 401);
  }

  // 1. Capability check.
  if (!hasScope(principal.scopes, requiredScope)) {
    deny(
      input,
      'missing_scope',
      `This action requires the "${requiredScope}" permission, which your session does not have.`,
      403,
    );
  }

  // 2. Ownership check. A principal holding only ':own' may not reach across.
  if (input.targetOwner) {
    const ownsIt = input.targetOwner === principal.subject;
    const canReadAny = hasScope(principal.scopes, 'order:read:any') || hasScope(principal.scopes, 'admin:all');
    if (!ownsIt && !canReadAny) {
      deny(input, 'not_owner', 'That order belongs to a different customer.', 403);
    }
  }

  // 3. Rate limit, keyed per identity and action class.
  const limiter = limiterFor(rateClass);
  if (limiter) {
    const decision = limiter.check(`${limiter.label}:${principal.subject}`);
    if (!decision.allowed) {
      deny(
        input,
        'rate_limited',
        `Too many requests. Please wait ${decision.retryAfterSeconds}s and try again.`,
        429,
        decision.retryAfterSeconds,
      );
    }
  }

  const auditSeq = record(input, 'allowed');
  return { principal, auditSeq };
}

/** Record a handler failure against an already-authorised action. */
export function recordFailure(input: EnforceInput, error: unknown): void {
  record(input, 'error', error instanceof Error ? error.message : String(error));
}

/** Reset limits for a principal — used by staff tooling and tests. */
export function clearRateLimits(subject: string): void {
  standardLimiter.reset(`standard:${subject}`);
  agentLimiter.reset(`agent:${subject}`);
  sensitiveLimiter.reset(`sensitive:${subject}`);
}
