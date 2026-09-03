/**
 * Capability scopes.
 *
 * Every tool and every route declares the scope it needs. A principal without
 * that scope is refused at the policy gate before any handler runs. The agent
 * acting for a customer holds only read + own-order scopes; nothing it can be
 * talked into doing can verify a payment or read another customer's order.
 */

export const SCOPES = [
  'menu:read',
  'kb:read',
  'order:quote',
  'order:create',
  'order:read:own',
  'order:read:any',
  'payment:claim',
  'payment:read:any',
  'payment:verify',
  'order:cancel',
  'kb:write',
  'admin:all',
] as const;

export type Scope = (typeof SCOPES)[number];

const SCOPE_SET = new Set<string>(SCOPES);

export function isScope(value: string): value is Scope {
  return SCOPE_SET.has(value);
}

export type Role = 'customer' | 'agent' | 'staff' | 'admin' | 'service';

/**
 * Role → scope mapping. Deliberately narrow: `agent` is the identity the LLM
 * runs under, and it cannot verify payments or read arbitrary orders.
 */
export const ROLE_SCOPES: Record<Role, readonly Scope[]> = {
  customer: ['menu:read', 'kb:read', 'order:quote', 'order:create', 'order:read:own', 'payment:claim'],
  agent: ['menu:read', 'kb:read', 'order:quote', 'order:create', 'order:read:own', 'payment:claim'],
  staff: [
    'menu:read',
    'kb:read',
    'order:quote',
    'order:read:any',
    'payment:read:any',
    'payment:verify',
    'order:cancel',
  ],
  admin: [...SCOPES],
  service: ['menu:read', 'kb:read', 'kb:write'],
};

export function scopesForRole(role: Role): Scope[] {
  return [...(ROLE_SCOPES[role] ?? [])];
}

/** `admin:all` satisfies every scope check. */
export function hasScope(granted: readonly string[], required: Scope): boolean {
  return granted.includes('admin:all') || granted.includes(required);
}

export function assertKnownScopes(scopes: readonly string[]): Scope[] {
  const unknown = scopes.filter((scope) => !isScope(scope));
  if (unknown.length > 0) {
    throw new Error(`Unknown scope(s): ${unknown.join(', ')}`);
  }
  return scopes as Scope[];
}
