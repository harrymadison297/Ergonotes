import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
const KEY = 'ergo-site-theme';
const system = (): Theme => (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
const saved = (): Theme | null => { try { const t = localStorage.getItem(KEY); return t === 'light' || t === 'dark' ? t : null; } catch { return null; } };

/** The theme in use (the saved choice, else the system's) and a way to flip it. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => saved() ?? system());
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => { if (!saved()) setTheme(system()); };
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const flip = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(KEY, next); } catch { /* private window */ }
  }, [theme]);
  return [theme, flip];
}
