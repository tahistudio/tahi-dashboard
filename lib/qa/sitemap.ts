/** Sitemap XML parsing for SQA page import. Pure, regex based (no DOMParser on Workers). */

export interface ParsedSitemap { kind: 'urlset' | 'index'; locs: string[] }

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

export function parseSitemap(xml: string): ParsedSitemap {
  const kind: ParsedSitemap['kind'] = /<sitemapindex[\s>]/i.test(xml) ? 'index' : 'urlset'
  const locs: string[] = []
  const re = /<loc>\s*([^<]+?)\s*<\/loc>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) locs.push(decodeEntities(m[1]))
  return { kind, locs }
}

export function normalisePath(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  let pathname: string
  if (/^https?:\/\//i.test(raw)) {
    try {
      pathname = new URL(raw).pathname
    } catch {
      return null
    }
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    return null
  } else {
    pathname = raw.split(/[?#]/)[0]
  }
  if (!pathname.startsWith('/')) pathname = `/${pathname}`
  if (pathname.length > 1) pathname = pathname.replace(/\/+$/, '')
  return pathname || '/'
}

export const SITEMAP_MAX_FILES = 5
export const SITEMAP_MAX_URLS = 2000
