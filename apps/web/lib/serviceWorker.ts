import { isDesktopAgent } from './desktop.ts';

export interface Environment {
  /** A production build: `next dev` has no sw.js, it is written by `npm run build` of the static export. */
  readonly production: boolean;
  /** 'serviceWorker' in navigator. */
  readonly supported: boolean;
  readonly userAgent: string;
  readonly protocol: string;
}

/**
 * Whether the page registers the offline service worker (scripts/build-sw.ts). Never in the
 * desktop app: it already ships the files, and its app:// scheme allows no service worker.
 */
export const shouldRegister = ({ production, supported, userAgent, protocol }: Environment) => production && supported && !isDesktopAgent(userAgent) && (protocol === 'https:' || protocol === 'http:');
