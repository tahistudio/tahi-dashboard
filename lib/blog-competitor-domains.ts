/**
 * Competitor agency domains we don't want to link to from the blog.
 *
 * Rule (Liam, 2026-05-29): "I'd like to not link to other agencies where
 * possible. Happy with products. We're linking to other websites instead
 * of our own really."
 *
 * Applied at three pipeline points:
 *   1. Research stage — Perplexity citations are filtered before reaching
 *      the writer, so competitor sources never enter the brief.
 *   2. Body sanitize pass — any external link in the final markdown whose
 *      hostname matches is unlinked (text preserved). External non-agency
 *      links (Webflow docs, Figma, Stripe, w3.org, etc.) are kept.
 *   3. Writer / strategist system prompt — explicit instruction to prefer
 *      products, official docs, and standards bodies over agency posts.
 *
 * Add new domains as you find them. Hostnames only (no protocol, no
 * www, no path). Subdomains of a listed root are also blocked.
 */

export const COMPETITOR_AGENCY_DOMAINS: ReadonlyArray<string> = [
  // Well-known Webflow / design agencies. Edit freely.
  'edgarallan.com',
  'refokus.com',
  'flow.ninja',
  'duckdesign.studio',
  'studio-anchor.com',
  'digidop.io',
  'digidop.fr',
  'minorstudios.com',
  'ueno.co',
  'wedoflow.com',
  'nidostudio.com',
  'studiosova.com',
  'supercosm.com',
  'arcadia.studio',
  'northell.design',
  'eight25media.com',
  'finsweet.com',
  // Add more here.
] as const

/** Domains we explicitly never block — Tahi's own properties plus Liam's
 *  other projects. Defensive: stops a future edit to the blocklist from
 *  accidentally taking out our own links. */
const ALLOWLIST: ReadonlyArray<string> = [
  'tahi.studio',
  'tahistudio.com',
  'getnodeo.com',
  'nodeo.com',
] as const

function normaliseHostname(input: string): string | null {
  let host = input.trim().toLowerCase()
  if (!host) return null
  // Strip protocol if present.
  host = host.replace(/^https?:\/\//, '')
  // Strip path/query/fragment.
  host = host.split('/')[0]
  host = host.split('?')[0]
  host = host.split('#')[0]
  // Strip port.
  host = host.split(':')[0]
  // Strip leading www.
  host = host.replace(/^www\./, '')
  return host || null
}

/** True if the URL's hostname matches a blocked competitor (exact or
 *  subdomain). Allowlist wins over blocklist. */
export function isCompetitorAgency(url: string): boolean {
  let host: string | null
  try {
    host = normaliseHostname(new URL(url).hostname)
  } catch {
    host = normaliseHostname(url)
  }
  if (!host) return false
  if (ALLOWLIST.some(a => host === a || host.endsWith('.' + a))) return false
  return COMPETITOR_AGENCY_DOMAINS.some(d => host === d || host.endsWith('.' + d))
}

/** Filter an array of { url } items, dropping competitor-agency entries.
 *  Returns the kept list + the dropped list for logging. */
export function filterOutCompetitors<T extends { url: string }>(items: T[]): { kept: T[]; dropped: T[] } {
  const kept: T[] = []
  const dropped: T[] = []
  for (const it of items) {
    if (isCompetitorAgency(it.url)) dropped.push(it)
    else kept.push(it)
  }
  return { kept, dropped }
}
