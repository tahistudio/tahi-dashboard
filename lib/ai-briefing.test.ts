/**
 * The daily briefing parser.
 *
 * Client-authored text reaches this prompt (stagnant request titles go in
 * verbatim), so the model's answer is untrusted input: a request titled with
 * an injected item fragment could steer both the category, breaking every
 * lookup keyed on the union, and the link target of a briefing row. The parser
 * now drops an item whose category or priority is outside the union and keeps
 * an href only when it is a same-origin path into a known dashboard section.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/db/d1', () => ({ schema: {} }))

import {
  parseBriefingResponse,
  isBriefingCategory,
  isBriefingPriority,
  isSafeBriefingHref,
} from '@/lib/ai-briefing'

function briefing(items: string): string {
  return `<briefing><summary>Morning.</summary><today>${items}</today><week></week></briefing>`
}

function item(category: string, priority: string, href?: string): string {
  const hrefAttr = href === undefined ? '' : ` href="${href}"`
  return `<item category="${category}" priority="${priority}"${hrefAttr}><title>A title</title><detail>Some detail</detail></item>`
}

describe('isBriefingCategory', () => {
  it('accepts the six real categories', () => {
    for (const c of ['invoice', 'request', 'health', 'pipeline', 'capacity', 'task']) {
      expect(isBriefingCategory(c)).toBe(true)
    }
  })

  it('rejects anything else', () => {
    expect(isBriefingCategory('invoice ')).toBe(false)
    expect(isBriefingCategory('urgent')).toBe(false)
    expect(isBriefingCategory('')).toBe(false)
  })
})

describe('isBriefingPriority', () => {
  it('accepts high, medium and low only', () => {
    expect(isBriefingPriority('high')).toBe(true)
    expect(isBriefingPriority('medium')).toBe(true)
    expect(isBriefingPriority('low')).toBe(true)
    expect(isBriefingPriority('critical')).toBe(false)
  })
})

describe('isSafeBriefingHref', () => {
  it('accepts a path into a known dashboard section', () => {
    expect(isSafeBriefingHref('/requests')).toBe(true)
    expect(isSafeBriefingHref('/invoices/inv_123')).toBe(true)
    expect(isSafeBriefingHref('/clients?status=active')).toBe(true)
  })

  it('rejects anything that leaves the dashboard', () => {
    expect(isSafeBriefingHref('https://evil.example/steal')).toBe(false)
    expect(isSafeBriefingHref('//evil.example/steal')).toBe(false)
    expect(isSafeBriefingHref('javascript:alert(1)')).toBe(false)
    expect(isSafeBriefingHref('/requests/../../etc')).toBe(false)
    expect(isSafeBriefingHref('/unknown-section')).toBe(false)
    expect(isSafeBriefingHref('/requests" onclick="x')).toBe(false)
  })
})

describe('parseBriefingResponse', () => {
  it('keeps a well-formed item', () => {
    const parsed = parseBriefingResponse(briefing(item('invoice', 'high', '/invoices')))
    expect(parsed.todayItems).toHaveLength(1)
    expect(parsed.todayItems[0]).toMatchObject({
      category: 'invoice',
      priority: 'high',
      title: 'A title',
      detail: 'Some detail',
      href: '/invoices',
    })
  })

  it('drops an item whose category is outside the union', () => {
    const parsed = parseBriefingResponse(briefing(item('urgent', 'high')))
    expect(parsed.todayItems).toHaveLength(0)
  })

  it('drops an item whose priority is outside the union', () => {
    const parsed = parseBriefingResponse(briefing(item('request', 'critical')))
    expect(parsed.todayItems).toHaveLength(0)
  })

  it('keeps the item but drops an off-site link target', () => {
    const parsed = parseBriefingResponse(briefing(item('request', 'low', 'https://evil.example')))
    expect(parsed.todayItems).toHaveLength(1)
    expect(parsed.todayItems[0].href).toBeUndefined()
  })

  it('keeps the good items in a mixed batch', () => {
    const parsed = parseBriefingResponse(
      briefing(item('request', 'low') + item('nonsense', 'low') + item('capacity', 'medium')),
    )
    expect(parsed.todayItems.map(i => i.category)).toEqual(['request', 'capacity'])
  })

  it('falls back to a placeholder summary when the model omits one', () => {
    expect(parseBriefingResponse('nothing useful').summary).toBe('No briefing available')
  })
})
