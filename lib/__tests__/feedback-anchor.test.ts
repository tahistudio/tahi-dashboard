/**
 * Pure helpers behind the feedback ball's "pick an element" mode
 * (lib/feedback-anchor.ts). Exercised with plain object doubles rather than
 * a real DOM, since this suite runs under Vitest's `node` environment.
 */
import { describe, it, expect } from 'vitest'
import {
  buildSelectorPath,
  describeElement,
  findScrollState,
  nearestSectionContext,
  rectInScroller,
  type AnchorElementLike,
  type ScrollerElementLike,
  type ScrollState,
} from '@/lib/feedback-anchor'

/** A minimal double satisfying AnchorElementLike. Attributes default empty. */
function node(overrides: Partial<AnchorElementLike> & { tagName: string }): AnchorElementLike {
  const attrs: Record<string, string | null> = {}
  return {
    id: null,
    textContent: null,
    parentElement: null,
    previousElementSibling: null,
    getAttribute: (name: string) => attrs[name] ?? null,
    ...overrides,
  }
}

/** A double whose attributes are backed by a real map, for id/testid/aria tests. */
function nodeWithAttrs(
  tagName: string,
  attrs: Record<string, string>,
  overrides: Partial<AnchorElementLike> = {},
): AnchorElementLike {
  return {
    id: null,
    textContent: null,
    parentElement: null,
    previousElementSibling: null,
    getAttribute: (name: string) => attrs[name] ?? null,
    tagName,
    ...overrides,
  }
}

describe('buildSelectorPath - preference order', () => {
  it('prefers the element\'s own id', () => {
    const el = nodeWithAttrs('button', { 'data-testid': 'save' }, { id: 'save-btn' })
    expect(buildSelectorPath(el)).toBe('#save-btn')
  })

  it('falls back to data-testid when there is no id', () => {
    const el = nodeWithAttrs('button', { 'data-testid': 'save', 'aria-label': 'Save' })
    expect(buildSelectorPath(el)).toBe('[data-testid="save"]')
  })

  it('falls back to aria-label when there is no id or data-testid', () => {
    const el = nodeWithAttrs('button', { 'aria-label': 'Save changes' })
    expect(buildSelectorPath(el)).toBe('[aria-label="Save changes"]')
  })

  it('falls back to a tag:nth-of-type path when none of the above are present', () => {
    const el = node({ tagName: 'span' })
    expect(buildSelectorPath(el)).toBe('span:nth-of-type(1)')
  })

  it('counts preceding siblings of the same tag for nth-of-type', () => {
    const first = node({ tagName: 'li' })
    const second = node({ tagName: 'li', previousElementSibling: first })
    const third = node({ tagName: 'li', previousElementSibling: second })
    expect(buildSelectorPath(third)).toBe('li:nth-of-type(3)')
  })

  it('does not count preceding siblings of a different tag', () => {
    const label = node({ tagName: 'label' })
    const target = node({ tagName: 'span', previousElementSibling: label })
    expect(buildSelectorPath(target)).toBe('span:nth-of-type(1)')
  })

  it('walks up to the nearest ancestor with an id and prefixes it', () => {
    const ancestor = nodeWithAttrs('div', {}, { id: 'card-1' })
    const parent = node({ tagName: 'div', parentElement: ancestor })
    const target = node({ tagName: 'button', parentElement: parent })
    expect(buildSelectorPath(target)).toBe('#card-1 > div:nth-of-type(1) > button:nth-of-type(1)')
  })

  it('stops walking the moment an ancestor id is found, ignoring ids further up', () => {
    const root = nodeWithAttrs('body', {}, { id: 'root' })
    const ancestor = nodeWithAttrs('div', {}, { id: 'card-1', parentElement: root })
    const parent = node({ tagName: 'div', parentElement: ancestor })
    const target = node({ tagName: 'button', parentElement: parent })
    expect(buildSelectorPath(target)).toBe('#card-1 > div:nth-of-type(1) > button:nth-of-type(1)')
  })
})

