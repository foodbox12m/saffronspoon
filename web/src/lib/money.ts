/**
 * Money is ALWAYS integer cents inside this app. Floats are never used for
 * arithmetic; `formatCents` is the single display boundary.
 */
export function formatCents(cents: number, currency = 'USD'): string {
  const safe = Number.isFinite(cents) ? Math.round(cents) : 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: safe % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(safe / 100);
}

/** Sum of integer cents — stays in integer space. */
export function sumCents(values: number[]): number {
  return values.reduce((total, value) => total + Math.round(value), 0);
}
