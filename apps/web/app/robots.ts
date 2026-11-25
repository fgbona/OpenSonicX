import type { MetadataRoute } from 'next';
import { absoluteUrl, siteOrigin } from '@/lib/seo';

// The static export writes it once, as robots.txt.
export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  // A sitemap line needs an absolute URL, so only with SITE_URL.
  return { rules: { userAgent: '*', allow: '/' }, ...(siteOrigin() && { sitemap: absoluteUrl('/sitemap.xml') }) };
}
