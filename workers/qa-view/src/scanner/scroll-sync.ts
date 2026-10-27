import type { QaScrollAnchor, QaScrollMessage, QaScrollToMessage } from '../../../../lib/qa/types'
import { SELECTOR_MAX, uniqueSelector } from './selector'

export interface ScrollSyncOptions {
  win: Window
  doc: Document
  post: (msg: QaScrollMessage) => void
  pageUrl: () => string
}

export interface ScrollSync {
  /** Turns reporting of user scrolls on or off. Off until the dashboard says otherwise. */
  setReporting(on: boolean): void
  /** Scrolls to the anchor (or the ratio when the anchor does not resolve). Never reported back. */
  scrollTo(target: Pick<QaScrollToMessage, 'anchor' | 'ratio'>): void
  /** Removes the listeners. Pages never call this; tests do. */
  destroy(): void
}

/** A scroll counts as the user's when it follows real input within this many milliseconds. */
export const USER_INPUT_WINDOW_MS = 600
/** Longest a held pointer keeps counting as user input. */
const POINTER_HOLD_MAX_MS = 10_000
/** A user-started scroll run (smooth Home/End, touch momentum, Lenis) lasts while scroll events keep arriving within this many milliseconds. */
export const RUN_EXTEND_MS = 150
/** The probe line sits this fraction of the viewport height below the top. */
export const PROBE_FRACTION = 0.15

const HOST_ATTR = 'data-qa-comment-layer'
const SECTION_TAGS = new Set(['section', 'header', 'footer', 'main', 'article', 'nav'])
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', ' ', 'Spacebar', 'Home', 'End'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFraction(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

/** Validates the fields of a qa:scroll-to message. Returns null when any field is wrong. */
export function parseScrollTo(data: unknown): Pick<QaScrollToMessage, 'anchor' | 'ratio'> | null {
  if (!isRecord(data) || data.type !== 'qa:scroll-to') return null
  if (!isFraction(data.ratio)) return null
  const raw = data.anchor
  if (raw === null) return { anchor: null, ratio: data.ratio }
  if (!isRecord(raw)) return null
  const { selector, frac } = raw
  if (typeof selector !== 'string' || selector.length === 0 || selector.length > SELECTOR_MAX) return null
  if (!isFraction(frac)) return null
  return { anchor: { selector, frac }, ratio: data.ratio }
}

