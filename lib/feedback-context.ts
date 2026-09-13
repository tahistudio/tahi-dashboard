/**
 * lib/feedback-context.ts
 *
 * A tiny always-on recorder for the beta feedback ball
 * (components/tahi/feedback-ball.tsx). Installed once at mount, it keeps two
 * ring buffers (console errors/warnings, failed fetches) capped at 20 entries
 * each, and exposes a pure snapshot function the ball calls at send time.
 *
 * MUST NEVER THROW. A broken recorder must never break the page it is
 * quietly watching, so every public entry point here is wrapped in its own
 * try/catch and fails to "recorded nothing" rather than propagating.
 *
 * Safe to import on the server: every DOM-touching function guards on
 * `typeof window === 'undefined'` / `typeof document === 'undefined'` before
 * touching a global, so this module no-ops rather than throwing when there is
 * no browser (SSR, or a plain Node test with no window/document faked in).
 */

export interface ConsoleEntry {
  level: 'error' | 'warn'
  message: string
  timestamp: string
}

export interface FailedFetchEntry {
  method: string
  url: string
  status: number
  timestamp: string
}

export interface ImpersonationState {
  active: boolean
  mode: 'view' | 'act' | null
  orgId: string | null
}

export interface FeedbackContextSnapshot {
  consoleErrors: ConsoleEntry[]
  failedFetches: FailedFetchEntry[]
  headings: string[]
  impersonation: ImpersonationState | null
}

const RING_LIMIT = 20
const MAX_HEADINGS = 20
/** The same cookies <ImpersonationBanner> reads/writes; see lib/preview-cookie.ts. */
const IMPERSONATE_ORG_COOKIE = 'tahi-impersonate-org'
const IMPERSONATE_MODE_COOKIE = 'tahi-impersonate-mode'

let consoleBuffer: ConsoleEntry[] = []
let fetchBuffer: FailedFetchEntry[] = []
let installed = false

/**
 * Push onto a ring buffer capped at `max`, evicting the OLDEST entries first.
 * Pure and total: never throws, never exceeds the cap.
 */
export function pushCapped<T>(buffer: T[], entry: T, max: number = RING_LIMIT): T[] {
  const next = buffer.concat([entry])
  return next.length > max ? next.slice(next.length - max) : next
}

/** Best-effort, bounded stringification of a console call's arguments. */
function safeMessage(args: unknown[]): string {
  try {
    const parts = args.map((a) => {
      if (typeof a === 'string') return a
      if (a instanceof Error) return a.message || a.name || 'Error'
      try {
        return JSON.stringify(a)
      } catch {
        return String(a)
      }
    })
    return parts.join(' ').slice(0, 2000)
  } catch {
    return '[unserializable console message]'
  }
}

/** Test-only: reset both ring buffers and the installed flag. */
export function resetFeedbackRecorderForTests(): void {
  consoleBuffer = []
  fetchBuffer = []
  installed = false
}

/** Record one console.error / console.warn call. Never throws. */
export function recordConsoleEntry(level: 'error' | 'warn', args: unknown[]): void {
  try {
    consoleBuffer = pushCapped(consoleBuffer, {
      level,
      message: safeMessage(args),
      timestamp: new Date().toISOString(),
    })
  } catch {
    // never throw from the recorder
  }
}

/** Record one non-2xx (or network-failed, status 0) fetch response. Never throws. */
export function recordFailedFetch(method: string, url: string, status: number): void {
  try {
    fetchBuffer = pushCapped(fetchBuffer, {
      method: method || 'GET',
      url,
      status,
      timestamp: new Date().toISOString(),
    })
  } catch {
    // never throw
  }
}

/** The method name off a fetch() input, defaulting to GET. Never throws. */
function methodFromFetchArgs(input: RequestInfo | URL, init: RequestInit | undefined): string {
  try {
    if (init?.method) return init.method.toUpperCase()
    if (typeof Request !== 'undefined' && input instanceof Request) return input.method.toUpperCase()
    return 'GET'
  } catch {
    return 'GET'
  }
}

