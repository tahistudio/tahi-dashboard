/**
 * lib/sanitize-rich-text.ts
 *
 * Workers-safe (pure JS, no DOM / no Node deps) allowlist sanitizer for the
 * untrusted rich-text (Tiptap HTML) that portal CLIENTS submit: request
 * descriptions and message bodies. These are stored and later rendered to Tahi
 * admins via dangerouslySetInnerHTML, so an unsanitised payload like
 * `<img src=x onerror=...>` is a stored client -> admin XSS.
 *
 * Design (deliberately strict, so it is easy to verify as safe):
 *   - The input is TOKENISED (not regex tag-matched, which is bypassable).
 *   - Only a small allowlist of FORMATTING tags survives. Everything else has
 *     its tag markup dropped (its text content is kept and escaped).
 *   - Dangerous elements (script/style/iframe/svg/...) are dropped WITH their
 *     content.
 *   - NO attribute survives, with a single exception: `href` on <a>, and only
 *     when it is an http(s)/mailto/relative URL. Because no other attribute is
 *     ever emitted, there is no surface for on*= handlers, style, srcset, etc.
 *   - All text nodes are HTML-escaped on output.
 *
 * The result is safe to render with dangerouslySetInnerHTML. Rich formatting a
 * client cannot express in the allowlist (e.g. images, @mention spans) degrades
 * to plain text, which is the correct trade for an untrusted boundary.
 */

// Inline + block formatting tags that may carry no attributes.
const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'mark',
  'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'blockquote', 'code', 'pre', 'a',
])

// Elements whose entire contents are discarded, not just the tag.
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template',
  'svg', 'math', 'title', 'textarea', 'xmp',
])

function escapeText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Validate an <a href>: only http(s), mailto, and relative links survive. */
function safeHref(raw: string): string | null {
  // Decode numeric HTML entities that could hide a scheme (e.g.
  // &#106;avascript:), then drop ALL whitespace + control chars (<= 0x20) a
  // browser would ignore inside a scheme (e.g. "java\tscript:").
  const decoded = raw
    .replace(/&#x([0-9a-f]+);?/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_m, d) => String.fromCharCode(parseInt(d, 10)))
  let cleaned = ''
  for (let k = 0; k < decoded.length; k++) {
    if (decoded.charCodeAt(k) > 0x20) cleaned += decoded[k]
  }
  cleaned = cleaned.toLowerCase()
  if (cleaned.startsWith('http://') || cleaned.startsWith('https://') || cleaned.startsWith('mailto:')) {
    return raw.trim()
  }
  // Allow relative / anchor links (no scheme and not protocol-relative "//").
  if (!/^[a-z][a-z0-9+.-]*:/.test(cleaned) && !cleaned.startsWith('//')) {
    return raw.trim()
  }
  return null
}

/**
 * Find the index of the '>' that closes the tag starting at `lt`, respecting
 * quoted attribute values so a '>' INSIDE an attribute (e.g.
 * href="data:...<script>...") does not prematurely end the tag. Returns -1 if
 * the tag is never closed.
 */
function findTagEnd(input: string, lt: number): number {
  let quote: string | null = null
  for (let k = lt + 1; k < input.length; k++) {
    const ch = input[k]
    if (quote) {
      if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === '>') {
      return k
    }
  }
  return -1
}

interface ParsedTag {
  name: string
  closing: boolean
  attrs: Record<string, string>
}

/** Parse the inside of a `<...>` (without the angle brackets). */
function parseTag(inner: string): ParsedTag | null {
  let s = inner.trim()
  const closing = s.startsWith('/')
  if (closing) s = s.slice(1).trim()
  const nameMatch = /^([a-zA-Z][a-zA-Z0-9]*)/.exec(s)
  if (!nameMatch) return null
  const name = nameMatch[1].toLowerCase()
  s = s.slice(nameMatch[0].length)
  const attrs: Record<string, string> = {}
  // attr := name (= ("..." | '...' | bareword))?
  const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  let m: RegExpExecArray | null
  while ((m = attrRe.exec(s)) !== null) {
    if (m[0].trim() === '') break
    const attrName = m[1].toLowerCase()
    const value = m[4] ?? m[5] ?? m[6] ?? ''
    attrs[attrName] = value
  }
  return { name, closing, attrs }
}

export function sanitizeRichText(input: string | null | undefined): string {
  if (!input) return ''
  const out: string[] = []
  const len = input.length
  let i = 0
  while (i < len) {
    const lt = input.indexOf('<', i)
    if (lt === -1) {
      out.push(escapeText(input.slice(i)))
      break
    }
    if (lt > i) out.push(escapeText(input.slice(i, lt)))

    // Comment / doctype / processing instruction: drop entirely.
    if (input.startsWith('<!--', lt)) {
      const end = input.indexOf('-->', lt + 4)
      i = end === -1 ? len : end + 3
      continue
    }
    if (input.startsWith('<!', lt) || input.startsWith('<?', lt)) {
      const end = input.indexOf('>', lt + 2)
      i = end === -1 ? len : end + 1
      continue
    }

    const gt = findTagEnd(input, lt)
    if (gt === -1) {
      // No closing '>': treat the remainder as inert text (escaped).
      out.push(escapeText(input.slice(lt)))
      break
    }
    const inner = input.slice(lt + 1, gt)
    const parsed = parseTag(inner)
    if (!parsed) {
      // Not a real tag (e.g. "a < b"): escape the stray '<'.
      out.push('&lt;')
      i = lt + 1
      continue
    }

    const { name, closing, attrs } = parsed

    if (DROP_WITH_CONTENT.has(name)) {
      if (closing) {
        i = gt + 1
        continue
      }
      // Skip to the matching close tag, dropping all content.
      const rest = input.slice(gt + 1)
      const closeRe = new RegExp(`</\\s*${name}\\s*>`, 'i')
      const cm = closeRe.exec(rest)
      i = cm ? gt + 1 + cm.index + cm[0].length : len
      continue
    }

    if (!ALLOWED_TAGS.has(name)) {
      // Disallowed tag: drop the markup, keep any text children.
      i = gt + 1
      continue
    }

    if (closing) {
      out.push(`</${name}>`)
      i = gt + 1
      continue
    }

    // Allowed opening tag. Emit with NO attributes, except a validated href on <a>.
    if (name === 'a' && attrs.href) {
      const href = safeHref(attrs.href)
      out.push(href ? `<a href="${escapeAttr(href)}" rel="noopener noreferrer nofollow">` : '<a>')
    } else if (name === 'br') {
      out.push('<br>')
    } else {
      out.push(`<${name}>`)
    }
    i = gt + 1
  }
  return out.join('')
}
