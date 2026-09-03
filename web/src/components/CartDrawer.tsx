import { useRef } from 'react';
import QuoteSummary from './QuoteSummary';
import { formatCents } from '../lib/money';
import { estimatedGuests, findItem } from '../lib/menu';
import { useFocusTrap } from '../hooks/useFocusTrap';
import type { CartApi } from '../hooks/useCart';
import type { Menu, Quote } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  menu: Menu;
  cart: CartApi;
  quote: Quote;
  quoteAuthoritative: boolean;
  onCheckout: () => void;
}

export default function CartDrawer({
  open,
  onClose,
  menu,
  cart,
  quote,
  quoteAuthoritative,
  onCheckout,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open, onClose);
  const guests = estimatedGuests(menu, cart.cart);

  return (
    <>
      <div
        aria-hidden="true"
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-ink-950/60 transition-opacity duration-300 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Your order"
        aria-hidden={!open}
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-[26rem] flex-col border-l border-cream-200 bg-cream-50 shadow-lift transition-transform duration-300 dark:border-ink-700 dark:bg-ink-900 ${
          open ? 'visible translate-x-0' : 'invisible pointer-events-none translate-x-full'
        }`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-cream-200 px-5 py-4 dark:border-ink-700">
          <div>
            <p className="eyebrow">Your order</p>
            <h2 className="text-2xl font-bold leading-tight">
              {cart.count} {cart.count === 1 ? 'tray' : 'trays'}
            </h2>
            {guests > 0 ? (
              <p className="mt-1 text-xs text-ink-600 dark:text-cream-300">
                Feeds roughly {guests}+ guests
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary h-10 w-10 min-h-0 px-0 text-xl"
            aria-label="Close order drawer"
          >
            &times;
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {cart.cart.length === 0 ? (
            <p className="text-sm text-ink-600 dark:text-cream-300">
              Your order is empty. Add a tray from the menu to get started.
            </p>
          ) : (
            <ul className="flex flex-col gap-4">
              {cart.cart.map((line) => {
                const item = findItem(menu, line.itemId);
                const quoteLine = quote.lines.find(
                  (candidate) => candidate.itemId === line.itemId && candidate.size === line.size,
                );
                return (
                  <li
                    key={`${line.itemId}-${line.size}`}
                    className="flex flex-col gap-2 border-b border-cream-200 pb-4 dark:border-ink-700"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold leading-snug">{item?.name ?? line.itemId}</p>
                        <p className="text-xs text-ink-600 dark:text-cream-300">
                          {line.size === 'full' ? 'Full tray' : 'Half tray'} ·{' '}
                          <span className="tabular">
                            {formatCents(quoteLine?.unitPriceCents ?? 0, menu.currency)}
                          </span>{' '}
                          each
                        </p>
                      </div>
                      <span className="tabular shrink-0 font-semibold">
                        {formatCents(quoteLine?.lineTotalCents ?? 0, menu.currency)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="btn-secondary h-9 w-9 min-h-0 px-0"
                        onClick={() => cart.setQuantity(line.itemId, line.size, line.quantity - 1)}
                        aria-label={`Remove one ${item?.name ?? line.itemId}`}
                      >
                        &minus;
                      </button>
                      <span className="tabular w-7 text-center text-sm font-semibold">
                        {line.quantity}
                      </span>
                      <button
                        type="button"
                        className="btn-secondary h-9 w-9 min-h-0 px-0"
                        onClick={() => cart.setQuantity(line.itemId, line.size, line.quantity + 1)}
                        aria-label={`Add one ${item?.name ?? line.itemId}`}
                      >
                        +
                      </button>
                      <button
                        type="button"
                        className="ml-auto text-xs font-semibold text-ink-600 underline decoration-dotted hover:text-saffron-700 dark:text-cream-300 dark:hover:text-saffron-300"
                        onClick={() => cart.remove(line.itemId, line.size)}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-cream-200 px-5 py-4 dark:border-ink-700">
          <QuoteSummary
            quote={quote}
            currency={menu.currency}
            authoritative={quoteAuthoritative && cart.cart.length > 0}
          />
          <button
            type="button"
            className="btn-primary mt-4 w-full"
            disabled={cart.cart.length === 0}
            onClick={onCheckout}
          >
            Continue to event details
          </button>
        </div>
      </div>
    </>
  );
}
