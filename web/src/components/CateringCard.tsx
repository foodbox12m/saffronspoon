import type { MenuItem } from '../types';
import { formatCents } from '../lib/money';

interface Props {
  item: MenuItem;
  currency: string;
  isSelected: boolean;
  quantity: number;
  onSelect: (itemId: string, quantity: number) => void;
}

export default function CateringCard({
  item,
  currency,
  isSelected,
  quantity,
  onSelect,
}: Props) {
  const handleQuantityChange = (newQuantity: number) => {
    if (newQuantity > 0) {
      onSelect(item.id, newQuantity);
    } else {
      onSelect(item.id, 0);
    }
  };

  return (
    <li
      className={`surface flex flex-col gap-4 p-5 ${
        isSelected ? 'ring-2 ring-saffron-500 dark:ring-saffron-400' : ''
      }`}
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <h3 className="min-w-0 text-lg font-bold leading-snug">{item.name}</h3>
          {item.popular ? (
            <span className="shrink-0 rounded-full bg-saffron-500/15 px-2.5 py-1 text-[0.62rem] font-bold uppercase tracking-[0.12em] text-saffron-700 dark:text-saffron-300">
              Popular
            </span>
          ) : null}
        </div>
        <p className="text-sm leading-relaxed text-ink-600 dark:text-cream-300">
          {item.description}
        </p>
        <p className="text-xs text-ink-600 dark:text-cream-300">
          {item.spice ? `Heat ${item.spice}/5` : 'Mild'}
          {item.allergens && item.allergens.length > 0
            ? ` · Contains ${item.allergens.join(', ')}`
            : ' · No listed allergens'}
        </p>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="tabular font-display text-2xl font-bold text-saffron-700 dark:text-saffron-300">
          {formatCents(item.prices.full, currency)}
        </span>
        <span className="text-xs text-ink-600 dark:text-cream-300">
          Full tray
          {item.prices.half !== null && (
            <>
              <br />
              {formatCents(item.prices.half, currency)} half tray
            </>
          )}
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="shrink-0">
          <label className="field-label" htmlFor={`qty-${item.id}`}>
            Quantity
          </label>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="btn-secondary h-11 w-11 min-h-0 px-0 text-lg"
              onClick={() => handleQuantityChange(Math.max(0, quantity - 1))}
              aria-label={`Decrease quantity for ${item.name}`}
            >
              −
            </button>
            <input
              id={`qty-${item.id}`}
              type="number"
              inputMode="numeric"
              min="0"
              value={quantity}
              onChange={(event) =>
                handleQuantityChange(Math.max(0, Number(event.target.value) || 0))
              }
              className="field tabular h-11 w-14 px-0 py-0 text-center"
            />
            <button
              type="button"
              className="btn-secondary h-11 w-11 min-h-0 px-0 text-lg"
              onClick={() => handleQuantityChange(quantity + 1)}
              aria-label={`Increase quantity for ${item.name}`}
            >
              +
            </button>
          </div>
        </div>
        <button
          type="button"
          className={`btn-secondary flex-1 ${
            quantity > 0 ? 'ring-2 ring-saffron-500 dark:ring-saffron-400' : ''
          }`}
          onClick={() => onSelect(item.id, quantity === 0 ? 1 : quantity)}
        >
          {quantity > 0 ? `Selected: ${quantity}` : 'Select'}
        </button>
      </div>
    </li>
  );
}
