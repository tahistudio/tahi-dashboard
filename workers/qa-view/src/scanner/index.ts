import axe from 'axe-core'
import type { QaA11yViolation, QaPin, QaScanMessage, QaScanResult } from '../../../../lib/qa/types'
import { decodeViewTokenPayload } from '../../../../lib/qa/token'
import { collectContent, collectLayout, collectLinks, collectPerf, collectSeo } from './collect'
import { createCommentLayer } from './comments'

const script = document.currentScript as HTMLScriptElement | null
const token = script ? new URL(script.src).searchParams.get('t') ?? '' : ''
const payload = decodeViewTokenPayload(token)
const proxyBase = `${location.origin}/v/${token}`

function pagePath(): string {
  return location.pathname.slice(`/v/${token}`.length) || '/'
}

const commentLayer = payload
  ? createCommentLayer({
      win: window,
      doc: document,
      post: msg => window.parent.postMessage(msg, payload.p),
      pageUrl: () => `${payload.o}${pagePath()}${location.search}`,
    })
  : null

async function runAxe(): Promise<QaA11yViolation[]> {
  const res = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] })
  return res.violations.map(v => ({
    id: v.id,
    impact: (v.impact ?? null) as QaA11yViolation['impact'],
    help: v.help,
    helpUrl: v.helpUrl,
    nodes: v.nodes.slice(0, 20).map(n => ({ selector: n.target.map(String).join(' '), html: n.html.slice(0, 300) })),
  }))
}

async function scan(): Promise<void> {
  if (!payload) return
  const { links, missingAnchors } = collectLinks(document, proxyBase, payload.o)
  const result: QaScanResult = {
    a11y: await runAxe().catch(() => []),
    links,
    missingAnchors,
    seo: collectSeo(document),
    content: collectContent(document),
    layout: collectLayout(document, window),
    perf: collectPerf(document, window),
  }
  const msg: QaScanMessage = { type: 'qa:scan', version: 1, url: `${payload.o}${pagePath()}${location.search}`, viewportWidth: window.innerWidth, result }
  window.parent.postMessage(msg, payload.p)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Keeps only pins whose fields have the right types and ranges. Anything else is dropped. */
function parsePins(raw: unknown): QaPin[] {
  if (!Array.isArray(raw)) return []
  const pins: QaPin[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const { id, n, selector, ox, oy, resolved } = item
    if (typeof id !== 'string' || id.length === 0 || id.length > 200) continue
    if (typeof n !== 'number' || !Number.isFinite(n)) continue
    if (typeof selector !== 'string' || selector.length === 0 || selector.length > 1000) continue
    if (typeof ox !== 'number' || !Number.isFinite(ox) || ox < 0 || ox > 1) continue
    if (typeof oy !== 'number' || !Number.isFinite(oy) || oy < 0 || oy > 1) continue
    if (typeof resolved !== 'boolean') continue
    pins.push({ id, n, selector, ox, oy, resolved })
  }
  return pins
}

let outlined: HTMLElement | null = null
window.addEventListener('message', (e: MessageEvent) => {
  if (!payload || e.origin !== payload.p) return
  const data: unknown = e.data
  if (!isRecord(data)) return
  if (data.type === 'qa:rescan') void scan()
  if (data.type === 'qa:highlight' && typeof data.selector === 'string' && data.selector) {
    if (outlined) outlined.style.outline = ''
    const el = document.querySelector<HTMLElement>(data.selector)
    if (el) {
      el.style.outline = '3px solid #f87171'
      el.style.outlineOffset = '2px'
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      outlined = el
    }
  }
  if (data.type === 'qa:comment-mode' && typeof data.on === 'boolean') commentLayer?.setMode(data.on)
  if (data.type === 'qa:pins') commentLayer?.setPins(parsePins(data.pins))
  if (data.type === 'qa:focus-pin' && typeof data.id === 'string') commentLayer?.focusPin(data.id)
})

window.addEventListener('load', () => { setTimeout(() => { void scan() }, 1500) })
