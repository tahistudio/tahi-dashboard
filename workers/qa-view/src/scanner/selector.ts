/**
 * Builds a CSS selector that resolves back to exactly one element. Runs inside
 * the proxied client page, so it must work in any document the page provides.
 */

/** CSS.escape for an identifier, with a small fallback where CSS.escape is missing (some jsdom builds). */
function escapeIdent(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
  let out = ''
  for (let i = 0; i < value.length; i++) {
    const ch = value.charAt(i)
    const code = value.charCodeAt(i)
    if (code === 0) { out += '�'; continue }
    if (code < 0x20 || code === 0x7f) { out += `\\${code.toString(16)} `; continue }
    if (i === 0 && /[0-9]/.test(ch)) { out += `\\${code.toString(16)} `; continue }
    if (i === 1 && /[0-9]/.test(ch) && value.charAt(0) === '-') { out += `\\${code.toString(16)} `; continue }
    if (i === 0 && value.length === 1 && ch === '-') { out += '\\-'; continue }
    if (code >= 0x80 || /[A-Za-z0-9_-]/.test(ch)) { out += ch; continue }
    out += `\\${ch}`
  }
  return out
}

/** `#id` when the id is non-empty and matches only this node in the document, else null. */
function idSelectorFor(node: Element, doc: Document): string | null {
  const id = node.id
  if (!id) return null
  const selector = `#${escapeIdent(id)}`
  try {
    const matches = doc.querySelectorAll(selector)
    return matches.length === 1 && matches[0] === node ? selector : null
  } catch {
    return null
  }
}

/** One `tag` or `tag:nth-of-type(k)` step, the nth only when a same-tag sibling exists. */
function stepFor(node: Element): string {
  const tag = node.localName
  const parent = node.parentElement
  if (!parent) return tag
  const sameTag = Array.from(parent.children).filter(c => c.localName === tag)
  if (sameTag.length <= 1) return tag
  return `${tag}:nth-of-type(${sameTag.indexOf(node) + 1})`
}

function matchesOnly(selector: string, doc: Document, el: Element): boolean {
  try {
    const matches = doc.querySelectorAll(selector)
    return matches.length === 1 && matches[0] === el
  } catch {
    return false
  }
}

/** The dashboard drops a pick whose selector is longer than this, so the scanner never sends one. */
export const SELECTOR_MAX = 1000
const TRUNCATED_STEPS = 8

function buildSelector(el: Element, doc: Document): string {
  const own = idSelectorFor(el, doc)
  if (own) return own

  const steps: string[] = []
  let anchor: string | null = null
  let node: Element | null = el
  while (node) {
    if (node !== el) {
      const withId = idSelectorFor(node, doc)
      if (withId) { anchor = withId; break }
    }
    steps.unshift(stepFor(node))
    node = node.parentElement
  }

  const chain = anchor ? [anchor, ...steps] : steps
  for (let i = chain.length - 1; i >= 0; i--) {
    const candidate = chain.slice(i).join(' > ')
    if (matchesOnly(candidate, doc, el)) return candidate
  }
  const full = chain.join(' > ')
  if (full.length <= SELECTOR_MAX) return full
  // A chain too long to send: keep the last steps if that still pins the element down.
  const tail = chain.slice(-TRUNCATED_STEPS).join(' > ')
  return tail.length <= SELECTOR_MAX && matchesOnly(tail, doc, el) ? tail : full
}

/**
 * A selector that resolves to exactly one element and is never longer than SELECTOR_MAX.
 * When the element itself cannot be addressed that briefly, falls back to the nearest
 * ancestor that can, so a pick lands on something rather than being dropped.
 */
export function uniqueSelector(el: Element, doc: Document = el.ownerDocument): string {
  const direct = buildSelector(el, doc)
  if (direct.length <= SELECTOR_MAX) return direct
  let node = el.parentElement
  while (node) {
    const candidate = buildSelector(node, doc)
    if (candidate.length <= SELECTOR_MAX && matchesOnly(candidate, doc, node)) return candidate
    node = node.parentElement
  }
  return el.localName
}
