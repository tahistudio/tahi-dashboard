import axe from 'axe-core'
import type { QaA11yViolation, QaScanMessage, QaScanResult } from '../../../../lib/qa/types'
import { decodeViewTokenPayload } from '../../../../lib/qa/token'
import { collectContent, collectLayout, collectLinks, collectPerf, collectSeo } from './collect'

const script = document.currentScript as HTMLScriptElement | null
const token = script ? new URL(script.src).searchParams.get('t') ?? '' : ''
const payload = decodeViewTokenPayload(token)
const proxyBase = `${location.origin}/v/${token}`

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
  const path = location.pathname.slice(`/v/${token}`.length) || '/'
  const msg: QaScanMessage = { type: 'qa:scan', version: 1, url: `${payload.o}${path}${location.search}`, viewportWidth: window.innerWidth, result }
  window.parent.postMessage(msg, payload.p)
}

let outlined: HTMLElement | null = null
window.addEventListener('message', (e: MessageEvent) => {
  if (!payload || e.origin !== payload.p) return
  const data = e.data as { type?: string; selector?: string }
  if (data.type === 'qa:rescan') void scan()
  if (data.type === 'qa:highlight' && data.selector) {
    if (outlined) outlined.style.outline = ''
    const el = document.querySelector<HTMLElement>(data.selector)
    if (el) {
      el.style.outline = '3px solid #f87171'
      el.style.outlineOffset = '2px'
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      outlined = el
    }
  }
})

window.addEventListener('load', () => { setTimeout(() => { void scan() }, 1500) })
