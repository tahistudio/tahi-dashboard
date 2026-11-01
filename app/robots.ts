import type { MetadataRoute } from 'next'
import {
  AI_CRAWLER_USER_AGENTS,
  PUBLIC_PREVIEW_ASSETS,
  PUBLIC_SHARE_PATH_PREFIXES,
} from '@/lib/robots-policy'

/**
 * robots.txt: disallow everything, except the secret-link share viewers stay
 * fetchable so their noindex is seen (see lib/robots-policy.ts). AI crawlers
 * are named and disallowed entirely, share links included.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: [...PUBLIC_SHARE_PATH_PREFIXES, ...PUBLIC_PREVIEW_ASSETS], disallow: '/' },
      ...AI_CRAWLER_USER_AGENTS.map((userAgent) => ({ userAgent, disallow: '/' })),
    ],
  }
}
