import type { Menu, CateringInquiry } from '../types';
import { formatCents } from '../lib/money';

interface Props {
  menu: Menu;
  inquiry: CateringInquiry;
  whatsappHref: string;
  onDone: () => void;
}

export default function CateringConfirmation({
  menu,
  inquiry,
  whatsappHref,
  onDone,
}: Props) {
  const totalItems = inquiry.selectedItems.reduce((acc, item) => acc + item.quantity, 0);

  return (
    <section aria-labelledby="confirmation-heading" className="flex flex-col gap-6">
      <div className="surface flex flex-col gap-6 p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-saffron-500/20 text-2xl text-saffron-600 dark:text-saffron-400"
            aria-hidden="true"
          >
            ✓
          </div>
          <div>
            <p className="eyebrow">Inquiry Ready</p>
            <h2 id="confirmation-heading" className="mt-1 text-2xl font-bold sm:text-3xl">
              Your catering inquiry is ready on WhatsApp!
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-600 dark:text-cream-300">
              We've prepared your custom Hyderabadi menu details for <strong>{inquiry.name}</strong>. If WhatsApp did not open automatically in another tab, use the button below to send the inquiry directly to our kitchen team.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary inline-flex items-center gap-2"
          >
            <span>💬 Open WhatsApp Message</span>
          </a>
          <button type="button" onClick={onDone} className="btn-secondary">
            Return to Menu
          </button>
        </div>

        {/* Inquiry Recap */}
        <div className="rounded-xl border border-cream-300 p-5 dark:border-ink-700 bg-cream-50/50 dark:bg-ink-900/40">
          <h3 className="font-bold text-sm uppercase tracking-wider text-saffron-700 dark:text-saffron-300 mb-4">
            Inquiry Summary
          </h3>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 text-sm mb-5 pb-5 border-b border-cream-200 dark:border-ink-800">
            <div>
              <span className="block text-xs text-ink-500 dark:text-cream-400">Contact</span>
              <span className="font-semibold">{inquiry.name}</span>
              <span className="block text-xs text-ink-600 dark:text-cream-300">{inquiry.phone} · {inquiry.email}</span>
            </div>
            <div>
              <span className="block text-xs text-ink-500 dark:text-cream-400">Event Details</span>
              <span className="font-semibold">{inquiry.eventDate}</span>
              <span className="block text-xs text-ink-600 dark:text-cream-300">{inquiry.guestCount} guests</span>
            </div>
          </div>

          <p className="text-xs font-semibold uppercase tracking-wider text-ink-500 dark:text-cream-400 mb-2">
            Selected Dishes ({totalItems} items)
          </p>
          <ul className="flex flex-col gap-2 mb-4">
            {inquiry.selectedItems.map((sel) => {
              const item = menu.items.find((i) => i.id === sel.itemId);
              if (!item) return null;
              const lineTotal = item.prices.full * sel.quantity;
              const unitLabel = item.unit ? ` (${item.unit})` : ' (Full tray)';
              return (
                <li key={sel.itemId} className="flex justify-between text-sm">
                  <span>
                    <strong>{sel.quantity}×</strong> {item.name}
                    <span className="text-xs text-ink-500 dark:text-cream-400">{unitLabel}</span>
                  </span>
                  <span className="tabular font-semibold text-saffron-700 dark:text-saffron-300">
                    {formatCents(lineTotal, menu.currency)}
                  </span>
                </li>
              );
            })}
          </ul>

          {inquiry.estimatedTotalCents !== undefined && (
            <div className="flex justify-between items-baseline pt-3 border-t border-cream-200 dark:border-ink-800">
              <span className="font-semibold text-sm">Estimated Total</span>
              <span className="tabular font-display text-xl font-bold text-saffron-700 dark:text-saffron-300">
                {formatCents(inquiry.estimatedTotalCents, menu.currency)}
              </span>
            </div>
          )}

          {inquiry.specialRequests && (
            <div className="mt-4 pt-3 border-t border-cream-200 dark:border-ink-800 text-xs">
              <span className="font-semibold text-ink-700 dark:text-cream-300">Special Requests: </span>
              <span className="text-ink-600 dark:text-cream-400">{inquiry.specialRequests}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
