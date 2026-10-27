import {
  QA_CONTEXT_CLASS_MAX,
  QA_CONTEXT_HTML_MAX,
  QA_CONTEXT_MAX_ANCESTORS,
  QA_CONTEXT_MAX_CLASSES,
  type QaContextAncestor,
  type QaElementContext,
} from '../../../../lib/qa/types'

/**
 * Builds the element context sent with a qa:pick. Text only: nothing here
 * assigns innerHTML or inserts nodes, it only reads the page.
 */

/** Ancestors that end the climb: the first one of these is the last ancestor listed. */
const LANDMARK_TAGS = new Set(['section', 'header', 'footer', 'main', 'article', 'nav'])

function whole(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : 0
}

function classesOf(el: Element): string[] {
  const raw = el.getAttribute('class')
  if (!raw) return []
  const out: string[] = []
  for (const cls of raw.split(/\s+/)) {
    if (!cls) continue
    out.push(cls.slice(0, QA_CONTEXT_CLASS_MAX))
    if (out.length >= QA_CONTEXT_MAX_CLASSES) break
  }
  return out
}

function idOf(el: Element): string | null {
  const id = el.getAttribute('id')
  return id ? id.slice(0, 200) : null
}

/** Nearest first. Stops after the first landmark or body child, and never lists body or html. */
export function ancestorsOf(el: Element): QaContextAncestor[] {
  const out: QaContextAncestor[] = []
  let node: Element | null = el.parentElement
  while (node && out.length < QA_CONTEXT_MAX_ANCESTORS) {
    const tag = node.localName
    if (tag === 'body' || tag === 'html') break
    out.push({ tag, id: idOf(node), classes: classesOf(node) })
    const parentTag = node.parentElement ? node.parentElement.localName : 'body'
    if (LANDMARK_TAGS.has(tag) || parentTag === 'body') break
    node = node.parentElement
  }
  return out
}

export function buildElementContext(el: Element, win: Window, doc: Document): QaElementContext {
  const rect = el.getBoundingClientRect()
  const scrollX = win.scrollX || 0
  const scrollY = win.scrollY || 0
  const root = doc.documentElement
  const outer = (el as Element & { outerHTML?: string }).outerHTML
  return {
    id: idOf(el),
    classes: classesOf(el),
    ancestors: ancestorsOf(el),
    html: typeof outer === 'string' ? outer.slice(0, QA_CONTEXT_HTML_MAX) : '',
    box: {
      x: whole(rect.left + scrollX),
      y: whole(rect.top + scrollY),
      width: whole(rect.width),
      height: whole(rect.height),
    },
    scrollY: whole(scrollY),
    pageHeight: whole(Math.max(root.scrollHeight, doc.body ? doc.body.scrollHeight : 0)),
    viewportWidth: whole(win.innerWidth),
    viewportHeight: whole(win.innerHeight),
  }
}
