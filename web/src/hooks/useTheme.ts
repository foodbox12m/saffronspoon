import { useCallback, useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';
const STORAGE_KEY = 'saffronspoon:theme';

function initialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* localStorage unavailable (private mode) — fall through to default */
  }
  return 'dark';
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.style.colorScheme = theme;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore persistence failures */
    }
  }, [theme]);

  const toggle = useCallback(() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark')), []);
  return { theme, toggle };
}
