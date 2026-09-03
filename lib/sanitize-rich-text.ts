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

/**
 * A '&' that does NOT already open a valid named or numeric entity.
 *
 * This sanitizer runs at render time too, over bodies a writer has usually
 * escaped once already: Tiptap's getHTML() emits `&amp;` for a typed '&', and
 * the portal writers run this same function before the row is stored.
 * Escaping every '&' unconditionally re-escaped those stored entities, so a
 * second pass printed the literal text "Q&amp;A" where the author typed
 * "Q&A". Leaving an existing entity alone makes the pass idempotent:
 * sanitizeRichText(sanitizeRichText(x)) === sanitizeRichText(x).
 *
 * Safety is unaffected. An entity in a TEXT node always decodes to a
 * character and never to markup, which is the whole point of escaping.
 */
const BARE_AMP = /&(?!(?:#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);)/g

function escapeText(s: string): string {
  return s
    .replace(BARE_AMP, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Attribute values are escaped WITHOUT the entity exemption above: every '&'
 * becomes '&amp;', so nothing a browser would decode inside an attribute can
 * survive. safeHref hands this the fully decoded url, so the escape puts back
 * the one canonical entity and the pair is stable across repeat passes.
 */
function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// The named entities a browser decodes inside an attribute that matter to the
// scheme check in safeHref: the whitespace and punctuation an attacker can
// hide a "javascript:" behind, plus the ones that round-trip escapeAttr's own
// output. Anything else is left literal, which is harmless because escapeAttr
// re-escapes its '&' on the way out.
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  tab: '\t', newline: '\n', colon: ':', sol: '/',
  semi: ';', num: '#', period: '.', lpar: '(', rpar: ')', excl: '!', comma: ',',
}

/**
 * Decode HTML entities the way a browser does when it reads an attribute
 * value, in ONE pass, so "&amp;amp;" decodes to "&amp;" and not to "&".
 */
function decodeEntities(raw: string): string {
  return raw.replace(/&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole: string, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole
      try {
        return String.fromCodePoint(code)
      } catch {
        return whole
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole
  })
}

/**
 * Validate an <a href>: only http(s), mailto, and relative links survive.
 *
 * Returns the DECODED url, which escapeAttr then escapes exactly once. That
 * is both what the author meant (a stored `?a=1&amp;b=2` is the url
 * `?a=1&b=2`) and what makes a second sanitize pass reproduce the first.
 */
function safeHref(raw: string): string | null {
  // Decode the HTML entities that could hide a scheme (e.g. &#106;avascript:
  // or java&Tab;script:), then drop ALL whitespace + control chars (<= 0x20) a
  // browser would ignore inside a scheme (e.g. "java\tscript:").
  const decoded = decodeEntities(raw)
  // For the CHECK only, collapse numeric references that were written without
  // their closing semicolon as well, because a browser still decodes those.
  // The url this function RETURNS keeps the strict decode above; this pass
  // only decides whether the link is allowed through at all.
  const probe = decoded
    .replace(/&#x([0-9a-f]+);?/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_m, d: string) => String.fromCharCode(parseInt(d, 10)))
  let cleaned = ''
  for (let k = 0; k < probe.length; k++) {
    if (probe.charCodeAt(k) > 0x20) cleaned += probe[k]
  }
  cleaned = cleaned.toLowerCase()
  if (cleaned.startsWith('http://') || cleaned.startsWith('https://') || cleaned.startsWith('mailto:')) {
    return decoded.trim()
  }
  // Allow relative / anchor links (no scheme and not protocol-relative "//").
  if (!/^[a-z][a-z0-9+.-]*:/.test(cleaned) && !cleaned.startsWith('//')) {
    return decoded.trim()
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
