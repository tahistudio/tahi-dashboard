import { describe, it, expect } from 'vitest'
import { normaliseScanResult, parseStoredScan, SCAN_CAPS } from '@/lib/qa/normalise-scan'

describe('normaliseScanResult', () => {
  it('returns a full empty shape for non-objects', () => {
    for (const input of [null, undefined, 'x', 5, [], true]) {
      const out = normaliseScanResult(input)
      expect(out.a11y).toEqual([])
      expect(out.links).toEqual([])
      expect(out.missingAnchors).toEqual([])
      expect(out.seo.og).toEqual({ title: null, description: null, image: null, url: null })
      expect(out.perf).toEqual({ images: [], totalTransferSize: 0 })
      expect(out.layout).toEqual({ horizontalOverflow: false, overflowingElements: [] })
      expect(out.content).toEqual({ imagesMissingAlt: [], stagingLeftovers: [], forms: [] })
    }
  })

  it('coerces the hostile example payload', () => {
    const out = normaliseScanResult({ seo: {}, perf: {}, a11y: 'x', links: [{ url: 5 }] })
    expect(out.a11y).toEqual([])
    expect(out.links).toEqual([{ url: '', text: '', selector: '' }])
    expect(out.seo.title).toBeNull()
    expect(out.seo.headingOutline).toEqual([])
    expect(out.seo.h1Count).toBe(0)
    expect(out.perf.images).toEqual([])
  })

  it('keeps valid values and restricts impact', () => {
    const out = normaliseScanResult({
      a11y: [
        { id: 'a', impact: 'critical', help: 'h', helpUrl: 'u', nodes: [{ selector: 's', html: '<b>' }] },
        { id: 'b', impact: 'catastrophic', nodes: 'x' },
      ],
      seo: { title: 'T', og: { title: 'O' }, h1Count: 2 },
      perf: { images: [{ src: 'a.png', naturalWidth: 10, oversized: true, format: 'png' }], totalTransferSize: 5 },
    })
    expect(out.a11y[0].impact).toBe('critical')
    expect(out.a11y[0].nodes).toEqual([{ selector: 's', html: '<b>' }])
    expect(out.a11y[1].impact).toBeNull()
    expect(out.a11y[1].nodes).toEqual([])
    expect(out.seo.title).toBe('T')
    expect(out.seo.og.title).toBe('O')
    expect(out.seo.h1Count).toBe(2)
    expect(out.perf.images[0]).toMatchObject({ src: 'a.png', naturalWidth: 10, oversized: true, renderedWidth: 0 })
  })

  it('makes numbers finite and strings capped', () => {
    const out = normaliseScanResult({
      seo: { h1Count: Infinity, title: 'x'.repeat(1000) },
      perf: { totalTransferSize: NaN, images: [{ transferSize: '9' }] },
      links: [{ url: 'u'.repeat(5000), text: 't'.repeat(500), selector: 's'.repeat(900) }],
    })
    expect(out.seo.h1Count).toBe(0)
    expect(out.seo.title).toHaveLength(SCAN_CAPS.text)
    expect(out.perf.totalTransferSize).toBe(0)
    expect(out.perf.images[0].transferSize).toBe(0)
    expect(out.links[0].url).toHaveLength(SCAN_CAPS.url)
    expect(out.links[0].text).toHaveLength(SCAN_CAPS.text)
    expect(out.links[0].selector).toHaveLength(SCAN_CAPS.selector)
  })

  it('caps array sizes', () => {
    const out = normaliseScanResult({
      links: Array.from({ length: 1500 }, () => ({ url: 'a' })),
      a11y: Array.from({ length: 150 }, () => ({ id: 'r', impact: 'minor', nodes: Array.from({ length: 50 }, () => ({})) })),
      perf: { images: Array.from({ length: 300 }, () => ({})) },
    })
    expect(out.links).toHaveLength(1000)
    expect(out.a11y).toHaveLength(100)
    expect(out.a11y[0].nodes).toHaveLength(20)
    expect(out.perf.images).toHaveLength(200)
  })
})

describe('parseStoredScan', () => {
  it('never throws on bad JSON or odd shapes', () => {
    expect(parseStoredScan('not json').links).toEqual([])
    expect(parseStoredScan('{"seo":{},"perf":{},"a11y":"x"}').a11y).toEqual([])
  })
})
