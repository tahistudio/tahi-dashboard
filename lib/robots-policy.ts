/**
 * Crawler policy for the whole dashboard and portal (T1.7).
 *
 * Nothing served from this app is meant to be indexed: the dashboard, the
 * client portal, the secret-link document viewers (/p/*, /review/*) and every
 * API route are private. Three layers say so, so no single one is a point of
 * failure: robots.txt (app/robots.ts), an X-Robots-Tag response header
 * (next.config.ts headers()) and metadata.robots in the root layout.
 *
 * The MCP OAuth metadata lives on the separate MCP worker, not this app, so
 * it is unaffected.
 */

/** Value of the X-Robots-Tag header sent on every app and API response. */
export const NOINDEX_HEADER_VALUE = 'noindex, nofollow, noarchive'

/** Common AI and training crawlers, named explicitly in robots.txt. */
export const AI_CRAWLER_USER_AGENTS = [
  'GPTBot',
  'ChatGPT-User',
  'OAI-SearchBot',
  'ClaudeBot',
  'Claude-Web',
  'anthropic-ai',
  'CCBot',
  'Google-Extended',
  'PerplexityBot',
  'Bytespider',
  'Applebot-Extended',
] as const