describe('buildSelectorPath - data-section as a root', () => {
  it('roots on an ancestor data-section when no ancestor has an id', () => {
    const card = nodeWithAttrs('DIV', { 'data-section': 'Retainer health' })
    const row = node({ tagName: 'DIV', parentElement: card })
    const b = node({ tagName: 'B', parentElement: row })
    expect(buildSelectorPath(b)).toBe('[data-section="Retainer health"] > div:nth-of-type(1) > b:nth-of-type(1)')
  })

  it('prefers an id over a data-section when the id is reached first', () => {
    const shell = node({ tagName: 'DIV', id: 'main-content' })
    const inner = node({ tagName: 'DIV', parentElement: shell })
    expect(buildSelectorPath(inner)).toBe('#main-content > div:nth-of-type(1)')
  })

  it('stops at the nearest data-section, ignoring one further up', () => {
    const zone = nodeWithAttrs('SECTION', { 'data-section': 'Clients' })
    const card = nodeWithAttrs('DIV', { 'data-section': 'Retainer health' }, { parentElement: zone })
    const b = node({ tagName: 'B', parentElement: card })
    expect(buildSelectorPath(b)).toBe('[data-section="Retainer health"] > b:nth-of-type(1)')
  })

  it('keeps the bare path when neither an id nor a data-section is above', () => {
    const outer = node({ tagName: 'DIV' })
    const b = node({ tagName: 'B', parentElement: outer })
    expect(buildSelectorPath(b)).toBe('div:nth-of-type(1) > b:nth-of-type(1)')
  })
})

describe('buildSelectorPath - capped at 8 segments', () => {
  it('never exceeds 8 tag segments when no ancestor has an id', () => {
    // Build a chain of 12 nested divs with no id anywhere.
    let current: AnchorElementLike | null = null
    for (let i = 0; i < 12; i++) {
      current = node({ tagName: 'div', parentElement: current })
    }
    const path = buildSelectorPath(current as AnchorElementLike)
    const segmentCount = path.split(' > ').length
    expect(segmentCount).toBe(8)
  })

  it('still finds an id root within the cap', () => {
    const root = nodeWithAttrs('main', {}, { id: 'app' })
    let current: AnchorElementLike = root
    for (let i = 0; i < 3; i++) {
      current = node({ tagName: 'div', parentElement: current })
    }
    const path = buildSelectorPath(current)
    expect(path.startsWith('#app > ')).toBe(true)
  })
})

describe('describeElement', () => {
  it('reads the tag name in lowercase', () => {
    expect(describeElement(node({ tagName: 'BUTTON' })).tag).toBe('button')
  })

  it('trims and collapses whitespace in the text', () => {
    const el = node({ tagName: 'p', textContent: '  hello   world  \n' })
    expect(describeElement(el).text).toBe('hello world')
  })

  it('caps text at 120 characters', () => {
    const long = 'x'.repeat(200)
    const el = node({ tagName: 'p', textContent: long })
    const { text } = describeElement(el)
    expect(text).toHaveLength(120)
    expect(text).toBe('x'.repeat(120))
  })

  it('returns an empty string for a null textContent', () => {
    const el = node({ tagName: 'div', textContent: null })
    expect(describeElement(el).text).toBe('')
  })
})

describe('nearestSectionContext', () => {
  it('is null when nothing has a data-section or aria-label', () => {
    const el = node({ tagName: 'span', parentElement: node({ tagName: 'div' }) })
    expect(nearestSectionContext(el)).toBeNull()
  })

  it('finds a data-section on an ancestor', () => {
    const section = nodeWithAttrs('section', { 'data-section': 'Billing' })
    const el = node({ tagName: 'span', parentElement: section })
    expect(nearestSectionContext(el)).toBe('Billing')
  })

  it('falls back to an ancestor aria-label when there is no data-section', () => {
    const region = nodeWithAttrs('div', { 'aria-label': 'Client details' })
    const el = node({ tagName: 'span', parentElement: region })
    expect(nearestSectionContext(el)).toBe('Client details')
  })

  it('does not look at the picked element\'s own attributes, only ancestors', () => {
    const el = nodeWithAttrs('div', { 'data-section': 'Self' })
    expect(nearestSectionContext(el)).toBeNull()
  })

  it('is null for a null element', () => {
    expect(nearestSectionContext(null)).toBeNull()
  })
})

/** A minimal double satisfying ScrollerElementLike. Not scrollable unless
 *  scrollHeight is given above clientHeight. */
function scroller(overrides: Partial<ScrollerElementLike> = {}): ScrollerElementLike {
  return {
    scrollLeft: 0,
    scrollTop: 0,
    scrollHeight: 100,
    clientHeight: 100,
    parentElement: null,
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0 }),
    ...overrides,
  }
}

