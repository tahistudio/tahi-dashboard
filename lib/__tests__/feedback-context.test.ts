/**
 * lib/feedback-context.ts, the beta feedback ball's always-on recorder.
 * Ring buffers, non-2xx fetch capture, and "never throws" even with no real
 * DOM (this suite runs under Node, not jsdom; window/document are faked in
 * by hand where a test needs them).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  pushCapped,
  recordConsoleEntry,
  recordFailedFetch,
  getFeedbackContextSnapshot,
  resetFeedbackRecorderForTests,
  installFeedbackContextRecorder,
} from '@/lib/feedback-context'

describe('pushCapped', () => {
  it('never exceeds the cap', () => {
    let buf: number[] = []
    for (let i = 0; i < 25; i++) buf = pushCapped(buf, i, 20)
    expect(buf).toHaveLength(20)
  })

  it('evicts the oldest entries first', () => {
    let buf: number[] = []
    for (let i = 0; i < 25; i++) buf = pushCapped(buf, i, 20)
    expect(buf[0]).toBe(5)
    expect(buf[19]).toBe(24)
  })

  it('is a no-op growth under the cap', () => {
    let buf: number[] = []
    buf = pushCapped(buf, 1, 20)
    buf = pushCapped(buf, 2, 20)
    expect(buf).toEqual([1, 2])
  })
})

describe('recordConsoleEntry / recordFailedFetch (buffer behaviour)', () => {
  beforeEach(() => resetFeedbackRecorderForTests())

  it('keeps a ring buffer of 20 console entries', () => {
    for (let i = 0; i < 25; i++) recordConsoleEntry('error', [`err ${i}`])
    const snap = getFeedbackContextSnapshot()
    expect(snap.consoleErrors).toHaveLength(20)
    expect(snap.consoleErrors[0].message).toBe('err 5')
    expect(snap.consoleErrors[19].message).toBe('err 24')
  })

  it('records both error and warn levels', () => {
    recordConsoleEntry('error', ['boom'])
    recordConsoleEntry('warn', ['careful'])
    const snap = getFeedbackContextSnapshot()
    expect(snap.consoleErrors.map((e) => e.level)).toEqual(['error', 'warn'])
  })

  it('stamps each entry with an ISO timestamp', () => {
    recordConsoleEntry('error', ['boom'])
    const [entry] = getFeedbackContextSnapshot().consoleErrors
    expect(() => new Date(entry.timestamp).toISOString()).not.toThrow()
  })

  it('never throws on a circular argument', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => recordConsoleEntry('error', [circular])).not.toThrow()
    expect(getFeedbackContextSnapshot().consoleErrors).toHaveLength(1)
  })

  it('never throws on an argument whose toString throws', () => {
    const hostile = {
      toString() {
        throw new Error('nope')
      },
    }
    expect(() => recordConsoleEntry('error', [hostile])).not.toThrow()
  })

  it('extracts a message from an Error instance', () => {
    recordConsoleEntry('error', [new Error('kaboom')])
    expect(getFeedbackContextSnapshot().consoleErrors[0].message).toContain('kaboom')
  })

  it('keeps a ring buffer of 20 failed fetches', () => {
    for (let i = 0; i < 25; i++) recordFailedFetch('GET', `/api/thing/${i}`, 500)
    const snap = getFeedbackContextSnapshot()
    expect(snap.failedFetches).toHaveLength(20)
    expect(snap.failedFetches[0].url).toBe('/api/thing/5')
  })

  it('records method, url and status on a failed fetch', () => {
    recordFailedFetch('POST', '/api/admin/requests', 500)
    expect(getFeedbackContextSnapshot().failedFetches).toEqual([
      expect.objectContaining({ method: 'POST', url: '/api/admin/requests', status: 500 }),
    ])
  })
})

describe('installFeedbackContextRecorder', () => {
  const originalConsoleError = console.error
  const originalConsoleWarn = console.warn

  beforeEach(() => {
    resetFeedbackRecorderForTests()
  })

  afterEach(() => {
    resetFeedbackRecorderForTests()
    console.error = originalConsoleError
    console.warn = originalConsoleWarn
    delete (globalThis as Record<string, unknown>).window
    delete (globalThis as Record<string, unknown>).document
  })

  it('no-ops outside a browser and never throws', () => {
    expect(() => installFeedbackContextRecorder()).not.toThrow()
    expect(getFeedbackContextSnapshot()).toEqual({
      consoleErrors: [],
      failedFetches: [],
      headings: [],
      impersonation: null,
    })
  })

  it('is idempotent: calling it twice does not double-wrap fetch', async () => {
    const calls: string[] = []
    const fakeWindow = {
      __tahiFeedbackRecorderInstalled: undefined as boolean | undefined,
      fetch: async () => {
        calls.push('fetch')
        return { ok: false, status: 404 } as Response
      },
      addEventListener: () => {},
    }
    ;(globalThis as unknown as { window: unknown }).window = fakeWindow
    ;(globalThis as unknown as { document: unknown }).document = { cookie: '', querySelectorAll: () => [] }

    installFeedbackContextRecorder()
    installFeedbackContextRecorder()
    await (window as unknown as { fetch: typeof fetch }).fetch('/api/thing')

    expect(calls).toHaveLength(1)
    expect(getFeedbackContextSnapshot().failedFetches).toHaveLength(1)
  })

  it('records a non-2xx fetch response without throwing, and returns it unchanged', async () => {
    const fakeResponse = { ok: false, status: 404 } as Response
    const fakeWindow = {
      fetch: async () => fakeResponse,
      addEventListener: () => {},
    }
    ;(globalThis as unknown as { window: unknown }).window = fakeWindow
    ;(globalThis as unknown as { document: unknown }).document = { cookie: '', querySelectorAll: () => [] }

    installFeedbackContextRecorder()
    const result = await (window as unknown as { fetch: typeof fetch }).fetch('/api/things', { method: 'GET' })

    expect(result).toBe(fakeResponse)
    expect(getFeedbackContextSnapshot().failedFetches).toEqual([
      expect.objectContaining({ method: 'GET', url: '/api/things', status: 404 }),
    ])
  })

  it('does not record a successful (2xx) fetch', async () => {
    const fakeWindow = {
      fetch: async () => ({ ok: true, status: 200 } as Response),
      addEventListener: () => {},
    }
    ;(globalThis as unknown as { window: unknown }).window = fakeWindow
    ;(globalThis as unknown as { document: unknown }).document = { cookie: '', querySelectorAll: () => [] }

    installFeedbackContextRecorder()
    await (window as unknown as { fetch: typeof fetch }).fetch('/api/things')

    expect(getFeedbackContextSnapshot().failedFetches).toHaveLength(0)
  })

  it('records a network-level failure as status 0 and still rethrows to the caller', async () => {
    const networkError = new Error('network down')
    const fakeWindow = {
      fetch: async () => {
        throw networkError
      },
      addEventListener: () => {},
    }
    ;(globalThis as unknown as { window: unknown }).window = fakeWindow
    ;(globalThis as unknown as { document: unknown }).document = { cookie: '', querySelectorAll: () => [] }

    installFeedbackContextRecorder()
    await expect((window as unknown as { fetch: typeof fetch }).fetch('/api/things')).rejects.toThrow('network down')
    expect(getFeedbackContextSnapshot().failedFetches).toEqual([
      expect.objectContaining({ url: '/api/things', status: 0 }),
    ])
  })

  it('reads visible headings from document.querySelectorAll', () => {
    const fakeWindow = { fetch: async () => ({ ok: true } as Response), addEventListener: () => {} }
    ;(globalThis as unknown as { window: unknown }).window = fakeWindow
    ;(globalThis as unknown as { document: unknown }).document = {
      cookie: '',
      querySelectorAll: (sel: string) =>
        sel === 'h1, h2, h3' ? [{ textContent: ' Overview ' }, { textContent: 'Requests' }, { textContent: '   ' }] : [],
    }

    installFeedbackContextRecorder()
    expect(getFeedbackContextSnapshot().headings).toEqual(['Overview', 'Requests'])
  })

  it('reports impersonation state from the preview cookies', () => {
    const fakeWindow = { fetch: async () => ({ ok: true } as Response), addEventListener: () => {} }
    ;(globalThis as unknown as { window: unknown }).window = fakeWindow
    ;(globalThis as unknown as { document: unknown }).document = {
      cookie: 'tahi-impersonate-org=org_123; tahi-impersonate-mode=act',
      querySelectorAll: () => [],
    }

    installFeedbackContextRecorder()
    expect(getFeedbackContextSnapshot().impersonation).toEqual({ active: true, mode: 'act', orgId: 'org_123' })
  })

  it('reports no impersonation when the org cookie is absent', () => {
    const fakeWindow = { fetch: async () => ({ ok: true } as Response), addEventListener: () => {} }
    ;(globalThis as unknown as { window: unknown }).window = fakeWindow
    ;(globalThis as unknown as { document: unknown }).document = { cookie: '', querySelectorAll: () => [] }

    installFeedbackContextRecorder()
    expect(getFeedbackContextSnapshot().impersonation).toBeNull()
  })
})
