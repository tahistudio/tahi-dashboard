/**
 * lib/feedback-anchor.ts
 *
 * Pure helpers behind the feedback ball's "pick an element" mode
 * (components/tahi/feedback-ball.tsx). Given the element a user clicked on
 * while picking, these build the anchor payload POSTed alongside the
 * comment: a CSS-ish selector path, a short description, and its bounding
 * rect relative to the page.
 *
 * Every helper takes a minimal structural interface (AnchorElementLike)
 * rather than a real DOM Element so it can be unit tested with plain object
 * doubles under Vitest's `node` environment (no jsdom in this repo). A real
 * HTMLElement satisfies this interface as-is; no adapter needed at the call
 * site.
 */

export interface AnchorElementLike {
  tagName: string
  id: string | null
  textContent: string | null
  parentElement: AnchorElementLike | null
  previousElementSibling: AnchorElementLike | null
  getAttribute(name: string): string | null
}

export interface RectLike {
  x: number
  y: number
  width: number
  height: number
}

export interface ScrollLike {
  x: number
  y: number
}

/** The bounding rect the anchor stores: the element's box relative to the
 *  page (not the viewport) plus the page's total scroll size, all rounded to
 *  integers. Five integer fields, matching the server's validation. */
export interface AnchorRect extends RectLike {
  scrollHeight: number
}

const MAX_SELECTOR_SEGMENTS = 8
const MAX_TEXT_LENGTH = 120

function tagOf(el: AnchorElementLike): string {
  return el.tagName.toLowerCase()
}

/** 1-based position of `el` among preceding siblings sharing its tag name. */
function nthOfType(el: AnchorElementLike): number {
  let n = 1
  let sibling = el.previousElementSibling
  while (sibling) {
    if (tagOf(sibling) === tagOf(el)) n++
    sibling = sibling.previousElementSibling
  }
  return n
}

function tagSegment(el: AnchorElementLike): string {
  return `${tagOf(el)}:nth-of-type(${nthOfType(el)})`
}

/**
 * A selector path for `el` that survives reloads where possible.
 *
 * Preference order:
 *   1. The element's own id: `#id` (short, and typically stable and unique).
 *   2. The element's own `data-testid`, then `aria-label`, as an attribute
 *      selector.
 *   3. Otherwise, a `tag:nth-of-type(n)` path walking up from the element,
 *      stopping at the nearest ancestor with an id (prefixed as `#id`), and
 *      capped at 8 tag segments so a deeply nested pick still produces a
 *      short, readable path even with no id anywhere nearby.
 */
export function buildSelectorPath(el: AnchorElementLike): string {
  if (el.id) return `#${el.id}`

  const testId = el.getAttribute('data-testid')
  if (testId) return `[data-testid="${testId}"]`

  const ariaLabel = el.getAttribute('aria-label')
  if (ariaLabel) return `[aria-label="${ariaLabel}"]`

  const segments: string[] = []
  let current: AnchorElementLike | null = el
  let ancestorId: string | null = null

  while (current && segments.length < MAX_SELECTOR_SEGMENTS) {
    segments.unshift(tagSegment(current))
    const parent: AnchorElementLike | null = current.parentElement
    if (parent?.id) {
      ancestorId = parent.id
      break
    }
    current = parent
  }

  const path = segments.join(' > ')
  return ancestorId ? `#${ancestorId} > ${path}` : path
}

/** The picked element's tag name and its visible text, trimmed and collapsed
 *  to a single line, capped at 120 characters. */
export function describeElement(el: AnchorElementLike): { tag: string; text: string } {
  const tag = tagOf(el)
  const collapsed = (el.textContent ?? '').trim().replace(/\s+/g, ' ')
  return { tag, text: collapsed.slice(0, MAX_TEXT_LENGTH) }
}

/** The nearest ancestor (not the element itself) carrying a `data-section`
 *  or `aria-label`, for a little human context on where the pick landed.
 *  Null when nothing up the tree carries either. */
export function nearestSectionContext(el: AnchorElementLike | null): string | null {
  let current = el?.parentElement ?? null
  while (current) {
    const section = current.getAttribute('data-section')
    if (section) return section
    const ariaLabel = current.getAttribute('aria-label')
    if (ariaLabel) return ariaLabel
    current = current.parentElement
  }
  return null
}

/** The picked element's bounding rect translated from viewport-relative
 *  (what getBoundingClientRect returns) to page-relative (adding the current
 *  scroll offset), plus the page's total scroll height, all rounded to
 *  integers so every stored field is a plain integer. */
export function rectOnPage(rect: RectLike, scroll: ScrollLike, scrollHeight: number): AnchorRect {
  return {
    x: Math.round(rect.x + scroll.x),
    y: Math.round(rect.y + scroll.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    scrollHeight: Math.round(scrollHeight),
  }
}
