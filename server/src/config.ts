/**
 * Environment configuration.
 *
 * Design rule: this module fails fast in production. If a secret that is
 * required to operate safely is missing while NODE_ENV=production, the process
 * refuses to boot rather than silently running in a degraded, insecure mode.
 * In development the same values fall back to clearly-labelled dev defaults.
 */

export type Mode = 'development' | 'production' | 'test';

const MODE = (process.env.NODE_ENV as Mode) || 'development';
const IS_PROD = MODE === 'production';

const missing: string[] = [];
const warnings: string[] = [];

function required(name: string, devFallback: string): string {
  const value = process.env[name];
  if (value && value.trim().length > 0) return value.trim();
  if (IS_PROD) {
    missing.push(name);
    return '';
  }
  warnings.push(`${name} is unset — using development fallback.`);
  return devFallback;
}

function optional(name: string, fallback = ''): string {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    warnings.push(`${name} is not an integer — using ${fallback}.`);
    return fallback;
  }
  return parsed;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = optional(name).toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function list(name: string): string[] {
  return optional(name)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Secret used to sign and verify agent/staff JWTs. Must be strong in prod. */
const JWT_SECRET = required('JWT_SECRET', 'dev-only-insecure-jwt-secret-change-me');

if (IS_PROD && JWT_SECRET.length > 0 && JWT_SECRET.length < 32) {
  missing.push('JWT_SECRET (must be at least 32 characters in production)');
}

export const config = {
  mode: MODE,
  isProd: IS_PROD,
  port: int('PORT', 8080),
  publicBaseUrl: optional('PUBLIC_BASE_URL', `http://localhost:${int('PORT', 8080)}`),
  /** Where the hosted ordering web app lives — sent to customers over WhatsApp. */
  webAppUrl: optional('WEB_APP_URL', 'https://foodbox12m.github.io/saffronspoon/app/'),

  security: {
    jwtSecret: JWT_SECRET,
    jwtIssuer: optional('JWT_ISSUER', 'saffronspoon'),
    jwtAudience: optional('JWT_AUDIENCE', 'saffronspoon-agent'),
    /** Access token lifetime in seconds. Short by design. */
    accessTokenTtlSeconds: int('ACCESS_TOKEN_TTL_SECONDS', 900),
    /** Comma-separated origins allowed to call the REST API. */
    allowedOrigins: list('ALLOWED_ORIGINS').length
      ? list('ALLOWED_ORIGINS')
      : ['https://foodbox12m.github.io', 'http://localhost:5173'],
    /** Requests per window, per identity, for customer-facing routes. */
    rateLimitWindowMs: int('RATE_LIMIT_WINDOW_MS', 60_000),
    rateLimitMaxRequests: int('RATE_LIMIT_MAX_REQUESTS', 30),
    /** Tighter budget for the expensive agent loop. */
    agentRateLimitMaxRequests: int('AGENT_RATE_LIMIT_MAX_REQUESTS', 12),
    /** Max tool calls the agent may make while serving one customer message. */
    maxToolCallsPerTurn: int('MAX_TOOL_CALLS_PER_TURN', 8),
    /** Shared secret staff present to mint a staff token. */
    staffAccessCode: required('STAFF_ACCESS_CODE', 'dev-staff-code'),
  },

  supabase: {
    url: optional('SUPABASE_URL'),
    serviceRoleKey: optional('SUPABASE_SERVICE_ROLE_KEY'),
    proofBucket: optional('SUPABASE_PROOF_BUCKET', 'payment-proofs'),
    get enabled(): boolean {
      return Boolean(optional('SUPABASE_URL') && optional('SUPABASE_SERVICE_ROLE_KEY'));
    },
  },

  payments: {
    /** Zelle email or phone the customer sends money to. */
    zelleId: required('ZELLE_ID', 'orders@saffronspoon.example'),
    zelleRecipientName: optional('ZELLE_RECIPIENT_NAME', 'saffron & spoon'),
    /** Sales tax in basis points. 9.375% Santa Clara County = 938 bps. */
    taxBasisPoints: int('TAX_BASIS_POINTS', 938),
    /** Flat delivery fee in cents. 0 disables it. */
    deliveryFeeCents: int('DELIVERY_FEE_CENTS', 0),
    /** Orders at or above this subtotal get free delivery. */
    freeDeliveryThresholdCents: int('FREE_DELIVERY_THRESHOLD_CENTS', 50_000),
    /** Deposit percentage required to lock an event date. 100 = pay in full. */
    depositPercent: int('DEPOSIT_PERCENT', 50),
  },

  whatsapp: {
    /** 'twilio' | 'baileys' | 'none' */
    provider: optional('WHATSAPP_PROVIDER', 'none').toLowerCase(),
    businessNumber: optional('WHATSAPP_BUSINESS_NUMBER', '14085551234'),
    twilio: {
      accountSid: optional('TWILIO_ACCOUNT_SID'),
      authToken: optional('TWILIO_AUTH_TOKEN'),
      /** Twilio sandbox/sender in E.164, e.g. whatsapp:+14155238886 */
      from: optional('TWILIO_WHATSAPP_FROM'),
      /** Verify inbound webhook signatures. Keep true in production. */
      validateSignature: bool('TWILIO_VALIDATE_SIGNATURE', true),
    },
    baileys: {
      authDir: optional('BAILEYS_AUTH_DIR', './.baileys-auth'),
    },
  },

  agent: {
    /** OpenAI-compatible endpoint for the reasoning model. */
    apiBaseUrl: optional('AGENT_API_BASE_URL', 'https://api.openai.com/v1'),
    apiKey: optional('AGENT_API_KEY'),
    model: optional('AGENT_MODEL', 'gpt-4o-mini'),
    temperature: Number.parseFloat(optional('AGENT_TEMPERATURE', '0.2')),
    maxOutputTokens: int('AGENT_MAX_OUTPUT_TOKENS', 700),
    get enabled(): boolean {
      return Boolean(optional('AGENT_API_KEY'));
    },
  },

  ops: {
    /** WhatsApp numbers / emails notified when a customer claims payment. */
    adminNotifyNumbers: list('ADMIN_NOTIFY_NUMBERS'),
    logLevel: optional('LOG_LEVEL', IS_PROD ? 'info' : 'debug'),
  },
} as const;

/**
 * Validate configuration. Throws in production when required secrets are
 * absent so a misconfigured deploy dies at boot instead of at first order.
 */
export function assertConfigValid(): void {
  if (missing.length > 0) {
    throw new Error(
      `Refusing to start: missing required production environment variables:\n` +
        missing.map((name) => `  - ${name}`).join('\n') +
        `\n\nSee server/.env.example for the full list.`,
    );
  }
  if (warnings.length > 0 && !IS_PROD) {
    for (const warning of warnings) {
      // eslint-disable-next-line no-console
      console.warn(`[config] ${warning}`);
    }
  }
  if (config.payments.depositPercent < 1 || config.payments.depositPercent > 100) {
    throw new Error('DEPOSIT_PERCENT must be between 1 and 100.');
  }
  if (config.payments.taxBasisPoints < 0 || config.payments.taxBasisPoints > 2000) {
    throw new Error('TAX_BASIS_POINTS must be between 0 and 2000.');
  }
}

/** Redacted view of config, safe to log at boot. */
export function configSummary(): Record<string, unknown> {
  return {
    mode: config.mode,
    port: config.port,
    supabase: config.supabase.enabled ? 'enabled' : 'in-memory fallback',
    whatsapp: config.whatsapp.provider,
    agent: config.agent.enabled ? config.agent.model : 'disabled (deterministic replies only)',
    tax: `${(config.payments.taxBasisPoints / 100).toFixed(3)}%`,
    deposit: `${config.payments.depositPercent}%`,
    zelleId: config.payments.zelleId.replace(/(.{2}).*(@.*)/, '$1***$2'),
  };
}
