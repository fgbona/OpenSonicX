'use client';

import { useSyncExternalStore } from 'react';

/** True for the desktop app (apps/desktop), whose Chromium adds an Electron token to the user agent. */
export const isDesktopAgent = (userAgent: string) => /\bElectron\//.test(userAgent);

const never = () => () => undefined;

/** Whether the editor runs inside the desktop app; false while prerendering, so hydration matches. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    never,
    () => isDesktopAgent(navigator.userAgent),
    () => false,
  );
}
