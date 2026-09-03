import { formatCents } from '../lib/money';

interface Props {
  count: number;
  totalCents: number;
  currency: string;
  onOpen: () => void;
}

export default function StickyCartBar({ count, totalCents, currency, onOpen }: Props) {
  if (count === 0) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-cream-200 bg-cream-50/95 px-4 py-3 backdrop-blur dark:border-ink-700 dark:bg-ink-950/95 lg:hidden">
      <button type="button" onClick={onOpen} className="btn-primary w-full justify-between px-4">
        <span>
          View order · {count} {count === 1 ? 'tray' : 'trays'}
        </span>
        <span className="tabular" aria-live="polite">
          {formatCents(totalCents, currency)}
        </span>
      </button>
    </div>
  );
}
