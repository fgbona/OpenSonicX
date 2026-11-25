/** Search and link-preview metadata shared by the layout, robots.txt, sitemap.xml and the manifest. */

export const SITE_NAME = 'OpenSonicX';
export const SITE_TITLE = 'OpenSonicX: Sonicake Pocket Master & Matribox II Pro editor';
export const SITE_DESCRIPTION = 'Free, open-source editor for the Sonicake Pocket Master and Matribox II Pro, on web and desktop, over USB or Bluetooth, with an AI that builds your tone.';
export const SITE_KEYWORDS = [
  'Sonicake Pocket Master editor',
  'Pocket Master editor',
  'Matribox II Pro editor',
  'Valeton Matribox editor',
  'Sonicake editor',
  'guitar pedal editor',
  'multi-effects editor',
  'amp modeler editor',
  'NAM capture',
  'IR loader',
  'TONE3000',
  'Web MIDI',
  'open source',
];

/** The site origin (the Pages workflow sets SITE_URL), or undefined in local builds. */
export const siteOrigin = (): string | undefined => process.env.SITE_URL?.replace(/\/+$/, '') || undefined;

/** Absolute URL of a path under the deployed base path (GitHub Pages serves under /<repository>); a bare path without SITE_URL. */
export function absoluteUrl(path = '/'): string {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  return `${siteOrigin() ?? ''}${base}${path}`;
}

/** schema.org SoftwareApplication for the home page. */
export function softwareApplicationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: absoluteUrl('/'),
    operatingSystem: 'Web, macOS, Windows, Linux',
    applicationCategory: 'MultimediaApplication',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    license: 'https://opensource.org/licenses/MIT',
  };
}
