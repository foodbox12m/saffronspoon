import { formatCents } from '../lib/money';
import type { Quote } from '../types';

interface Props {
  quote: Quote;
  currency: string;
  authoritative: boolean;
}

export default function QuoteSummary({ quote, currency, authoritative }: Props) {
  const rows: Array<[string, number]> = [
    ['Subtotal', quote.subtotalCents],
    ['Tax', quote.taxCents],
    ['Delivery', quote.deliveryCents],
  ];
  return (
    <div className="flex flex-col gap-2 border-t border-cream-200 pt-4 text-sm dark:border-ink-700">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-4">
          <span className="text-ink-600 dark:text-cream-300">{label}</span>
          <span className="tabular">{formatCents(value, currency)}</span>
        </div>
      ))}
      <div className="flex items-baseline justify-between gap-4 border-t border-cream-200 pt-3 dark:border-ink-700">
        <span className="font-semibold">Total</span>
        <strong
          aria-live="polite"
          className="tabular font-display text-2xl font-bold text-saffron-700 dark:text-saffron-300"
        >
          {formatCents(quote.totalCents, currency)}
        </strong>
      </div>
      <p className="text-xs text-ink-600 dark:text-cream-300">
        {authoritative
          ? 'Confirmed by our kitchen — this is the amount to pay.'
          : 'Estimate. Final tax and delivery are confirmed before payment.'}
      </p>
    </div>
  );
}
