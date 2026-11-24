import type { MetadataRoute } from 'next';

// The static export writes it once, as manifest.webmanifest (Next links it from every page).
export const dynamic = 'force-static';

/** Makes the editor installable as an app (Chrome on Android: menu > Install app). */
export default function manifest(): MetadataRoute.Manifest {
  // Next does not add the base path inside the manifest: GitHub Pages serves under /<repository>.
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  return {
    id: `${base}/`,
    name: 'OpenSonicX',
    short_name: 'OpenSonicX',
    description: 'Free editor for the Sonicake Pocket Master and the Valeton/Sonicake Matribox II Pro.',
    start_url: `${base}/`,
    scope: `${base}/`,
    display: 'standalone',
    background_color: '#0b0d10',
    theme_color: '#0b0d10',
    categories: ['music', 'utilities'],
    icons: [
      { src: `${base}/icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${base}/icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `${base}/icons/maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
