interface Props {
  children: React.ReactNode;
  tone?: 'info' | 'warn';
}

export default function Notice({ children, tone = 'info' }: Props) {
  const toneClass =
    tone === 'warn'
      ? 'border-saffron-600/45 bg-saffron-500/10 text-ink-800 dark:text-cream-100'
      : 'border-cream-300 bg-cream-100 text-ink-800 dark:border-ink-600 dark:bg-ink-800 dark:text-cream-100';
  return (
    <p className={`rounded-xl border px-4 py-3 text-sm leading-relaxed ${toneClass}`} role="status">
      {children}
    </p>
  );
}
