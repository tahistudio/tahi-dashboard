import { describe, expect, it } from 'vitest'
import { createRelayQueue, parseScrollMessage, relayTargets, scrollToFor, syncActive } from '../scroll-helpers'

const good = { type: 'qa:scroll', version: 1, url: 'https://x.test/about', anchor: { selector: '#hero', frac: 0.4 }, ratio: 0.2 }

describe('parseScrollMessage', () => {
  it('accepts a good message with or without an anchor', () => {
    expect(parseScrollMessage(good)).toEqual(good)
    expect(parseScrollMessage({ ...good, anchor: null })).toEqual({ ...good, anchor: null })
    expect(parseScrollMessage({ ...good, ratio: 0, anchor: { selector: '#a', frac: 1 } })?.ratio).toBe(0)
  })

  it('drops extra fields', () => {
    expect(parseScrollMessage({ ...good, extra: 1 })).toEqual(good)
  })

  it('rejects wrong type, version, url, ratio and anchor shapes', () => {
    expect(parseScrollMessage(null)).toBeNull()
    expect(parseScrollMessage('qa:scroll')).toBeNull()
    expect(parseScrollMessage({ ...good, type: 'qa:scan' })).toBeNull()
    expect(parseScrollMessage({ ...good, version: 2 })).toBeNull()
    expect(parseScrollMessage({ ...good, url: '' })).toBeNull()
    expect(parseScrollMessage({ ...good, url: 3 })).toBeNull()
    expect(parseScrollMessage({ ...good, ratio: -0.1 })).toBeNull()
    expect(parseScrollMessage({ ...good, ratio: 1.1 })).toBeNull()
    expect(parseScrollMessage({ ...good, ratio: Number.POSITIVE_INFINITY })).toBeNull()
    expect(parseScrollMessage({ ...good, ratio: '0.2' })).toBeNull()
    expect(parseScrollMessage({ ...good, anchor: undefined })).toBeNull()
    expect(parseScrollMessage({ ...good, anchor: 'x' })).toBeNull()
    expect(parseScrollMessage({ ...good, anchor: { selector: '', frac: 0.4 } })).toBeNull()
    expect(parseScrollMessage({ ...good, anchor: { selector: 'a'.repeat(1001), frac: 0.4 } })).toBeNull()
    expect(parseScrollMessage({ ...good, anchor: { selector: 'a'.repeat(1000), frac: 0.4 } })).not.toBeNull()
    expect(parseScrollMessage({ ...good, anchor: { selector: '#a', frac: Number.NaN } })).toBeNull()
    expect(parseScrollMessage({ ...good, anchor: { selector: '#a', frac: 2 } })).toBeNull()
  })
})

describe('scrollToFor', () => {
  it('turns a report into a command', () => {
    const msg = parseScrollMessage(good)
    expect(msg && scrollToFor(msg)).toEqual({ type: 'qa:scroll-to', anchor: good.anchor, ratio: good.ratio })
  })
})

describe('relayTargets', () => {
  it('goes to every other visible frame and never back to the sender', () => {
    expect(relayTargets(['xl', 'desktop', 'tablet', 'mobile_l', 'mobile_p'], 'desktop')).toEqual(['xl', 'tablet', 'mobile_l', 'mobile_p'])
    expect(relayTargets(['desktop', 'tablet'], 'tablet')).toEqual(['desktop'])
    expect(relayTargets(['desktop'], 'desktop')).toEqual([])
  })
})

describe('createRelayQueue', () => {
  function harness() {
    const calls: [string, number][] = []
    const frames: (() => void)[] = []
    const cancelled: number[] = []
    const queue = createRelayQueue<number>(
      (sender, n) => calls.push([sender, n]),
      cb => { frames.push(cb); return frames.length },
      id => { cancelled.push(id) },
    )
    const frame = () => { const f = frames.splice(0); for (const cb of f) cb() }
    return { queue, calls, frame, frames, cancelled }
  }

  it('relays only the newest report from a sender, on the next frame', () => {
    const { queue, calls, frame, frames } = harness()
    queue.push('desktop', 0.1)
    queue.push('desktop', 0.4)
    expect(calls).toEqual([])
    expect(frames).toHaveLength(1)
    frame()
    expect(calls).toEqual([['desktop', 0.4]])
    frame()
    expect(calls).toHaveLength(1)
  })

  it('keeps one report per sender and schedules again after a flush', () => {
    const { queue, calls, frame } = harness()
    queue.push('desktop', 0.2)
    queue.push('tablet', 0.7)
    frame()
    expect(calls).toEqual([['desktop', 0.2], ['tablet', 0.7]])
    queue.push('desktop', 0.9)
    frame()
    expect(calls[2]).toEqual(['desktop', 0.9])
  })

  it('clear drops pending reports and cancels the frame', () => {
    const { queue, calls, frame, cancelled } = harness()
    queue.push('xl', 0.5)
    queue.clear()
    frame()
    expect(calls).toEqual([])
    expect(cancelled).toEqual([1])
  })
})

describe('syncActive', () => {
  it('needs the toggle on, the multi-frame layout and no expanded frame', () => {
    expect(syncActive(true, false, null)).toBe(true)
    expect(syncActive(false, false, null)).toBe(false)
    expect(syncActive(true, true, null)).toBe(false)
    expect(syncActive(true, false, 'desktop')).toBe(false)
  })
})
