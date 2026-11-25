import type { MetadataRoute } from 'next';
import { absoluteUrl } from '@/lib/seo';

// The static export writes it once, as sitemap.xml.
export const dynamic = 'force-static';

// One page: the editor itself (/preview renders nothing in production).
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: absoluteUrl('/'), changeFrequency: 'monthly', priority: 1 }];
}