export function createScrollSync(opts: ScrollSyncOptions): ScrollSync {
  const { win, doc, post, pageUrl } = opts

  let reporting = false
  let lastInputAt = 0
  let pointerDownAt = 0
  let rafId: number | null = null
  // A run of scroll events that began from user input and has not been ended by a command.
  let runUntil = 0
  let runFromUser = false

  function userInput(): void {
    lastInputAt = Date.now()
  }

  function onKeyInput(e: KeyboardEvent): void {
    if (SCROLL_KEYS.has(e.key)) userInput()
  }

  function onPointerDown(): void {
    pointerDownAt = Date.now()
    userInput()
  }

  function onPointerEnd(): void {
    pointerDownAt = 0
    userInput()
  }

  function userIsScrolling(): boolean {
    const now = Date.now()
    // A held pointer (scrollbar drag) keeps the scroll the user's; a pointerup lost outside the frame stops counting after a while.
    if (pointerDownAt > 0 && now - pointerDownAt <= POINTER_HOLD_MAX_MS) return true
    return now - lastInputAt <= USER_INPUT_WINDOW_MS
  }

  function probeY(): number {
    return win.innerHeight * PROBE_FRACTION
  }

  function sectionAncestor(start: Element): Element | null {
    const body = doc.body
    let node: Element | null = start
    let bodyChild: Element | null = null
    while (node && node !== body && node !== doc.documentElement) {
      if (node.parentElement === body) bodyChild = node
      if (SECTION_TAGS.has(node.localName) || node.id) return node
      node = node.parentElement
    }
    return bodyChild
  }

  /** True for the comment layer and for anything inside a fixed or sticky box, whose position does not follow the scroll. */
  function ignoredHit(el: Element): boolean {
    if (el.hasAttribute(HOST_ATTR) || el.closest(`[${HOST_ATTR}]`)) return true
    let node: Element | null = el
    while (node && node !== doc.body && node !== doc.documentElement) {
      const position = win.getComputedStyle(node).position
      if (position === 'fixed' || position === 'sticky') return true
      node = node.parentElement
    }
    return false
  }

  function computeAnchor(): QaScrollAnchor | null {
    if (typeof doc.elementsFromPoint !== 'function') return null
    const y = probeY()
    const hit = doc.elementsFromPoint(win.innerWidth / 2, y).find(el => !ignoredHit(el))
    if (!hit) return null
    const section = sectionAncestor(hit)
    if (!section) return null
    const rect = section.getBoundingClientRect()
    if (rect.height <= 0) return null
    return { selector: uniqueSelector(section, doc), frac: clamp01((y - rect.top) / rect.height) }
  }

  function maxScroll(): number {
    return Math.max(1, doc.documentElement.scrollHeight - win.innerHeight)
  }

  function report(): void {
    rafId = null
    if (!reporting) return
    const msg: QaScrollMessage = {
      type: 'qa:scroll',
      version: 1,
      url: pageUrl(),
      anchor: computeAnchor(),
      ratio: clamp01(win.scrollY / maxScroll()),
    }
    post(msg)
  }

  function schedule(): void {
    if (rafId !== null) return
    if (typeof win.requestAnimationFrame === 'function') rafId = win.requestAnimationFrame(report)
    else rafId = win.setTimeout(report, 16)
  }

  function onScroll(): void {
    if (!reporting) return
    const now = Date.now()
    if (userIsScrolling()) {
      runFromUser = true
      runUntil = now + RUN_EXTEND_MS
    } else if (runFromUser && now <= runUntil) {
      runUntil = now + RUN_EXTEND_MS
    } else {
      return
    }
    schedule()
  }

  // Where supported, one last report when a user-started scroll settles, so followers land exactly.
  function onScrollEnd(): void {
    if (!reporting || !runFromUser) return
    runFromUser = false
    runUntil = 0
    if (rafId !== null && typeof win.cancelAnimationFrame === 'function') {
      win.cancelAnimationFrame(rafId)
      rafId = null
    }
    schedule()
  }

  function setReporting(on: boolean): void {
    reporting = on
  }

  function resolve(selector: string): Element | null {
    try {
      return doc.querySelector(selector)
    } catch {
      return null
    }
  }

  function scrollTo(target: Pick<QaScrollToMessage, 'anchor' | 'ratio'>): void {
    // Whatever scroll events this causes belong to the dashboard, not the user.
    lastInputAt = 0
    pointerDownAt = 0
    runUntil = 0
    runFromUser = false
    const maxTop = Math.max(0, doc.documentElement.scrollHeight - win.innerHeight)
    let top: number | null = null
    // The very top and bottom snap exactly, so footers and heroes line up across frames.
    if (target.ratio <= 0.001) top = 0
    else if (target.ratio >= 0.999) top = maxTop
    else if (target.anchor) {
      const el = resolve(target.anchor.selector)
      if (el) {
        const rect = el.getBoundingClientRect()
        if (rect.height > 0) top = win.scrollY + rect.top + target.anchor.frac * rect.height - probeY()
      }
    }
    if (top === null) top = clamp01(target.ratio) * Math.max(0, doc.documentElement.scrollHeight - win.innerHeight)
    top = Math.max(0, top)
    if (Math.abs(top - win.scrollY) < 1) return
    win.scrollTo({ top, behavior: 'instant' })
  }

  const passive = { capture: true, passive: true } as const
  win.addEventListener('wheel', userInput, passive)
  win.addEventListener('touchstart', userInput, passive)
  win.addEventListener('touchmove', userInput, passive)
  win.addEventListener('touchend', userInput, passive)
  win.addEventListener('keydown', onKeyInput, true)
  win.addEventListener('pointerdown', onPointerDown, true)
  win.addEventListener('pointerup', onPointerEnd, true)
  win.addEventListener('pointercancel', onPointerEnd, true)
  win.addEventListener('scroll', onScroll, { passive: true })
  win.addEventListener('scrollend', onScrollEnd)

  function destroy(): void {
    win.removeEventListener('wheel', userInput, true)
    win.removeEventListener('touchstart', userInput, true)
    win.removeEventListener('touchmove', userInput, true)
    win.removeEventListener('touchend', userInput, true)
    win.removeEventListener('keydown', onKeyInput, true)
    win.removeEventListener('pointerdown', onPointerDown, true)
    win.removeEventListener('pointerup', onPointerEnd, true)
    win.removeEventListener('pointercancel', onPointerEnd, true)
    win.removeEventListener('scroll', onScroll)
    win.removeEventListener('scrollend', onScrollEnd)
    if (rafId !== null) {
      if (typeof win.cancelAnimationFrame === 'function') win.cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  return { setReporting, scrollTo, destroy }
}
