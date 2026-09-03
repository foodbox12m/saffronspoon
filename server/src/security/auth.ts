/**
 * Token issuance and verification.
 *
 * Short-lived HS256 JWTs carry the principal's role, scopes and — for customers
 * and the agent — the subject they are allowed to act for. `order:read:own`
 * is enforced by comparing the order's owner against `principal.subject`.
 */

import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { assertKnownScopes, hasScope, scopesForRole, type Role, type Scope } from './scopes.js';

export interface Principal {
  /** Stable identity: WhatsApp number, web session id, or staff id. */
  subject: string;
  role: Role;
  scopes: Scope[];
  /** Conversation this token is bound to, when applicable. */
  conversationId?: string;
  displayName?: string;
}

export interface TokenPayload extends Principal {
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
}

export class AuthError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(code: string, message: string, status = 401) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = 'AuthError';
  }
}

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function issueToken(
  input: { subject: string; role: Role; conversationId?: string; displayName?: string; scopes?: Scope[] },
  ttlSeconds = config.security.accessTokenTtlSeconds,
): string {
  const scopes = input.scopes ? assertKnownScopes(input.scopes) : scopesForRole(input.role);

  // A token may never grant more than its role allows.
  const allowed = new Set<string>(scopesForRole(input.role));
  const escalations = scopes.filter((scope) => !allowed.has(scope));
  if (escalations.length > 0) {
    throw new AuthError('scope_escalation', `Role ${input.role} cannot be granted: ${escalations.join(', ')}`, 403);
  }

  const payload: Record<string, unknown> = {
    subject: input.subject,
    role: input.role,
    scopes,
    jti: randomId(),
  };
  if (input.conversationId) payload.conversationId = input.conversationId;
  if (input.displayName) payload.displayName = input.displayName;

  return jwt.sign(payload, config.security.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: ttlSeconds,
    issuer: config.security.jwtIssuer,
    audience: config.security.jwtAudience,
    subject: input.subject,
  });
}

export function verifyToken(token: string): TokenPayload {
  try {
    const decoded = jwt.verify(token, config.security.jwtSecret, {
      algorithms: ['HS256'], // pinned — never trust the token's own alg header
      issuer: config.security.jwtIssuer,
      audience: config.security.jwtAudience,
    });

    if (typeof decoded === 'string') {
      throw new AuthError('malformed_token', 'Token payload was not an object.');
    }

    const payload = decoded as unknown as TokenPayload;
    if (!payload.subject || !payload.role || !Array.isArray(payload.scopes)) {
      throw new AuthError('malformed_token', 'Token is missing subject, role or scopes.');
    }

    // Re-check scopes against the role at verification time, so a token minted
    // under an older, looser policy cannot outlive that policy.
    const allowed = new Set<string>(scopesForRole(payload.role));
    payload.scopes = payload.scopes.filter((scope) => allowed.has(scope));

    return payload;
  } catch (error) {
    if (error instanceof AuthError) throw error;
    if (error instanceof jwt.TokenExpiredError) {
      throw new AuthError('token_expired', 'Your session expired. Please start again.');
    }
    throw new AuthError('invalid_token', 'Token could not be verified.');
  }
}

export function principalFromToken(token: string): Principal {
  const payload = verifyToken(token);
  const principal: Principal = {
    subject: payload.subject,
    role: payload.role,
    scopes: payload.scopes,
  };
  if (payload.conversationId) principal.conversationId = payload.conversationId;
  if (payload.displayName) principal.displayName = payload.displayName;
  return principal;
}

export function bearerFromHeader(header: string | undefined): string {
  if (!header) throw new AuthError('missing_token', 'Authorization header is required.');
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match?.[1]) throw new AuthError('missing_token', 'Expected an "Authorization: Bearer <token>" header.');
  return match[1].trim();
}

/**
 * Anonymous web visitors get a customer token scoped to a fresh session id, so
 * they can browse, quote and place their own order but nothing else.
 */
export function issueGuestToken(sessionId?: string): { token: string; subject: string } {
  const subject = sessionId?.trim() || `web:${randomId()}`;
  return { token: issueToken({ subject, role: 'customer' }), subject };
}

/** Staff exchange the shared access code for a staff token. */
export function issueStaffToken(accessCode: string, staffId: string): string {
  const expected = config.security.staffAccessCode;
  if (!expected || !timingSafeEqual(accessCode, expected)) {
    throw new AuthError('bad_access_code', 'That staff access code is not valid.', 403);
  }
  if (!staffId.trim()) {
    throw new AuthError('missing_staff_id', 'A staff id is required so actions are attributable.', 400);
  }
  return issueToken({ subject: `staff:${staffId.trim()}`, role: 'staff', displayName: staffId.trim() });
}

/** Constant-time-ish string comparison to avoid leaking the code via timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

export { hasScope };
