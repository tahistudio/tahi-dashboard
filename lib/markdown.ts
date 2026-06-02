/**
 * Lightweight markdown -> HTML renderer shared across the dashboard
 * (Docs Hub, Sitemap spec view). Handles headings, bold/italic/code,
 * links, ordered + unordered lists, horizontal rules, and pipe tables.
 * Output is meant to be dropped into a `.tahi-doc-prose` container.
 *
 * Not a full CommonMark implementation: it covers what our internal
 * docs actually use. Keep it dependency-free so it runs anywhere.
 */

/** Tiptap saves HTML; older imports stored markdown. Branch on this so
 *  legacy docs don't show raw markdown source. */
export function looksLikeHtml(s: string): boolean {
  return /^\s*<[a-z]/i.test(s)
}

export function inlineMarkdown(s: string): string {
  return s
    .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
    .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
}

function splitTableRow(row: string): string[] {
  return row.replace(/^\||\|$/g, '').split('|').map(c => c.trim())
}

function renderTable(headers: string[], rows: string[][]): string {
  const thead = `<thead><tr>${headers.map(h => `<th>${inlineMarkdown(h)}</th>`).join('')}</tr></thead>`
  const tbody = `<tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inlineMarkdown(c)}</td>`).join('')}</tr>`).join('')}</tbody>`
  return `<table>${thead}${tbody}</table>`
}

export function renderMarkdown(md: string): string {
  const escaped = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const lines = escaped.split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()
    if (trimmed.startsWith('|') && trimmed.endsWith('|') && i + 1 < lines.length) {
      const next = lines[i + 1].trim()
      const isSeparator = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(next)
      if (isSeparator) {
        const headerCells = splitTableRow(trimmed)
        const bodyRows: string[][] = []
        let j = i + 2
        while (j < lines.length) {
          const t = lines[j].trim()
          if (!t.startsWith('|') || !t.endsWith('|')) break
          bodyRows.push(splitTableRow(t))
          j++
        }
        out.push(renderTable(headerCells, bodyRows))
        i = j
        continue
      }
    }
    if (!trimmed) { out.push(''); i++; continue }
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.*)$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      out.push(`<h${level}>${inlineMarkdown(headingMatch[2])}</h${level}>`)
      i++
      continue
    }
    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(`<li>${inlineMarkdown(lines[i].replace(/^\s*[-*]\s+/, ''))}</li>`)
        i++
      }
      out.push(`<ul>${items.join('')}</ul>`)
      continue
    }
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${inlineMarkdown(lines[i].replace(/^\s*\d+\.\s+/, ''))}</li>`)
        i++
      }
      out.push(`<ol>${items.join('')}</ol>`)
      continue
    }
    if (/^---+$/.test(trimmed)) { out.push('<hr />'); i++; continue }
    out.push(`<p>${inlineMarkdown(trimmed)}</p>`)
    i++
  }
  return out.filter(Boolean).join('\n')
}
