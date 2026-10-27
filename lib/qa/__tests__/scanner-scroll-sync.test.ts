// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://qa-view.example.com/v/tok/about"}
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { createScrollSync, parseScrollTo, type ScrollSync } from '../../../workers/qa-view/src/scanner/scroll-sync'
import type { QaScrollMessage } from '../types'

/*
 * The scroll relay runs inside the proxied client page. jsdom has no layout and no
 * scrolling, so scroll position, element boxes and the element under the probe line
 * are faked. Real scrolling across five frames is covered by the e2e spec.
 */

const syncs: ScrollSync[] = []
let rafQueue: FrameRequestCallback[] = []

function flushFrame(): void {
  const queue = rafQueue
  rafQueue = []
  for (const cb of queue) cb(0)
}

function setScroll(y: number): void {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true })
}

function setDocHeight(h: number): void {
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: h, configurable: true })
}

function place(el: Element, top: number, height: number): void {
  const rect = { x: 0, y: top, left: 0, top, width: 1000, height, right: 1000, bottom: top + height, toJSON: () => ({}) } as DOMRect
  el.getBoundingClientRect = () => rect
}

function stubHit(el: Element | null): void {
  document.elementsFromPoint = () => (el ? [el] : [])
}

function must<T extends Element = Element>(selector: string): T {
  const el = document.querySelector<T>(selector)
  if (!el) throw new Error(`missing ${selector}`)
  return el
}

function make(): { sync: ScrollSync; post: ReturnType<typeof vi.fn>; scrollTo: ReturnType<typeof vi.fn> } {
  const post = vi.fn()
  const scrollTo = vi.fn()
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo
  const sync = createScrollSync({ win: window, doc: document, post, pageUrl: () => 'https://client.example.com/about' })
  syncs.push(sync)
  return { sync, post, scrollTo }
}

function wheel(): void {
  window.dispatchEvent(new Event('wheel'))
}

function scroll(): void {
  window.dispatchEvent(new Event('scroll'))
}

beforeEach(() => {
  rafQueue = []
  window.requestAnimationFrame = (cb: FrameRequestCallback) => {
    rafQueue.push(cb)
    return rafQueue.length
  }
  window.cancelAnimationFrame = () => undefined
  setScroll(0)
  setDocHeight(2768)
})

