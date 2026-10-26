import type { QaCommentModeChangedMessage, QaEscapeMessage, QaPickMessage, QaPin, QaPinClickMessage } from '../../../../lib/qa/types'
import { uniqueSelector } from './selector'

export interface CommentLayerOptions {
  win: Window
  doc: Document
  post: (msg: QaPickMessage | QaPinClickMessage | QaCommentModeChangedMessage | QaEscapeMessage) => void
  pageUrl: () => string
  /** Pins live in a closed shadow root by default so site CSS cannot reach them. Tests pass 'open'. */
  shadowMode?: 'open' | 'closed'
}

export interface CommentLayer {
  setMode(on: boolean): void
  setPins(pins: QaPin[]): void
  focusPin(id: string): void
  /** Removes the always-on Escape listener. Pages never call this; tests do. */
  destroy(): void
}

interface PinEntry {
  pin: QaPin
  el: Element
  button: HTMLButtonElement
}

const OUTLINE = '2px solid #5A824E'
const OUTLINE_OFFSET = '2px'
const PIN_SIZE = 24
const PULSE_MS = 1000
const HOST_ATTR = 'data-qa-comment-layer'

const PIN_CSS = `
  .pin {
    position: fixed;
    box-sizing: border-box;
    width: ${PIN_SIZE}px;
    height: ${PIN_SIZE}px;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 50%;
    display: block;
    pointer-events: auto;
    cursor: pointer;
    color: #ffffff;
    background: #5A824E;
    font: 700 12px/24px system-ui, sans-serif;
    text-align: center;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  }
  .pin[data-resolved="true"] { background: #8a9987; }
  .pin:focus-visible { outline: 2px solid #5A824E; outline-offset: 2px; }
  .pin.pulse { animation: qa-pin-pulse ${PULSE_MS}ms ease-out 1; }
  @keyframes qa-pin-pulse {
    0% { transform: scale(1); }
    50% { transform: scale(1.6); }
    100% { transform: scale(1); }
  }
`

function asElement(node: EventTarget | null): Element | null {
  if (!node || !('nodeType' in node) || node.nodeType !== 1) return null
  return node as Element
}

function asStyled(node: EventTarget | null): HTMLElement | SVGElement | null {
  const el = asElement(node)
  return el ? (el as HTMLElement | SVGElement) : null
}

/** Fraction of the box along one axis, clamped to 0..1. Centre when the box has no size. */
function fraction(client: number, start: number, size: number): number {
  if (size <= 0) return 0.5
  return Math.min(1, Math.max(0, (client - start) / size))
}

