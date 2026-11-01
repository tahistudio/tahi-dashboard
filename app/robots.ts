import type { MetadataRoute } from 'next'
import { AI_CRAWLER_USER_AGENTS } from '@/lib/robots-policy'

/**
 * robots.txt: disallow everything for every crawler, AI crawlers named
 * explicitly so the intent is unmistakable. Nothing here is public.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', disallow: '/' },
      ...AI_CRAWLER_USER_AGENTS.map((userAgent) => ({ userAgent, disallow: '/' })),
    ],
  }
}
