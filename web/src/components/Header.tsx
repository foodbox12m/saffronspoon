import type { Theme } from '../hooks/useTheme';

interface Props {
  theme: Theme;
  onToggleTheme: () => void;
  cartCount: number;
  onOpenCart: () => void;
}

export default function Header({ theme, onToggleTheme, cartCount, onOpenCart }: Props) {
  return (
    <header className="sticky top-0 z-30 border-b border-cream-200/80 bg-cream-50/90 backdrop-blur dark:border-ink-700/80 dark:bg-ink-950/85">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <a href="/saffronspoon/" className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden="true"
            className="grid h-9 w-9 shrink-0 place-content-center rounded-full bg-saffron-500 font-display text-[0.72rem] leading-none text-ink-950"
          >
            S&amp;S
          </span>
          <span className="min-w-0">
            <span className="text-[0.66rem] uppercase tracking-[0.16em] text-ink-500 dark:text-cream-400">
              Homemade Hyderabadi Food Catering
            </span>
            <span className="block font-display text-[0.92rem] font-bold leading-tight sm:text-lg">
              saffron <i className="not-italic text-saffron-600 dark:text-saffron-400">&amp;</i> spoon
            </span>
            <span className="hidden text-[0.66rem] uppercase tracking-[0.16em] text-ink-600 dark:text-cream-300 sm:block">
              Tray ordering
            </span>
          </span>
        </a>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onToggleTheme}
            className="btn-secondary min-h-[40px] px-3 text-xs"
            aria-pressed={theme === 'light'}
          >
            <span>
              {theme === 'dark' ? 'Light' : 'Dark'}
              <span className="hidden sm:inline"> mode</span>
            </span>
          </button>
          <button
            type="button"
            onClick={onOpenCart}
            className="btn-primary min-h-[40px] px-3.5 text-xs sm:text-sm"
          >
            Cart
            <span className="tabular grid h-5 min-w-[1.25rem] place-content-center rounded-full bg-ink-950/15 px-1 text-[0.7rem] font-bold">
              {cartCount}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}
