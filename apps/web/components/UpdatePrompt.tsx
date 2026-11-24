'use client';

import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/components/I18n';
import { SKIP_WAITING } from '@/lib/precache';
import { shouldRegister } from '@/lib/serviceWorker';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * Registers the offline service worker (lib/sw.ts) and, when a new release has installed beside
 * the running one, offers to reload into it. Nothing reloads unless the person clicks: an edit in
 * progress stays. Unclicked, the new release starts on the next launch.
 */
export function UpdatePrompt() {
  const { t } = useI18n();
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  // Only an update the person asked for reloads the page (the first install takes over silently).
  const asked = useRef(false);

  useEffect(() => {
    if (!shouldRegister({ production: process.env.NODE_ENV === 'production', supported: 'serviceWorker' in navigator, userAgent: navigator.userAgent, protocol: location.protocol })) return;
    const container = navigator.serviceWorker;
    const onControllerChange = () => {
      if (asked.current) location.reload();
    };
    container.addEventListener('controllerchange', onControllerChange);
    let registration: ServiceWorkerRegistration | undefined;
    const check = () => {
      if (document.visibilityState === 'visible') registration?.update().catch(() => undefined);
    };
    container
      .register(`${BASE}/sw.js`, { scope: `${BASE}/` })
      .then((reg) => {
        registration = reg;
        if (reg.waiting && container.controller) setWaiting(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const next = reg.installing;
          next?.addEventListener('statechange', () => {
            if (next.state === 'installed' && container.controller) setWaiting(next);
          });
        });
      })
      .catch((error: unknown) => console.warn('Offline mode unavailable:', error));
    // An editor left open for days (a tablet on the pedalboard) still hears of new releases.
    document.addEventListener('visibilitychange', check);
    return () => {
      container.removeEventListener('controllerchange', onControllerChange);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);

  if (!waiting) return null;
  const reload = () => {
    asked.current = true;
    waiting.postMessage(SKIP_WAITING);
  };
  return (
    <div className="update-prompt" role="status">
      <span>{t('update.available')}</span>
      <button type="button" className="btn btn-primary btn-small" onClick={reload}>
        {t('update.reload')}
      </button>
    </div>
  );
}
