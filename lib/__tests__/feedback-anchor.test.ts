/**
 * Pure helpers behind the feedback ball's "pick an element" mode
 * (lib/feedback-anchor.ts). Exercised with plain object doubles rather than
 * a real DOM, since this suite runs under Vitest's `node` environment.
 */
import { describe, it, expect } from 'vitest'
import {
  buildSelectorPath,
  describeElement,
  nearestSectionContext,
  rectOnPage,
  type AnchorElementLike,
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

describe('rectOnPage', () => {
  it('adds scroll offset to translate viewport rect to page rect', () => {
    const result = rectOnPage({ x: 10, y: 20, width: 100, height: 50 }, { x: 0, y: 200 }, 900)
    expect(result).toEqual({ x: 10, y: 220, width: 100, height: 50, scrollHeight: 900 })
  })

  it('rounds every field to the nearest integer', () => {
    const result = rectOnPage({ x: 10.6, y: 20.4, width: 99.5, height: 49.49 }, { x: 0.5, y: 0.4 }, 900.9)
    expect(result).toEqual({ x: 11, y: 21, width: 100, height: 49, scrollHeight: 901 })
  })

  it('handles zero scroll', () => {
    const result = rectOnPage({ x: 5, y: 5, width: 10, height: 10 }, { x: 0, y: 0 }, 500)
    expect(result).toEqual({ x: 5, y: 5, width: 10, height: 10, scrollHeight: 500 })
  })
})
