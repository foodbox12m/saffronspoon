import { useState } from 'react';
import { formatCents } from '../lib/money';
import { isFullTrayOnly, unitPriceCents } from '../lib/menu';
import type { MenuItem, TraySize, TrayServings } from '../types';

interface Props {
  item: MenuItem;
  currency: string;
  servings?: TrayServings;
  onAdd: (itemId: string, size: TraySize, quantity: number) => void;
}

export default function ItemCard({ item, currency, servings, onAdd }: Props) {
  const fullOnly = isFullTrayOnly(item);
  const [size, setSize] = useState<TraySize>('full');
  const [quantity, setQuantity] = useState(1);
  const activeSize: TraySize = fullOnly ? 'full' : size;
  const unit = unitPriceCents(item, activeSize);
  const serves = servings?.[activeSize];

  return (
    <li className="surface flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <h3 className="min-w-0 text-lg font-bold leading-snug">{item.name}</h3>
          {item.popular ? (
            <span className="shrink-0 rounded-full bg-saffron-500/15 px-2.5 py-1 text-[0.62rem] font-bold uppercase tracking-[0.12em] text-saffron-700 dark:text-saffron-300">
              Popular
            </span>
          ) : null}
        </div>
        <p className="text-sm leading-relaxed text-ink-600 dark:text-cream-300">{item.description}</p>
        <p className="text-xs text-ink-600 dark:text-cream-300">
          {item.spice ? `Heat ${item.spice}/5` : 'Mild'}
          {item.allergens && item.allergens.length > 0
            ? ` · Contains ${item.allergens.join(', ')}`
            : ' · No listed allergens'}
        </p>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="tabular font-display text-2xl font-bold text-saffron-700 dark:text-saffron-300">
          {formatCents(unit, currency)}
        </span>
        <span className="text-xs text-ink-600 dark:text-cream-300">
          {activeSize === 'full' ? 'Full tray' : 'Half tray'}
          {serves ? ` · serves ${serves.min}–${serves.max}` : ''}
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {fullOnly ? (
          <p className="text-xs font-semibold text-ink-600 dark:text-cream-300">
            Full tray only — half tray unavailable
          </p>
        ) : (
          <fieldset>
            <legend className="field-label">Tray size</legend>
            <div className="inline-flex rounded-xl border border-cream-300 p-1 dark:border-ink-600">
              {(['full', 'half'] as TraySize[]).map((option) => {
                const selected = activeSize === option;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setSize(option)}
                    aria-pressed={selected}
                    className={`min-h-[38px] rounded-lg px-3.5 text-xs font-semibold transition-colors ${
                      selected
                        ? 'bg-saffron-500 text-ink-950'
                        : 'text-ink-700 hover:text-saffron-700 dark:text-cream-200 dark:hover:text-saffron-300'
                    }`}
                  >
                    {option === 'full' ? 'Full' : 'Half'}
                    <span className="tabular ml-1.5 font-normal">
                      {formatCents(unitPriceCents(item, option), currency)}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <div className="shrink-0">
            <label className="field-label" htmlFor={`qty-${item.id}`}>
              Trays
            </label>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="btn-secondary h-11 w-11 min-h-0 px-0 text-lg"
                onClick={() => setQuantity((value) => Math.max(1, value - 1))}
                aria-label={`Decrease tray count for ${item.name}`}
              >
                −
              </button>
              <input
                id={`qty-${item.id}`}
                type="number"
                inputMode="numeric"
                min={1}
                max={40}
                value={quantity}
                onChange={(event) =>
                  setQuantity(Math.min(40, Math.max(1, Number(event.target.value) || 1)))
                }
                className="field tabular h-11 w-14 px-0 py-0 text-center"
              />
              <button
                type="button"
                className="btn-secondary h-11 w-11 min-h-0 px-0 text-lg"
                onClick={() => setQuantity((value) => Math.min(40, value + 1))}
                aria-label={`Increase tray count for ${item.name}`}
              >
                +
              </button>
            </div>
          </div>
          <button
            type="button"
            className="btn-primary min-w-[9.5rem] flex-1"
            onClick={() => {
              onAdd(item.id, activeSize, quantity);
              setQuantity(1);
            }}
          >
            Add {formatCents(unit * quantity, currency)}
          </button>
        </div>
      </div>
    </li>
  );
}
