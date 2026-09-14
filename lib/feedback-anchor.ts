/**
 * lib/feedback-anchor.ts
 *
 * Pure helpers behind the feedback ball's "pick an element" mode
 * (components/tahi/feedback-ball.tsx). Given the element a user clicked on
 * while picking, these build the anchor payload POSTed alongside the
 * comment: a CSS-ish selector path, a short description, and its bounding
 * rect relative to whatever scrolls it.
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

/** The structural slice of a DOM element the scroller walk reads. A real
 *  HTMLElement satisfies this as-is. */
export interface ScrollerElementLike {
  scrollLeft: number
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  parentElement: ScrollerElementLike | null
  getBoundingClientRect(): RectLike
}

/** Where the picked element's scroll container is and how far it is scrolled.
 *  `originX/originY` are viewport coordinates of the scroller's own box (0,0
 *  when the document itself is what scrolls). */
export interface ScrollState {
  originX: number
  originY: number
  scrollX: number
  scrollY: number
  scrollHeight: number
}

/** The bounding rect the anchor stores: the element's box relative to the
 *  content box of whatever scrolls it (not the viewport) plus that
 *  scroller's total scroll size, all rounded to integers. Five integer
 *  fields, matching the server's validation. */
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
 *      stopping at the nearest ancestor that roots it: an id (prefixed as
 *      `#id`) or a `data-section` (prefixed as `[data-section="..."]`),
 *      whichever is reached first, and capped at 8 tag segments so a deeply
 *      nested pick still produces a short, readable path.
 *
 * data-section is a root because the dashboard has very few ids but every
 * overview card, zone and hero block carries one. Without it a pick deep
 * inside a card (a <b> in a row in a list in a card) burns all 8 segments
 * before reaching #main-content and comes back anchored to nothing, which is
 * what happened to the 2026-09-15 Retainer health comment.
 */
export function buildSelectorPath(el: AnchorElementLike): string {
  if (el.id) return `#${el.id}`

  const testId = el.getAttribute('data-testid')
  if (testId) return `[data-testid="${testId}"]`

  const ariaLabel = el.getAttribute('aria-label')
  if (ariaLabel) return `[aria-label="${ariaLabel}"]`

  const segments: string[] = []
  let current: AnchorElementLike | null = el
  let root: string | null = null

  while (current && segments.length < MAX_SELECTOR_SEGMENTS) {
    segments.unshift(tagSegment(current))
    const parent: AnchorElementLike | null = current.parentElement
    if (!parent) break
    if (parent.id) {
      root = `#${parent.id}`
      break
    }
    const section = parent.getAttribute('data-section')
    if (section) {
      root = `[data-section="${section}"]`
      break
    }
    current = parent
  }

  const path = segments.join(' > ')
  return root ? `${root} > ${path}` : path
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

/** Which overflow values actually scroll. `visible` and `hidden` do not, and
 *  `clip` cannot scroll at all. */
const SCROLLABLE_OVERFLOW = new Set(['auto', 'scroll', 'overlay'])

/** The element whose scrolling moves the picked element, and where it sits.
 *  `originX/originY` is that scroller's own box in viewport coordinates, which
 *  is what has to come back off the picked element's rect before the scroll
 *  offset goes on. The document case is origin 0,0. */
export function findScrollState(
  el: ScrollerElementLike | null,
  readOverflowY: (el: ScrollerElementLike) => string,
  documentState: ScrollState,
): ScrollState {
  let current = el?.parentElement ?? null
  while (current) {
    if (current.scrollHeight > current.clientHeight && SCROLLABLE_OVERFLOW.has(readOverflowY(current))) {
      const box = current.getBoundingClientRect()
      return {
        originX: box.x,
        originY: box.y,
        scrollX: current.scrollLeft,
        scrollY: current.scrollTop,
        scrollHeight: current.scrollHeight,
      }
    }
    current = current.parentElement
  }
  return documentState
}

/** The picked element's bounding rect translated from viewport-relative (what
 *  getBoundingClientRect returns) to content-relative: relative to the top of
 *  whatever actually scrolls it, with that scroller's total scroll height as
 *  the denominator. All rounded to integers so every stored field is a plain
 *  integer, matching the server's validation.
 *
 *  Not `window.scrollY` + `document.documentElement.scrollHeight`, which is
 *  what this did until 2026-09-14 and which is wrong on every dashboard
 *  screen: the shell scrolls inside <main class="overflow-y-auto">, so the
 *  document never scrolls, window.scrollY is always 0 and the document's
 *  scrollHeight is just the viewport height. Anchors picked below the fold
 *  came back with their on-screen y, not their position in the page. */
export function rectInScroller(rect: RectLike, scroll: ScrollState): AnchorRect {
  return {
    x: Math.round(rect.x - scroll.originX + scroll.scrollX),
    y: Math.round(rect.y - scroll.originY + scroll.scrollY),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    scrollHeight: Math.round(scroll.scrollHeight),
  }
}
