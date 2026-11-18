'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { detectLang, progressText, translate, translateError, type Lang, type MessageKey, type Vars } from '@/lib/i18n';

const STORAGE_KEY = 'pocket-master-editor.lang';

interface I18n {
  readonly lang: Lang;
  readonly setLang: (lang: Lang) => void;
  readonly t: (key: MessageKey, vars?: Vars) => string;
  /** Translates an error string from the web layer; protocol errors pass through. */
  readonly te: (text: string) => string;
  /** Translates a progress step reported by core. */
  readonly tp: (step: string) => string;
}

const I18nContext = createContext<I18n | null>(null);

const readStored = (): Lang | null => {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'pt' || value === 'en' ? value : null;
  } catch {
    return null; // storage blocked: fall back to the browser language
  }
};

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // The static page renders in English; the visitor's language applies right after hydration.
  const [lang, setLangState] = useState<Lang>('en');

  useEffect(() => {
    setLangState(readStored() ?? detectLang(navigator.languages ?? [navigator.language]));
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang === 'pt' ? 'pt-BR' : 'en';
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // not remembered across visits; the choice still applies now
    }
  }, []);

  const value = useMemo<I18n>(
    () => ({
      lang,
      setLang,
      t: (key, vars) => translate(lang, key, vars),
      te: (text) => translateError(lang, text),
      tp: (step) => progressText(lang, step),
    }),
    [lang, setLang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}

export function LanguageSwitch() {
  const { lang, setLang, t } = useI18n();
  return (
    <div className="lang-switch" role="group" aria-label={t('lang.label')}>
      {(['pt', 'en'] as const).map((code) => (
        <button key={code} type="button" aria-pressed={lang === code} className={lang === code ? 'lang-on' : ''} onClick={() => setLang(code)}>
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