export function createCommentLayer(opts: CommentLayerOptions): CommentLayer {
  const { win, doc, post, pageUrl } = opts
  const shadowMode = opts.shadowMode ?? 'closed'

  let on = false
  let prevCursor = ''
  let hovered: HTMLElement | SVGElement | null = null
  let hoverPrev = { outline: '', outlineOffset: '' }

  let host: HTMLDivElement | null = null
  let container: HTMLDivElement | null = null
  let rafId: number | null = null
  let entries: PinEntry[] = []

  function fromHost(e: Event): boolean {
    if (!host) return false
    return e.target === host || e.composedPath().includes(host)
  }

  function clearHover(): void {
    if (!hovered) return
    hovered.style.outline = hoverPrev.outline
    hovered.style.outlineOffset = hoverPrev.outlineOffset
    hovered = null
  }

  function setHover(el: HTMLElement | SVGElement): void {
    if (el === hovered) return
    clearHover()
    hoverPrev = { outline: el.style.outline, outlineOffset: el.style.outlineOffset }
    el.style.outline = OUTLINE
    el.style.outlineOffset = OUTLINE_OFFSET
    hovered = el
  }

  function onPointerMove(e: Event): void {
    if (!on || fromHost(e)) return
    const target = asStyled(e.target)
    if (target) setHover(target)
  }

  function onBlock(e: Event): void {
    if (!on || fromHost(e)) return
    e.preventDefault()
    e.stopPropagation()
  }

  function onClick(e: MouseEvent): void {
    if (!on || fromHost(e)) return
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()
    const el = asElement(e.target)
    if (!el) return
    const rect = el.getBoundingClientRect()
    const msg: QaPickMessage = {
      type: 'qa:pick',
      version: 1,
      url: pageUrl(),
      selector: uniqueSelector(el, doc),
      ox: fraction(e.clientX, rect.left, rect.width),
      oy: fraction(e.clientY, rect.top, rect.height),
      tag: el.tagName.toLowerCase(),
      text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120),
    }
    post(msg)
  }

  // Always attached: focus inside the frame swallows Escape before the dashboard sees it.
  // With comment mode on, Esc only leaves the mode (the dashboard follows through the
  // mode message). With it off, Esc is forwarded so the dashboard can peel its own layers.
  function onKey(e: KeyboardEvent): void {
    if (e.key !== 'Escape') return
    if (!on) {
      // The page used this Esc itself (closing its own menu, say), or the key is held down.
      if (e.defaultPrevented || e.repeat) return
      const escape: QaEscapeMessage = { type: 'qa:escape', version: 1 }
      post(escape)
      return
    }
    setMode(false)
    // Tell the dashboard so its Comment toggle follows. A mode change sent by the
    // dashboard never comes through here, so there is no echo.
    const msg: QaCommentModeChangedMessage = { type: 'qa:comment-mode-changed', version: 1, on: false }
    post(msg)
  }

  function attachCommentListeners(): void {
    win.addEventListener('pointermove', onPointerMove, true)
    win.addEventListener('pointerdown', onBlock, true)
    win.addEventListener('mousedown', onBlock, true)
    win.addEventListener('submit', onBlock, true)
    win.addEventListener('click', onClick, true)
  }

  function detachCommentListeners(): void {
    win.removeEventListener('pointermove', onPointerMove, true)
    win.removeEventListener('pointerdown', onBlock, true)
    win.removeEventListener('mousedown', onBlock, true)
    win.removeEventListener('submit', onBlock, true)
    win.removeEventListener('click', onClick, true)
  }

  function schedule(): void {
    if (rafId !== null) return
    const run = (): void => {
      rafId = null
      render()
    }
    if (typeof win.requestAnimationFrame === 'function') rafId = win.requestAnimationFrame(run)
    else rafId = win.setTimeout(run, 16)
  }

  function ensureHost(): void {
    if (host && container) return
    const h = doc.createElement('div')
    h.setAttribute(HOST_ATTR, '')
    const s = h.style
    s.position = 'fixed'
    s.top = '0'
    s.right = '0'
    s.bottom = '0'
    s.left = '0'
    s.pointerEvents = 'none'
    s.zIndex = '2147483647'
    const shadow = h.attachShadow({ mode: shadowMode })
    const style = doc.createElement('style')
    style.textContent = PIN_CSS
    const box = doc.createElement('div')
    shadow.append(style, box)
    doc.documentElement.appendChild(h)
    host = h
    container = box
    win.addEventListener('scroll', schedule, { capture: true, passive: true })
    win.addEventListener('resize', schedule)
    const RO = (win as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver
    if (typeof RO === 'function' && doc.body) {
      const observer = new RO(() => schedule())
      observer.observe(doc.body)
    }
  }

  function resolve(selector: string): Element | null {
    try {
      return doc.querySelector(selector)
    } catch {
      return null
    }
  }

  function render(): void {
    for (const entry of entries) {
      const rect = entry.el.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) {
        entry.button.style.display = 'none'
        continue
      }
      const x = rect.left + entry.pin.ox * rect.width
      const y = rect.top + entry.pin.oy * rect.height
      entry.button.style.display = ''
      entry.button.style.left = `${x - PIN_SIZE / 2}px`
      entry.button.style.top = `${y - PIN_SIZE / 2}px`
    }
  }

  function setMode(next: boolean): void {
    if (next === on) return
    on = next
    if (on) {
      prevCursor = doc.documentElement.style.cursor
      doc.documentElement.style.cursor = 'crosshair'
      attachCommentListeners()
    } else {
      detachCommentListeners()
      clearHover()
      doc.documentElement.style.cursor = prevCursor
    }
  }

  function setPins(pins: QaPin[]): void {
    ensureHost()
    if (!container) return
    for (const entry of entries) entry.button.remove()
    entries = []
    for (const pin of pins) {
      const el = resolve(pin.selector)
      if (!el) continue
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) continue
      const button = doc.createElement('button')
      button.type = 'button'
      button.className = 'pin'
      button.textContent = String(pin.n)
      button.setAttribute('aria-label', `Comment ${pin.n}`)
      button.setAttribute('data-resolved', pin.resolved ? 'true' : 'false')
      button.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation()
        const msg: QaPinClickMessage = { type: 'qa:pin-click', version: 1, id: pin.id }
        post(msg)
      })
      container.appendChild(button)
      entries.push({ pin, el, button })
    }
    render()
  }

  function pulse(button: HTMLButtonElement): void {
    if (typeof button.animate === 'function') {
      button.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.6)' }, { transform: 'scale(1)' }],
        { duration: PULSE_MS, easing: 'ease-out' },
      )
      return
    }
    button.classList.remove('pulse')
    button.classList.add('pulse')
    win.setTimeout(() => button.classList.remove('pulse'), PULSE_MS)
  }

  function focusPin(id: string): void {
    const entry = entries.find(e => e.pin.id === id)
    if (!entry) return
    if (typeof entry.el.scrollIntoView === 'function') {
      entry.el.scrollIntoView({ block: 'center', behavior: 'auto' })
    }
    pulse(entry.button)
  }

  win.addEventListener('keydown', onKey)

  function destroy(): void {
    win.removeEventListener('keydown', onKey)
  }

  return { setMode, setPins, focusPin, destroy }
}
