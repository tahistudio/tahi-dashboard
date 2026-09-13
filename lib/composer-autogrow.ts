/**
 * lib/composer-autogrow.ts
 *
 * The wizard composer used to sit at a fixed one-line height with a CSS
 * max-height and no code that ever grew it, so a longer answer scrolled
 * inside a box that never visibly expanded. Growing a textarea always
 * needs the browser's measured `scrollHeight`, so the DOM half of this
 * lives beside the textarea in the component. This file is the pure half:
 * given the measurements the browser already reports, decide the height to
 * apply and whether the box should scroll, so that arithmetic can be tested
 * without a DOM.
 */

/** How many lines the composer grows to before it scrolls instead. */
export const COMPOSER_MAX_LINES = 8

export interface ComposerHeight {
  /** The height to set on the textarea, in the same unit as the inputs. */
  height: number
  /** True once content is taller than the cap: the box stops growing and
   *  scrolls internally instead. */
  scrolls: boolean
}

/**
 * Clamp a textarea's natural (scroll) height to at most `maxLines` lines.
 *
 * `lineHeight` and `verticalPadding` are read from the element's computed
 * style by the caller (both resolve to real pixels regardless of the
 * root font size, so this never hardcodes a px assumption about rem). All
 * three of `scrollHeight`, `lineHeight` and `verticalPadding` are plain
 * numbers here on purpose: no `HTMLElement` crosses into this function, so
 * it runs the same in a test as in a browser.
 */
export function clampComposerHeight(
  scrollHeight: number,
  lineHeight: number,
  maxLines: number = COMPOSER_MAX_LINES,
  verticalPadding: number = 0,
): ComposerHeight {
  const safeLineHeight = Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : 20
  const safePadding = Number.isFinite(verticalPadding) && verticalPadding > 0 ? verticalPadding : 0
  const max = safeLineHeight * Math.max(1, maxLines) + safePadding
  const natural = Number.isFinite(scrollHeight) && scrollHeight > 0 ? scrollHeight : safeLineHeight + safePadding
  return {
    height: Math.min(natural, max),
    scrolls: natural > max,
  }
}
