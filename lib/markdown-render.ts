/**
 * Minimal, deterministic Markdown → HTML renderer for the content
 * pipeline. Cloudflare-Workers-bundle friendly (no deps).
 *
 * Why this exists: making the Writer + Editor echo back BOTH a markdown
 * body and an HTML body in a single JSON response blows past output
 * token limits on a 1500-word article and truncates the JSON (the
 * "Claude returned non-JSON for stage editor" failure). Instead the
 * leads return markdown only and we render HTML here.
 *
 * Supported: ATX headings (## / ###), paragraphs, bold (**x**),
 * italics (*x* / _x_), inline links [text](url), inline code (`x`),
 * unordered lists (- / *), ordered lists (1.), blockquotes (>),
 * horizontal rules (---). Good enough for Webflow rich-text bodies.
 * Not a CommonMark implementation — intentionally small.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Inline formatting: links, bold, italic, code. Order matters — links
 *  first so their text isn't mangled, then code, then bold, then italic. */
function renderInline(text: string): string {
  let out = escapeHtml(text)
  // Inline code (before bold/italic so * inside code isn't touched)
  out = out.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`)
  // Links [text](url)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, url) => {
    const safeUrl = url.replace(/"/g, '%22')
    return `<a href="${safeUrl}">${label}</a>`
  })
  // Bold **x**
  out = out.replace(/\*\*([^*]+)\*\*/g, (_m, b) => `<strong>${b}</strong>`)
  // Italic *x* or _x_
  out = out.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, (_m, pre, i) => `${pre}<em>${i}</em>`)
  out = out.replace(/_([^_]+)_/g, (_m, i) => `<em>${i}</em>`)
  return out
}

export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const html: string[] = []
  let i = 0
  let paragraph: string[] = []

  function flushParagraph() {
    if (paragraph.length > 0) {
      const text = paragraph.join(' ').trim()
      if (text) html.push(`<p>${renderInline(text)}</p>`)
      paragraph = []
    }
  }

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // Blank line ends a paragraph
    if (trimmed === '') {
      flushParagraph()
      i++
      continue
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph()
      html.push('<hr>')
      i++
      continue
    }

    // Headings
    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      flushParagraph()
      const level = heading[1].length
      html.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`)
      i++
      continue
    }

    // Blockquote (consume consecutive > lines)
    if (/^>\s?/.test(trimmed)) {
      flushParagraph()
      const quote: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quote.push(lines[i].trim().replace(/^>\s?/, ''))
        i++
      }
      html.push(`<blockquote><p>${renderInline(quote.join(' '))}</p></blockquote>`)
      continue
    }

    // Unordered list
    if (/^[-*]\s+/.test(trimmed)) {
      flushParagraph()
      const items: string[] = []
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ''))
        i++
      }
      html.push(`<ul>${items.map(it => `<li>${renderInline(it)}</li>`).join('')}</ul>`)
      continue
    }

    // Ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      flushParagraph()
      const items: string[] = []
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''))
        i++
      }
      html.push(`<ol>${items.map(it => `<li>${renderInline(it)}</li>`).join('')}</ol>`)
      continue
    }

    // Default: accumulate into a paragraph
    paragraph.push(trimmed)
    i++
  }
  flushParagraph()
  return html.join('\n')
}
