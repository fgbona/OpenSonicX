'use client';

import { useEffect, useState } from 'react';
import { useI18n } from './I18n';

type Theme = 'light' | 'dark';
export const THEME_KEY = 'pocket-master-editor.theme';

/**
 * Runs in <head> before the page paints, so a saved theme never flashes the other one.
 * Without a saved choice it sets nothing and the CSS follows the system.
 */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem('${THEME_KEY}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

const current = (): Theme => {
  const chosen = document.documentElement.dataset.theme;
  if (chosen === 'light' || chosen === 'dark') return chosen;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

/** Switches between light and dark; the choice is kept in this browser. */
export function ThemeToggle() {
  const { t } = useI18n();
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => setTheme(current()), []);

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // not remembered across visits; the theme still applies now
    }
  };

  const label = t(theme === 'dark' ? 'theme.toLight' : 'theme.toDark');
  return (
    <button type="button" className="theme-toggle" onClick={toggle} aria-label={label} title={label}>
      {theme === 'dark' ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  );
}
