import QuoteSummary from './QuoteSummary';
import Notice from './Notice';
import { formatCents } from '../lib/money';
import { findItem } from '../lib/menu';
import type { CartLine, EventDetails, Menu, Quote } from '../types';

interface Props {
  menu: Menu;
  cart: CartLine[];
  quote: Quote;
  quoteAuthoritative: boolean;
  details: EventDetails;
  submitting: boolean;
  notice?: string;
  whatsappHref: string;
  onBack: () => void;
  onConfirm: () => void;
}

export default function ReviewStep({
  menu,
  cart,
  quote,
  quoteAuthoritative,
  details,
  submitting,
  notice,
  whatsappHref,
  onBack,
  onConfirm,
}: Props) {
  return (
    <section aria-labelledby="review-heading" className="flex flex-col gap-6">
      <div>
        <p className="eyebrow">Step 3 of 4</p>
        <h2 id="review-heading" className="mt-2 text-3xl font-bold leading-[1.15]">
          Review your order
        </h2>
      </div>

      {notice ? <Notice tone="warn">{notice}</Notice> : null}

      <div className="surface flex flex-col gap-5 p-5 sm:p-6">
        <ul className="flex flex-col gap-3">
          {cart.map((line) => {
            const item = findItem(menu, line.itemId);
            const quoteLine = quote.lines.find(
              (candidate) => candidate.itemId === line.itemId && candidate.size === line.size,
            );
            return (
              <li
                key={`${line.itemId}-${line.size}`}
                className="flex items-baseline justify-between gap-4 text-sm"
              >
                <span className="min-w-0">
                  <span className="font-semibold">{item?.name ?? line.itemId}</span>
                  <span className="block text-xs text-ink-600 dark:text-cream-300">
                    {line.quantity} × {line.size === 'full' ? 'full tray' : 'half tray'} at{' '}
                    <span className="tabular">
                      {formatCents(quoteLine?.unitPriceCents ?? 0, menu.currency)}
                    </span>
                  </span>
                </span>
                <span className="tabular shrink-0 font-semibold">
                  {formatCents(quoteLine?.lineTotalCents ?? 0, menu.currency)}
                </span>
              </li>
            );
          })}
        </ul>

        <QuoteSummary quote={quote} currency={menu.currency} authoritative={quoteAuthoritative} />
      </div>

      <div className="surface flex flex-col gap-3 p-5 sm:p-6">
        <h3 className="text-lg font-bold">Delivery &amp; contact</h3>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          {[
            ['Name', details.name],
            ['Phone', details.phone],
            ['Event date', details.date],
            ['Guests', details.guestCount],
            ['Address', details.address],
            ['Notes', details.notes || '—'],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs uppercase tracking-[0.14em] text-ink-600 dark:text-cream-300">
                {label}
              </dt>
              <dd className="mt-0.5 break-words font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="flex flex-col-reverse gap-3 sm:flex-row">
        <button type="button" className="btn-secondary sm:w-auto" onClick={onBack}>
          Edit details
        </button>
        <button type="button" className="btn-primary flex-1" onClick={onConfirm} disabled={submitting}>
          {submitting ? 'Placing order…' : 'Place order & pay with Zelle'}
        </button>
      </div>

      <p className="text-xs leading-relaxed text-ink-600 dark:text-cream-300">
        Prefer to talk it through?{' '}
        <a
          className="font-semibold text-saffron-700 underline decoration-dotted dark:text-saffron-300"
          href={whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
        >
          Send this order on WhatsApp
        </a>{' '}
        and we will reply to confirm.
      </p>
    </section>
  );
}
