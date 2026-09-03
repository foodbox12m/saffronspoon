/** Security layer barrel. Import from here rather than reaching into files. */

export { auditLog, AuditLog, type AuditEntry, type AuditOutcome, type AuditSink } from './audit.js';
export {
  AuthError,
  bearerFromHeader,
  issueGuestToken,
  issueStaffToken,
  issueToken,
  principalFromToken,
  verifyToken,
  type Principal,
  type TokenPayload,
} from './auth.js';
export {
  BLOCKED_REPLY,
  fenceUntrusted,
  screenInboundMessage,
  screenOutboundMessage,
  screenRetrievedContent,
  type ScreenResult,
  type Verdict,
} from './guardrails.js';
export { clearRateLimits, enforce, PolicyError, recordFailure, type EnforceInput, type RateClass } from './policy.js';
export { createRateLimiter, RateLimiter, startRateLimitSweeper, type RateLimitDecision } from './ratelimit.js';
export { hasScope, ROLE_SCOPES, SCOPES, scopesForRole, type Role, type Scope } from './scopes.js';