afterEach(() => {
  for (const s of syncs.splice(0)) s.destroy()
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('user input gating', () => {
  it('stays silent until reporting is turned on', () => {
    const { post } = make()
    wheel()
    setScroll(300)
    scroll()
    flushFrame()
    expect(post).not.toHaveBeenCalled()
  })

  it('does not report a programmatic scroll', () => {
    const { sync, post } = make()
    sync.setReporting(true)
    sync.scrollTo({ anchor: null, ratio: 0.5 })
    setScroll(1000)
    scroll()
    flushFrame()
    expect(post).not.toHaveBeenCalled()
  })

  it('does not report the scroll a command causes even right after real input', () => {
    const { sync, post } = make()
    sync.setReporting(true)
    wheel()
    sync.scrollTo({ anchor: null, ratio: 0.5 })
    setScroll(1000)
    scroll()
    flushFrame()
    expect(post).not.toHaveBeenCalled()
  })

  it('reports a scroll that follows a wheel, once per frame', () => {
    document.body.innerHTML = '<main><p>x</p></main>'
    stubHit(null)
    const { sync, post } = make()
    sync.setReporting(true)
    wheel()
    setScroll(500)
    scroll()
    scroll()
    scroll()
    flushFrame()
    expect(post).toHaveBeenCalledTimes(1)
    const msg = post.mock.calls[0][0] as QaScrollMessage
    expect(msg.type).toBe('qa:scroll')
    expect(msg.version).toBe(1)
    expect(msg.url).toBe('https://client.example.com/about')
    expect(msg.anchor).toBeNull()
    expect(msg.ratio).toBeCloseTo(500 / 2000, 5)
  })

  it('reports for keys, touch and pointer input, not for unrelated keys', () => {
    stubHit(null)
    const { sync, post } = make()
    sync.setReporting(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    scroll()
    flushFrame()
    expect(post).not.toHaveBeenCalled()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown' }))
    scroll()
    flushFrame()
    expect(post).toHaveBeenCalledTimes(1)

    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 5000)
    window.dispatchEvent(new Event('touchmove'))
    scroll()
    flushFrame()
    expect(post).toHaveBeenCalledTimes(2)

    vi.setSystemTime(Date.now() + 5000)
    window.dispatchEvent(new Event('pointerdown'))
    scroll()
    flushFrame()
    expect(post).toHaveBeenCalledTimes(3)
  })

  it('treats a scroll long after the last input as not the user', () => {
    stubHit(null)
    vi.useFakeTimers({ toFake: ['Date'] })
    const { sync, post } = make()
    sync.setReporting(true)
    wheel()
    vi.setSystemTime(Date.now() + 601)
    scroll()
    flushFrame()
    expect(post).not.toHaveBeenCalled()
  })

  it('stops reporting when turned off again', () => {
    stubHit(null)
    const { sync, post } = make()
    sync.setReporting(true)
    sync.setReporting(false)
    wheel()
    scroll()
    flushFrame()
    expect(post).not.toHaveBeenCalled()
  })
})

describe('anchor selection', () => {
  it('walks up to the nearest section-like ancestor and measures the probe line through it', () => {
    document.body.innerHTML = '<div class="shell"><div><section class="hero"><div><p class="copy">hello</p></div></section></div></div>'
    const section = must('section')
    place(section, -200, 1000)
    stubHit(must('.copy'))
    const { sync, post } = make()
    sync.setReporting(true)
    wheel()
    setScroll(200)
    scroll()
    flushFrame()
    const msg = post.mock.calls[0][0] as QaScrollMessage
    expect(msg.anchor).not.toBeNull()
    expect(document.querySelector(msg.anchor?.selector ?? '')).toBe(section)
    // probe line is 15% of 768 = 115.2px; the section top is 200px above the viewport
    expect(msg.anchor?.frac).toBeCloseTo((115.2 + 200) / 1000, 4)
  })

  it('stops at an element with an id', () => {
    document.body.innerHTML = '<div class="shell"><div id="pricing"><div class="card"><span class="t">x</span></div></div></div>'
    const target = must('#pricing')
    place(target, 50, 400)
    stubHit(must('.t'))
    const { sync, post } = make()
    sync.setReporting(true)
    wheel()
    scroll()
    flushFrame()
    const msg = post.mock.calls[0][0] as QaScrollMessage
    expect(msg.anchor?.selector).toBe('#pricing')
  })

  it('falls back to the body child that holds the element, and clamps frac', () => {
    document.body.innerHTML = '<div class="wrap"><div><span class="t">x</span></div></div>'
    const wrap = must('.wrap')
    place(wrap, 300, 400)
    stubHit(must('.t'))
    const { sync, post } = make()
    sync.setReporting(true)
    wheel()
    scroll()
    flushFrame()
    const msg = post.mock.calls[0][0] as QaScrollMessage
    expect(document.querySelector(msg.anchor?.selector ?? '')).toBe(wrap)
    // the probe line (115.2) is above the element top (300): clamped to 0
    expect(msg.anchor?.frac).toBe(0)
  })

  it('has no anchor on the body, over the comment layer host, or for an empty box', () => {
    document.body.innerHTML = '<div data-qa-comment-layer=""><span class="pin">1</span></div><section class="s"></section>'
    const { sync, post } = make()
    sync.setReporting(true)

    stubHit(document.body)
    wheel()
    scroll()
    flushFrame()
    expect((post.mock.calls[0][0] as QaScrollMessage).anchor).toBeNull()

    stubHit(must('.pin'))
    wheel()
    scroll()
    flushFrame()
    expect((post.mock.calls[1][0] as QaScrollMessage).anchor).toBeNull()

    place(must('.s'), 0, 0)
    stubHit(must('.s'))
    wheel()
    scroll()
    flushFrame()
    expect((post.mock.calls[2][0] as QaScrollMessage).anchor).toBeNull()
  })
})

describe('fixed and sticky elements on the probe line', () => {
  it('skips a fixed header and anchors on the section behind it', () => {
    document.body.innerHTML = '<header class="bar" style="position: fixed"><nav class="menu"><a class="l">x</a></nav></header><section class="s"><p class="p">hi</p></section>'
    const section = must('.s')
    place(section, -100, 1000)
    document.elementsFromPoint = () => [must('.l'), must('.menu'), must('.bar'), must('.p'), section, document.body, document.documentElement]
    const { sync, post } = make()
    sync.setReporting(true)
    wheel()
    scroll()
    flushFrame()
    const msg = post.mock.calls[0][0] as QaScrollMessage
    expect(document.querySelector(msg.anchor?.selector ?? '')).toBe(section)
  })

  it('skips a sticky ancestor and reports no anchor when only fixed things are under the line', () => {
    document.body.innerHTML = '<div class="pop" style="position: sticky"><section class="inner"><p class="p">x</p></section></div>'
    document.elementsFromPoint = () => [must('.p'), must('.inner'), must('.pop'), document.body]
    const { sync, post } = make()
    sync.setReporting(true)
    wheel()
    scroll()
    flushFrame()
    const msg = post.mock.calls[0][0] as QaScrollMessage
    expect(msg.anchor).toBeNull()
    expect(msg.ratio).toBe(0)
  })
})

describe('a user scroll run', () => {
  it('keeps reporting while scroll events keep arriving, past the input window', () => {
    stubHit(null)
    vi.useFakeTimers({ toFake: ['Date'] })
    const { sync, post } = make()
    sync.setReporting(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }))
    scroll()
    flushFrame()
    expect(post).toHaveBeenCalledTimes(1)
    // smooth scrolling goes on well past 600ms, one event every 100ms
    for (let i = 2; i <= 12; i++) {
      vi.setSystemTime(Date.now() + 100)
      scroll()
      flushFrame()
      expect(post).toHaveBeenCalledTimes(i)
    }
    // a gap longer than the extension ends the run
    vi.setSystemTime(Date.now() + 400)
    scroll()
    flushFrame()
    expect(post).toHaveBeenCalledTimes(12)
  })

  it('is ended by a command, so the follower never reports its own scroll', () => {
    stubHit(null)
    vi.useFakeTimers({ toFake: ['Date'] })
    const { sync, post } = make()
    sync.setReporting(true)
    wheel()
    scroll()
    flushFrame()
    expect(post).toHaveBeenCalledTimes(1)
    vi.setSystemTime(Date.now() + 700)
    sync.scrollTo({ anchor: null, ratio: 0.5 })
    vi.setSystemTime(Date.now() + 50)
    scroll()
    flushFrame()
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('sends one trailing report on scrollend, but not after a command', () => {
    stubHit(null)
    vi.useFakeTimers({ toFake: ['Date'] })
    const { sync, post } = make()
    sync.setReporting(true)
    wheel()
    scroll()
    flushFrame()
    expect(post).toHaveBeenCalledTimes(1)
    vi.setSystemTime(Date.now() + 2000)
    setScroll(900)
    window.dispatchEvent(new Event('scrollend'))
    flushFrame()
    expect(post).toHaveBeenCalledTimes(2)
    expect((post.mock.calls[1][0] as QaScrollMessage).ratio).toBeCloseTo(900 / 2000, 5)
    window.dispatchEvent(new Event('scrollend'))
    flushFrame()
    expect(post).toHaveBeenCalledTimes(2)

    wheel()
    sync.scrollTo({ anchor: null, ratio: 0.5 })
    window.dispatchEvent(new Event('scrollend'))
    flushFrame()
    expect(post).toHaveBeenCalledTimes(2)
  })
})

describe('scrollTo', () => {
  it('scrolls so the probe line sits at the same fraction through the anchor', () => {
    document.body.innerHTML = '<section class="s"></section>'
    place(must('.s'), 500, 1000)
    setScroll(100)
    const { sync, scrollTo } = make()
    sync.scrollTo({ anchor: { selector: '.s', frac: 0.5 }, ratio: 0.1 })
    expect(scrollTo).toHaveBeenCalledTimes(1)
    const arg = scrollTo.mock.calls[0][0] as ScrollToOptions
    expect(arg.behavior).toBe('instant')
    // 100 (scrollY) + 500 (rect top) + 0.5 * 1000 - 115.2 (probe line)
    expect(arg.top).toBeCloseTo(984.8, 4)
  })

  it('falls back to the ratio when the anchor does not resolve', () => {
    const { sync, scrollTo } = make()
    sync.scrollTo({ anchor: { selector: '#missing', frac: 0.5 }, ratio: 0.5 })
    expect((scrollTo.mock.calls[0][0] as ScrollToOptions).top).toBeCloseTo(1000, 4)
  })

  it('falls back to the ratio for a bad selector or a box with no height', () => {
    document.body.innerHTML = '<section class="s"></section>'
    place(must('.s'), 0, 0)
    const { sync, scrollTo } = make()
    sync.scrollTo({ anchor: { selector: '.s', frac: 0.5 }, ratio: 0.25 })
    expect((scrollTo.mock.calls[0][0] as ScrollToOptions).top).toBeCloseTo(500, 4)
    sync.scrollTo({ anchor: { selector: '[[[', frac: 0.5 }, ratio: 0.75 })
    expect((scrollTo.mock.calls[1][0] as ScrollToOptions).top).toBeCloseTo(1500, 4)
  })

  it('uses the ratio when there is no anchor and skips a no-op scroll', () => {
    const { sync, scrollTo } = make()
    sync.scrollTo({ anchor: null, ratio: 1 })
    expect((scrollTo.mock.calls[0][0] as ScrollToOptions).top).toBe(2000)
    setScroll(2000)
    sync.scrollTo({ anchor: null, ratio: 1 })
    expect(scrollTo).toHaveBeenCalledTimes(1)
  })

  it('snaps to the very top and bottom even when an anchor resolves', () => {
    document.body.innerHTML = '<section class="s"></section>'
    place(must('.s'), 500, 1000)
    setScroll(700)
    const { sync, scrollTo } = make()
    sync.scrollTo({ anchor: { selector: '.s', frac: 0.5 }, ratio: 0 })
    expect((scrollTo.mock.calls[0][0] as ScrollToOptions).top).toBe(0)
    sync.scrollTo({ anchor: { selector: '.s', frac: 0.5 }, ratio: 0.9995 })
    expect((scrollTo.mock.calls[1][0] as ScrollToOptions).top).toBe(2000)
  })
})

describe('parseScrollTo', () => {
  it('accepts a good command and rejects malformed ones', () => {
    expect(parseScrollTo({ type: 'qa:scroll-to', anchor: null, ratio: 0.3 })).toEqual({ anchor: null, ratio: 0.3 })
    expect(parseScrollTo({ type: 'qa:scroll-to', anchor: { selector: '#a', frac: 1 }, ratio: 0 })).toEqual({ anchor: { selector: '#a', frac: 1 }, ratio: 0 })
    expect(parseScrollTo({ type: 'qa:scroll-to', anchor: null, ratio: 2 })).toBeNull()
    expect(parseScrollTo({ type: 'qa:scroll-to', anchor: null, ratio: Number.NaN })).toBeNull()
    expect(parseScrollTo({ type: 'qa:scroll-to', anchor: { selector: '', frac: 0.5 }, ratio: 0.1 })).toBeNull()
    expect(parseScrollTo({ type: 'qa:scroll-to', anchor: { selector: 'a'.repeat(1001), frac: 0.5 }, ratio: 0.1 })).toBeNull()
    expect(parseScrollTo({ type: 'qa:scroll-to', anchor: { selector: '#a', frac: -1 }, ratio: 0.1 })).toBeNull()
    expect(parseScrollTo({ type: 'qa:scroll-to', anchor: 'x', ratio: 0.1 })).toBeNull()
    expect(parseScrollTo({ type: 'qa:scroll-to', ratio: 0.1 })).toBeNull()
    expect(parseScrollTo({ type: 'other', anchor: null, ratio: 0.1 })).toBeNull()
    expect(parseScrollTo(null)).toBeNull()
  })
})

describe('scanner entry: message origin', () => {
  it('ignores qa:scroll-sync and qa:scroll-to from any origin but the token parent', async () => {
    const parentOrigin = 'https://dash.example.com'
    const body = btoa(JSON.stringify({ o: 'https://client.example.com', p: parentOrigin, exp: 9_999_999_999 }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    Object.defineProperty(document, 'currentScript', {
      value: { src: `https://qa-view.example.com/__qa/scanner.js?t=${body}.sig` },
      configurable: true,
    })
    const parentPost = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    const scrollTo = vi.fn()
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo
    stubHit(null)
    await import('../../../workers/qa-view/src/scanner/index')

    const send = (origin: string, data: unknown) => window.dispatchEvent(new MessageEvent('message', { origin, data }))

    // A foreign origin cannot turn reporting on or move the page.
    send('https://evil.example.com', { type: 'qa:scroll-sync', on: true })
    send('https://evil.example.com', { type: 'qa:scroll-to', anchor: null, ratio: 0.5 })
    wheel()
    scroll()
    flushFrame()
    expect(scrollTo).not.toHaveBeenCalled()
    expect(parentPost).not.toHaveBeenCalled()

    // The parent origin can; reports go to that origin only.
    send(parentOrigin, { type: 'qa:scroll-sync', on: true })
    wheel()
    setScroll(400)
    scroll()
    flushFrame()
    expect(parentPost).toHaveBeenCalledTimes(1)
    expect(parentPost.mock.calls[0][1]).toBe(parentOrigin)
    expect((parentPost.mock.calls[0][0] as QaScrollMessage).type).toBe('qa:scroll')

    send(parentOrigin, { type: 'qa:scroll-to', anchor: null, ratio: 0.5 })
    expect(scrollTo).toHaveBeenCalledTimes(1)
    // A malformed command from the right origin does nothing.
    send(parentOrigin, { type: 'qa:scroll-to', anchor: null, ratio: 9 })
    expect(scrollTo).toHaveBeenCalledTimes(1)
    parentPost.mockRestore()
  })
})