const DOC: ScrollState = { originX: 0, originY: 0, scrollX: 0, scrollY: 0, scrollHeight: 800 }
const alwaysAuto = () => 'auto'
const alwaysVisible = () => 'visible'

describe('findScrollState', () => {
  it('falls back to the document when nothing up the tree scrolls', () => {
    const el = scroller({ parentElement: scroller({ parentElement: null }) })
    expect(findScrollState(el, alwaysVisible, DOC)).toEqual(DOC)
  })

  it('ignores an ancestor whose content fits, even when overflow allows scrolling', () => {
    const el = scroller({ parentElement: scroller({ scrollHeight: 400, clientHeight: 400 }) })
    expect(findScrollState(el, alwaysAuto, DOC)).toEqual(DOC)
  })

  it('finds the nearest scrolling ancestor and reads its origin, offset and height', () => {
    const main = scroller({
      scrollHeight: 4200,
      clientHeight: 700,
      scrollTop: 1200,
      scrollLeft: 5,
      getBoundingClientRect: () => ({ x: 0, y: 64, width: 384, height: 700 }),
    })
    const el = scroller({ parentElement: main })
    expect(findScrollState(el, alwaysAuto, DOC)).toEqual({
      originX: 0,
      originY: 64,
      scrollX: 5,
      scrollY: 1200,
      scrollHeight: 4200,
    })
  })

  it('stops at the nearest scroller, ignoring scrollers further up', () => {
    const outer = scroller({ scrollHeight: 9000, clientHeight: 500, scrollTop: 3000 })
    const inner = scroller({ scrollHeight: 2000, clientHeight: 400, scrollTop: 100, parentElement: outer })
    const el = scroller({ parentElement: inner })
    expect(findScrollState(el, alwaysAuto, DOC).scrollHeight).toBe(2000)
  })

  it('never treats the picked element itself as its own scroller', () => {
    const el = scroller({ scrollHeight: 5000, clientHeight: 300, parentElement: null })
    expect(findScrollState(el, alwaysAuto, DOC)).toEqual(DOC)
  })

  it('is the document state for a null element', () => {
    expect(findScrollState(null, alwaysAuto, DOC)).toEqual(DOC)
  })

  it('only counts overflow values that actually scroll', () => {
    const parent = scroller({ scrollHeight: 900, clientHeight: 300 })
    const el = scroller({ parentElement: parent })
    expect(findScrollState(el, () => 'hidden', DOC)).toEqual(DOC)
    expect(findScrollState(el, () => 'clip', DOC)).toEqual(DOC)
    expect(findScrollState(el, () => 'scroll', DOC).scrollHeight).toBe(900)
  })
})

describe('rectInScroller', () => {
  it('adds scroll offset to translate viewport rect to content rect', () => {
    const result = rectInScroller({ x: 10, y: 20, width: 100, height: 50 }, { ...DOC, scrollY: 200, scrollHeight: 900 })
    expect(result).toEqual({ x: 10, y: 220, width: 100, height: 50, scrollHeight: 900 })
  })

  it('rounds every field to the nearest integer', () => {
    const result = rectInScroller(
      { x: 10.6, y: 20.4, width: 99.5, height: 49.49 },
      { originX: 0, originY: 0, scrollX: 0.5, scrollY: 0.4, scrollHeight: 900.9 },
    )
    expect(result).toEqual({ x: 11, y: 21, width: 100, height: 49, scrollHeight: 901 })
  })

  it('handles zero scroll', () => {
    const result = rectInScroller({ x: 5, y: 5, width: 10, height: 10 }, { ...DOC, scrollHeight: 500 })
    expect(result).toEqual({ x: 5, y: 5, width: 10, height: 10, scrollHeight: 500 })
  })

  it('subtracts the scroller origin so the rect is content-relative, not viewport-relative', () => {
    // <main> starts 64px down the viewport and is scrolled 1200px. A card
    // sitting 300px down the screen is 1436px down the scrollable content.
    const result = rectInScroller(
      { x: 33, y: 300, width: 313, height: 52 },
      { originX: 0, originY: 64, scrollX: 0, scrollY: 1200, scrollHeight: 4200 },
    )
    expect(result).toEqual({ x: 33, y: 1436, width: 313, height: 52, scrollHeight: 4200 })
  })
})
