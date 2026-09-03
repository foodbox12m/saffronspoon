import { useMemo, useState } from 'react';
import type { Menu, CateringSelection } from '../types';
import CateringCard from './CateringCard';

interface Props {
  menu: Menu;
  selections: Record<string, number>;
  onSelectionChange: (itemId: string, quantity: number) => void;
}

export default function CateringMenu({
  menu,
  selections,
  onSelectionChange,
}: Props) {
  const [activeCategory, setActiveCategory] = useState<string>(
    menu.categories[0]?.id || ''
  );

  const itemsByCategory = useMemo(() => {
    const grouped: Record<string, typeof menu.items> = {};
    menu.categories.forEach((cat) => {
      grouped[cat.id] = menu.items.filter((item) => item.category === cat.id);
    });
    return grouped;
  }, [menu]);

  const currentItems = itemsByCategory[activeCategory] || [];

  return (
    <div className="flex flex-col gap-8">
      {/* Category Tabs */}
      <div className="border-b border-cream-200 dark:border-ink-700">
        <div className="flex gap-2 overflow-x-auto pb-0">
          {menu.categories.map((category) => {
            const itemCount = itemsByCategory[category.id]?.length || 0;
            if (itemCount === 0) return null;

            return (
              <button
                key={category.id}
                onClick={() => setActiveCategory(category.id)}
                className={`px-4 py-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors duration-200 ${
                  activeCategory === category.id
                    ? 'border-saffron-500 text-saffron-600 dark:border-saffron-400 dark:text-saffron-400'
                    : 'border-transparent text-ink-600 hover:text-ink-900 dark:text-cream-400 dark:hover:text-cream-200'
                }`}
              >
                {category.name}
                <span className="ml-1.5 text-xs opacity-70">({itemCount})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Category Description */}
      {menu.categories.find((c) => c.id === activeCategory)?.blurb && (
        <p className="text-sm leading-relaxed text-ink-600 dark:text-cream-300">
          {menu.categories.find((c) => c.id === activeCategory)?.blurb}
        </p>
      )}

      {/* Menu Grid */}
      <ul className="grid gap-4 sm:grid-cols-2">
        {currentItems.map((item) => (
          <CateringCard
            key={item.id}
            item={item}
            currency={menu.currency}
            isSelected={Boolean(selections[item.id])}
            quantity={selections[item.id] || 0}
            onSelect={onSelectionChange}
          />
        ))}
      </ul>

      {currentItems.length === 0 && (
        <div className="rounded-lg border-2 border-dashed border-cream-300 p-8 text-center dark:border-ink-700">
          <p className="text-ink-600 dark:text-cream-400">
            No items in this category yet.
          </p>
        </div>
      )}
    </div>
  );
}
