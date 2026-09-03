import { useMemo, useState } from 'react';
import ItemCard from './ItemCard';
import { itemsByCategory } from '../lib/menu';
import type { Menu, TraySize } from '../types';

interface Props {
  menu: Menu;
  onAdd: (itemId: string, size: TraySize, quantity: number) => void;
}

export default function MenuBrowser({ menu, onAdd }: Props) {
  const [active, setActive] = useState<string>('all');
  const categories = menu.categories;

  const visible = useMemo(
    () => (active === 'all' ? categories : categories.filter((c) => c.id === active)),
    [active, categories],
  );

  return (
    <section aria-labelledby="menu-heading" className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="eyebrow">The menu</p>
        <h2 id="menu-heading" className="text-3xl font-bold leading-[1.1] sm:text-4xl">
          Built to feed a crowd.
        </h2>
        <p className="max-w-xl text-sm leading-relaxed text-ink-600 dark:text-cream-300">
          Every dish is priced by the tray. Full trays serve{' '}
          {menu.trayServings?.full.min ?? 18}&ndash;{menu.trayServings?.full.max ?? 22} guests, half
          trays serve {menu.trayServings?.half.min ?? 9}&ndash;{menu.trayServings?.half.max ?? 11}.
        </p>
      </div>

      <nav aria-label="Menu categories" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex w-max gap-2 pb-1">
          {[{ id: 'all', name: 'Everything' }, ...categories].map((category) => {
            const selected = active === category.id;
            return (
              <li key={category.id}>
                <button
                  type="button"
                  onClick={() => setActive(category.id)}
                  aria-pressed={selected}
                  className={`min-h-[40px] whitespace-nowrap rounded-full border px-4 text-xs font-semibold transition-colors ${
                    selected
                      ? 'border-saffron-500 bg-saffron-500 text-ink-950'
                      : 'border-cream-300 text-ink-700 hover:border-saffron-600 hover:text-saffron-700 dark:border-ink-600 dark:text-cream-200 dark:hover:border-saffron-400 dark:hover:text-saffron-300'
                  }`}
                >
                  {category.name}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {visible.map((category) => (
        <div key={category.id} className="flex flex-col gap-4">
          <div className="border-t border-cream-200 pt-5 dark:border-ink-700">
            <h3 className="text-xl font-bold">{category.name}</h3>
            {category.blurb ? (
              <p className="mt-1 text-sm text-ink-600 dark:text-cream-300">{category.blurb}</p>
            ) : null}
          </div>
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {itemsByCategory(menu, category.id).map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                currency={menu.currency}
                servings={menu.trayServings}
                onAdd={onAdd}
              />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
