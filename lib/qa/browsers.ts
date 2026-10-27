/**
 * Browser handling for Site QA rounds. Pure: no database, no Next.js imports.
 *
 * A page renders with the engine of the browser it is open in, so a round can
 * cover several browsers and every tick, scan and comment says which one it
 * came from. Chromium ticks stay in the qa_round_pages.vp_* columns (so rounds
 * made before browsers existed read the same); Firefox and WebKit ticks live in
 * qa_browser_ticks.
 */
import {
  QA_BROWSER_KEYS,
  QA_DEFAULT_BROWSER,
  QA_VIEWPORT_KEYS,
  isQaBrowserKey,
  type QaBrowserKey,
  type QaIssue,
  type QaViewportKey,
} from './types'

/**
 * The engine a user agent string renders with. iOS browsers are all WebKit
 * whatever their name says, so any iPhone, iPad or iPod user agent is WebKit.
 * Firefox is checked next, then Safari: Safari's user agent names Safari but not
 * Chrome, Chromium, CriOS, Edg, OPR or FxiOS, which all name Safari too.
 * Anything else is Chromium.
 */
export function detectBrowser(userAgent: string): QaBrowserKey {
  const ua = userAgent ?? ''
  if (/iPhone|iPad|iPod/.test(ua)) return 'webkit'
  if (/Firefox\//.test(ua)) return 'firefox'
  if (/Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|FxiOS/.test(ua)) return 'webkit'
  return 'chromium'
}

/** Puts browser keys in canonical order and drops repeats. */
function canonical(keys: Iterable<QaBrowserKey>): QaBrowserKey[] {
  const set = new Set(keys)
  return QA_BROWSER_KEYS.filter(k => set.has(k))
}

/**
 * Reads the qa_rounds.browsers column (a JSON array). A missing, broken or empty
 * value is the default, Chrome only, so a round made before browsers existed
 * still opens.
 */
export function parseRoundBrowsers(raw: string | null | undefined): QaBrowserKey[] {
  if (!raw) return [QA_DEFAULT_BROWSER]
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [QA_DEFAULT_BROWSER]
    const keys = canonical(parsed.filter(isQaBrowserKey))
    return keys.length > 0 ? keys : [QA_DEFAULT_BROWSER]
  } catch {
    return [QA_DEFAULT_BROWSER]
  }
}

/**
 * Validates a browsers value from a request: a non-empty array of known browser
 * keys. Returns the canonical, de-duplicated list, or null when it is not valid.
 */
export function parseBrowserInput(value: unknown): QaBrowserKey[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  if (!value.every(isQaBrowserKey)) return null
  return canonical(value)
}

/** Ticks for one browser on one round page. */
export type QaBrowserTickMap = Record<QaViewportKey, boolean>

export function emptyTickMap(): QaBrowserTickMap {
  return { xl: false, desktop: false, tablet: false, mobile_l: false, mobile_p: false }
}

/** The vp_* columns of a qa_round_pages row. */
export interface ChromiumTickColumns {
  vpXl: number
  vpDesktop: number
  vpTablet: number
  vpMobileL: number
  vpMobileP: number
}

export function chromiumTicks(row: ChromiumTickColumns): QaBrowserTickMap {
  return {
    xl: row.vpXl === 1,
    desktop: row.vpDesktop === 1,
    tablet: row.vpTablet === 1,
    mobile_l: row.vpMobileL === 1,
    mobile_p: row.vpMobileP === 1,
  }
}

/** One qa_browser_ticks row. */
export interface BrowserTickRow {
  roundPageId: string
  browser: string
  viewport: string
  ticked: number
}

/**
 * Ticks per browser for every page of a round. Chromium comes from the vp_*
 * columns, the other browsers from the qa_browser_ticks rows of the whole round
 * (one query). Only the round's own browsers are returned: a browser removed from
 * the round keeps its rows but is hidden. A page with no row for a browser has no
 * ticks there.
 */
export function mergeBrowserTicks(
  pages: (ChromiumTickColumns & { id: string })[],
  tickRows: readonly BrowserTickRow[],
  browsers: readonly QaBrowserKey[],
): Map<string, Partial<Record<QaBrowserKey, QaBrowserTickMap>>> {
  const out = new Map<string, Partial<Record<QaBrowserKey, QaBrowserTickMap>>>()
  for (const page of pages) {
    const perBrowser: Partial<Record<QaBrowserKey, QaBrowserTickMap>> = {}
    for (const b of browsers) perBrowser[b] = b === 'chromium' ? chromiumTicks(page) : emptyTickMap()
    out.set(page.id, perBrowser)
  }
  for (const row of tickRows) {
    if (row.browser === 'chromium' || !isQaBrowserKey(row.browser)) continue
    if (!(QA_VIEWPORT_KEYS as readonly string[]).includes(row.viewport)) continue
    const map = out.get(row.roundPageId)?.[row.browser]
    if (map) map[row.viewport as QaViewportKey] = row.ticked === 1
  }
  return out
}

/** Ticks done across the given browsers for one page's tick maps. */
export function countTicks(
  perBrowser: Partial<Record<QaBrowserKey, QaBrowserTickMap>>,
  browsers: readonly QaBrowserKey[],
): number {
  let n = 0
  for (const b of browsers) {
    const map = perBrowser[b]
    if (map) n += QA_VIEWPORT_KEYS.filter(v => map[v]).length
  }
  return n
}

/**
 * The key two browsers' issues share when they are the same finding: the code,
 * the selector (left out for url-based link issues), the url (an axe rule's help url, a link or image url) and the
 * viewport. An issue with neither selector nor url falls back to its message.
 * Perf issues leave the viewport out: one image flagged at different widths in
 * different browsers is still one image (pageIssues already keeps one per
 * code and url inside a browser).
 */
export function issueDedupeKey(issue: QaIssue): string {
  const viewport = issue.category === 'perf' ? '' : (issue.viewport ?? '')
  const message = issue.selector || issue.url ? '' : issue.message
  // Url-based link issues are one per url inside a browser, whichever element came first.
  const selector = issue.category === 'links' && issue.url ? '' : (issue.selector ?? '')
  return `${issue.code}|${selector}|${issue.url ?? ''}|${message}|${viewport}`
}

/**
 * Merges the issues each browser found into one list. An identical issue (same
 * code, selector, url and viewport) seen in several browsers appears once, with every
 * browser that showed it in `browsers`, so three browsers do not triple the
 * counts. Repeats inside one browser are kept: the nth repeat in a later browser
 * merges into the nth in an earlier one. Input order decides which browser is
 * reported first.
 */
export function mergeBrowserIssues(perBrowser: readonly (readonly [QaBrowserKey, QaIssue[]])[]): QaIssue[] {
  const merged: QaIssue[] = []
  const byKey = new Map<string, QaIssue[]>()
  for (const [browser, issues] of perBrowser) {
    const seen = new Map<string, number>()
    for (const issue of issues) {
      const key = issueDedupeKey(issue)
      const index = seen.get(key) ?? 0
      seen.set(key, index + 1)
      const existing = byKey.get(key)?.[index]
      if (existing) {
        if (!existing.browsers?.includes(browser)) existing.browsers = [...(existing.browsers ?? []), browser]
        continue
      }
      const copy: QaIssue = { ...issue, browser, browsers: [browser] }
      merged.push(copy)
      byKey.set(key, [...(byKey.get(key) ?? []), copy])
    }
  }
  return merged
}
