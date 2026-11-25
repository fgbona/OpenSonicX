'use client';

import { useCallback, useEffect, useState } from 'react';
import { cachedTranslation, translateSupport, translateToPt } from './translate.ts';

/** What the panel shows: the English text, a translation, and why it is still English. */
export type TranslationState = 'off' | 'working' | 'translated' | 'download' | 'english';

/**
 * `text` in Portuguese when `enabled`, translated on this device. Shows the English text until the
 * translation is ready; `start` (call it from a click) begins the model download when one is needed.
 */
export function useTranslatedText(text: string, enabled: boolean) {
  const [result, setResult] = useState<{ text: string; state: TranslationState }>({ text, state: 'off' });
  const [clicks, setClicks] = useState(0);

  useEffect(() => {
    let live = true;
    const show = (state: TranslationState, shown = text) => {
      if (live) setResult({ text: shown, state });
    };
    const hit = enabled && text ? cachedTranslation(text) : null;
    if (!enabled || !text) show('off');
    else if (hit !== null) show('translated', hit);
    else {
      show('working');
      void translateSupport().then((support) => {
        if (support === 'none') return show('english');
        // A model to download waits for the click (Chrome needs a user gesture to create the translator).
        if (support === 'download' && clicks === 0) return show('download');
        translateToPt(text).then(
          (out) => show('translated', out),
          () => show('english'),
        );
      });
    }
    return () => {
      live = false;
    };
  }, [text, enabled, clicks]);

  const start = useCallback(() => setClicks((n) => n + 1), []);
  return { ...result, start };
}