/** The url string off a fetch() input. Never throws. */
function urlFromFetchArgs(input: RequestInfo | URL): string {
  try {
    if (typeof input === 'string') return input
    if (input instanceof URL) return input.toString()
    if (typeof Request !== 'undefined' && input instanceof Request) return input.url
    return String(input)
  } catch {
    return '[unknown url]'
  }
}

/**
 * Install the global recorder once: wraps console.error/warn, listens for
 * window `error` / `unhandledrejection`, and wraps fetch to catch non-2xx
 * responses. Idempotent and a no-op outside a browser (SSR, plain Node).
 */
export function installFeedbackContextRecorder(): void {
  if (installed) return
  if (typeof window === 'undefined') return

  const flagged = window as unknown as { __tahiFeedbackRecorderInstalled?: boolean }
  if (flagged.__tahiFeedbackRecorderInstalled) {
    installed = true
    return
  }
  flagged.__tahiFeedbackRecorderInstalled = true
  installed = true

  try {
    const originalError = console.error.bind(console)
    console.error = (...args: unknown[]) => {
      recordConsoleEntry('error', args)
      originalError(...args)
    }
  } catch {
    // never throw
  }

  try {
    const originalWarn = console.warn.bind(console)
    console.warn = (...args: unknown[]) => {
      recordConsoleEntry('warn', args)
      originalWarn(...args)
    }
  } catch {
    // never throw
  }

  try {
    window.addEventListener('error', (event: ErrorEvent) => {
      try {
        recordConsoleEntry('error', [event?.message || 'Uncaught error'])
      } catch {
        // never throw
      }
    })
  } catch {
    // never throw
  }

  try {
    window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
      try {
        const reason = event?.reason
        recordConsoleEntry('error', [reason instanceof Error ? reason.message : String(reason)])
      } catch {
        // never throw
      }
    })
  } catch {
    // never throw
  }

  try {
    const originalFetch = window.fetch.bind(window)
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = methodFromFetchArgs(input, init)
      const url = urlFromFetchArgs(input)
      let response: Response
      try {
        response = await originalFetch(input, init)
      } catch (err) {
        // A network-level failure never even reached a status code. Record it
        // as status 0 (never a real HTTP status) and rethrow unchanged: the
        // recorder observes, it never swallows the caller's own error.
        recordFailedFetch(method, url, 0)
        throw err
      }
      try {
        if (!response.ok) recordFailedFetch(method, url, response.status)
      } catch {
        // never throw
      }
      return response
    }) as typeof window.fetch
  } catch {
    // never throw
  }
}

/** The visible heading text on the page, capped and trimmed. Never throws. */
function readHeadings(): string[] {
  try {
    if (typeof document === 'undefined') return []
    const nodes = Array.from(document.querySelectorAll('h1, h2, h3'))
    const texts: string[] = []
    for (const node of nodes) {
      const text = (node.textContent || '').trim()
      if (text) texts.push(text)
      if (texts.length >= MAX_HEADINGS) break
    }
    return texts
  } catch {
    return []
  }
}

/** One cookie's decoded value, or null. Never throws. */
function readCookie(name: string): string | null {
  try {
    if (typeof document === 'undefined' || !document.cookie) return null
    const prefix = `${name}=`
    for (const part of document.cookie.split(';')) {
      const trimmed = part.trim()
      if (trimmed.startsWith(prefix)) {
        const raw = trimmed.slice(prefix.length)
        try {
          return decodeURIComponent(raw)
        } catch {
          return raw
        }
      }
    }
    return null
  } catch {
    return null
  }
}

/** Client view / Act as client state, from the same cookies the banner uses. Never throws. */
function readImpersonationState(): ImpersonationState | null {
  try {
    const orgId = readCookie(IMPERSONATE_ORG_COOKIE)
    if (!orgId) return null
    const mode = readCookie(IMPERSONATE_MODE_COOKIE)
    return { active: true, mode: mode === 'act' ? 'act' : 'view', orgId }
  } catch {
    return null
  }
}

/** The context blob the ball POSTs alongside the comment body. Never throws. */
export function getFeedbackContextSnapshot(): FeedbackContextSnapshot {
  return {
    consoleErrors: [...consoleBuffer],
    failedFetches: [...fetchBuffer],
    headings: readHeadings(),
    impersonation: readImpersonationState(),
  }
}
