/**
 * The two pure string rules the request brief is built on, with no editor
 * attached.
 *
 * They used to live in components/tahi/rich-brief.tsx, which statically imports
 * @tiptap/react, @tiptap/starter-kit and @tiptap/extension-placeholder. The AI
 * wizard needs only these two functions, and it is loaded through
 * next/dynamic with ssr:false precisely to keep first-paint JS down, so
 * importing them from rich-brief.tsx pulled the whole Tiptap bundle into the
 * wizard chunk on the client portal as well as admin. Leaf module here,
 * re-exported from rich-brief.tsx so every existing caller and its tests keep
 * working unchanged.
 */

/**
 * Plain prose turned into the HTML the brief stores. The AI wizard route
 * documents its `description` as plain text and leaves the conversion to the
 * caller, and Tiptap's setContent parses whatever it is handed as HTML: without
 * this, a two-paragraph draft collapses into one run-on line and a stray "<"
 * is swallowed as markup. Blank lines split paragraphs, single newlines become
 * <br>, and the four HTML-significant characters are escaped.
 */
export function plainTextToBriefHtml(text?: string | null): string {
  if (!text) return ''
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  const blocks = escaped
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean)
  if (blocks.length === 0) return ''
  return blocks.map(block => `<p>${block.split('\n').join('<br>')}</p>`).join('')
}

/**
 * True when a value already looks like the HTML the editor emits, so an AI
 * draft is only converted when it really is plain text.
 */
export function looksLikeBriefHtml(value?: string | null): boolean {
  return !!value && /<(p|ul|ol|li|br|strong|em|a)\b[^>]*>/i.test(value)
}
