/**
 * Pure helpers for the Add pages dialog. No React, no fetch, so they can be
 * unit tested in the node environment.
 */

export const PAGE_PATH_LIMIT = 500
export const CRAWL_MAX_PAGES_LIMIT = 150
export const CRAWL_MAX_PAGES_DEFAULT = 100

/** The non-empty lines of a pasted list, trimmed. Blank lines are dropped. */
export function nonEmptyLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0)
}

/**
 * Parses a pasted list of paths or full URLs, one per line. Each line is
 * trimmed, blanks are dropped and exact duplicates are removed, keeping the
 * first occurrence. Full URLs are kept as typed; the server normalises them.
 */
export function parsePathList(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of nonEmptyLines(text)) {
    if (seen.has(line)) continue
    seen.add(line)
    out.push(line)
  }
  return out
}

/** Number of non-empty lines, shown as the live count under the textarea. */
export function countNonEmptyLines(text: string): number {
  return nonEmptyLines(text).length
}

/** True when the parsed list is within the bulk add limit (1 to 500). */
export function isPathListWithinLimit(paths: readonly string[]): boolean {
  return paths.length >= 1 && paths.length <= PAGE_PATH_LIMIT
}

/**
 * Parses the max pages input. Returns the integer when it is a whole number
 * from 1 to 150, otherwise null.
 */
export function parseMaxPages(raw: string): number | null {
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const value = Number(trimmed)
  if (!Number.isSafeInteger(value)) return null
  if (value < 1 || value > CRAWL_MAX_PAGES_LIMIT) return null
  return value
}

/** True when the value is an absolute https URL with a host. */
export function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' && url.hostname.length > 0
  } catch {
    return false
  }
}
