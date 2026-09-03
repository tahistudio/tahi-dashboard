'use client'

/**
 * <RichBrief>. The small rich-text editor the new request dialog uses for the
 * brief. Four tools only: bold, italic, bulleted list and link. Anything
 * heavier belongs in the message composer, which is where a conversation
 * happens; the brief is the one paragraph plus a few bullets a person writes
 * before they hit Create.
 *
 * It emits HTML into `requests.description`, the same shape the thread already
 * stores, so the detail page keeps rendering it through the existing
 * dangerouslySetInnerHTML block and nothing downstream has to change. Callers
 * that need plain text (word counts, previews, seeding the AI briefing) run it
 * through `richBriefPlainText` first.
 *
 * Empty is normalised to an empty string rather than Tiptap's "<p></p>", so a
 * brief that was typed then cleared is falsy for every caller that checks it.
 *
 * <RichBriefProse> is the reading twin: the same list, link and emphasis rules
 * for a brief that has already been saved. Use it anywhere a stored
 * description is rendered, because the repo has no typography plugin and
 * Tailwind's preflight has already flattened lists and links by then.
 *
 * Styles live in RICH_BRIEF_CSS below rather than app/globals.css: the block
 * is component-local the same way kanban-board.tsx keeps KANBAN_CSS, so it
 * ships and dies with the component.
 */

import * as React from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Bold, Italic, List, Link as LinkIcon } from 'lucide-react'
import { sanitizeRichText } from '@/lib/sanitize-rich-text'

// ── Pure helpers ───────────────────────────────────────────────────────────────

/**
 * The readable text inside a brief, with tags dropped and the handful of
 * entities Tiptap emits decoded. Mirrors the stripper already in
 * app/(dashboard)/requests/[id]/request-detail.tsx so a brief reads the same
 * whichever side asks for it.
 */
export function richBriefPlainText(html?: string | null): string {
  if (!html) return ''
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** True when the brief carries no readable text, whatever markup is around it. */
export function richBriefIsEmpty(html?: string | null): boolean {
  return richBriefPlainText(html).length === 0
}

/**
 * What the editor should hand back for the document it currently holds.
 * Tiptap reports an empty document as "<p></p>", which is truthy and would
 * make an untouched brief look filled in.
 */
export function normaliseBriefHtml(html: string): string {
  return richBriefIsEmpty(html) ? '' : html
}

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

// ── Styles ─────────────────────────────────────────────────────────────────────

const RICH_BRIEF_CSS = `
.tahi-rich-brief{
  border: 1px solid var(--color-border);
  border-radius: var(--radius-input);
  background: var(--color-bg);
  overflow: hidden;
  transition: border-color 140ms var(--ease-out);
}
.tahi-rich-brief:focus-within{ border-color: var(--color-brand); }
.tahi-rich-brief-tools{
  display: flex;
  align-items: center;
  gap: 0.125rem;
  padding: 0.3125rem 0.375rem;
  border-bottom: 1px solid var(--color-border-subtle);
  background: var(--color-bg-secondary);
}
.tahi-rich-brief-tool{
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.875rem;
  height: 1.875rem;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: background 130ms var(--ease-out), color 130ms var(--ease-out);
}
.tahi-rich-brief-tool:hover{ background: var(--color-bg); color: var(--color-text); }
.tahi-rich-brief-tool[data-active="true"]{
  background: var(--color-brand-100);
  /* --color-link, not --color-brand-dark: brand-dark has no .dark override,
     so it reads at roughly 1.6:1 once the panel goes dark. */
  color: var(--color-link);
}
.tahi-rich-brief-div{
  width: 1px;
  height: 1.125rem;
  margin: 0 0.25rem;
  background: var(--color-border);
}
.tahi-rich-brief-editor.ProseMirror{
  min-height: 6rem;
  max-height: 15rem;
  overflow-y: auto;
  padding: 0.6875rem 0.8125rem;
  font-size: 0.875rem;
  line-height: 1.6;
  color: var(--color-text);
  outline: none;
}
.tahi-rich-brief-editor.ProseMirror p{ margin: 0 0 0.375rem; }
.tahi-rich-brief-editor.ProseMirror p:last-child{ margin-bottom: 0; }
/* Tailwind's preflight sets "ul { list-style: none }", so a bulleted brief
   would be plain indented text without this. Same reason .tahi-doc-prose
   redraws its own markers in app/globals.css. */
.tahi-rich-brief-editor.ProseMirror ul{
  margin: 0.375rem 0;
  padding-left: 1.25rem;
  list-style: disc;
}
.tahi-rich-brief-editor.ProseMirror li{ margin: 0.125rem 0; }
.tahi-rich-brief-editor.ProseMirror li::marker{ color: var(--color-brand); }
.tahi-rich-brief-editor.ProseMirror li > p{ margin: 0; }
.tahi-rich-brief-editor.ProseMirror strong{ font-weight: 700; }
/* Preflight also resets "a { color: inherit; text-decoration: inherit }", so
   a link inside the brief needs its colour and underline spelled out. */
.tahi-rich-brief-editor.ProseMirror a{
  color: var(--color-link);
  text-decoration: underline;
  text-underline-offset: 0.1875rem;
}
.tahi-rich-brief-editor.ProseMirror p.is-editor-empty:first-child::before{
  content: attr(data-placeholder);
  float: left;
  height: 0;
  color: var(--color-text-subtle);
  pointer-events: none;
}
@media (max-width: 47.9375rem){
  .tahi-rich-brief-tool{ width: 2.75rem; height: 2.75rem; }
  .tahi-rich-brief-tools{ gap: 0; }
}
`

/**
 * The read side of the same brief. The repo has no @tailwindcss/typography
 * plugin, so a "prose" class on a saved brief is a no-op and preflight has
 * already flattened its lists and links. These rules are the reading twin of
 * the editor rules above, so a brief looks the same either side of Create.
 */
const RICH_BRIEF_PROSE_CSS = `
.tahi-brief-prose{ font-size: 0.875rem; line-height: 1.6; color: var(--color-text); }
.tahi-brief-prose > :first-child{ margin-top: 0; }
.tahi-brief-prose > :last-child{ margin-bottom: 0; }
.tahi-brief-prose p{ margin: 0 0 0.5rem; }
.tahi-brief-prose ul{ margin: 0.5rem 0; padding-left: 1.25rem; list-style: disc; }
.tahi-brief-prose ol{ margin: 0.5rem 0; padding-left: 1.25rem; list-style: decimal; }
.tahi-brief-prose li{ margin: 0.125rem 0; }
.tahi-brief-prose li::marker{ color: var(--color-brand); }
.tahi-brief-prose li > p{ margin: 0; }
.tahi-brief-prose strong{ font-weight: 700; }
.tahi-brief-prose em{ font-style: italic; }
.tahi-brief-prose a{
  color: var(--color-link);
  text-decoration: underline;
  text-underline-offset: 0.1875rem;
}
.tahi-brief-prose a:hover{ text-decoration-thickness: 0.125rem; }
`

// ── Component ──────────────────────────────────────────────────────────────────

export interface RichBriefProps {
  /** HTML in, HTML out. An empty brief is the empty string, never "<p></p>". */
  value: string
  onChange: (html: string) => void
  placeholder?: string
  /** Labels the editable region. Point it at the field's own label copy. */
  ariaLabel: string
}

export function RichBrief({ value, onChange, placeholder, ariaLabel }: RichBriefProps) {
  // Latest onChange without re-creating the editor on every parent render.
  const onChangeRef = React.useRef(onChange)
  React.useEffect(() => { onChangeRef.current = onChange }, [onChange])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Four tools, so everything the toolbar cannot reach is switched off
        // rather than left reachable by keyboard shortcut or paste.
        blockquote: false,
        code: false,
        codeBlock: false,
        heading: false,
        horizontalRule: false,
        orderedList: false,
        strike: false,
        underline: false,
        link: {
          openOnClick: false,
          HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
        },
      }),
      Placeholder.configure({ placeholder: placeholder ?? '' }),
    ],
    content: value,
    editorProps: {
      attributes: {
        class: 'tahi-rich-brief-editor',
        'aria-label': ariaLabel,
        role: 'textbox',
        'aria-multiline': 'true',
      },
    },
    onUpdate: ({ editor: ed }) => onChangeRef.current(normaliseBriefHtml(ed.getHTML())),
    immediatelyRender: false,
  })

  // The AI hand-back writes a whole brief into `value` while the editor is
  // mounted. Push it in when it genuinely differs, so typing never fights the
  // sync and the caret is only reset when the content actually changed.
  React.useEffect(() => {
    if (!editor) return
    const current = normaliseBriefHtml(editor.getHTML())
    if (current === value) return
    editor.commands.setContent(value || '', { emitUpdate: false })
  }, [editor, value])

  // Re-render the toolbar as marks turn on and off under the caret.
  const [, setTick] = React.useState(0)
  const force = React.useCallback(() => setTick(t => t + 1), [])
  React.useEffect(() => {
    if (!editor) return
    editor.on('selectionUpdate', force)
    editor.on('transaction', force)
    return () => {
      editor.off('selectionUpdate', force)
      editor.off('transaction', force)
    }
  }, [editor, force])

  return (
    <div className="tahi-rich-brief">
      <style>{RICH_BRIEF_CSS}</style>
      <div className="tahi-rich-brief-tools" role="group" aria-label="Brief formatting">
        <BriefTool
          label="Bold"
          active={!!editor?.isActive('bold')}
          onPress={() => editor?.chain().focus().toggleBold().run()}
        >
          <Bold size={15} aria-hidden="true" />
        </BriefTool>
        <BriefTool
          label="Italic"
          active={!!editor?.isActive('italic')}
          onPress={() => editor?.chain().focus().toggleItalic().run()}
        >
          <Italic size={15} aria-hidden="true" />
        </BriefTool>
        <span className="tahi-rich-brief-div" aria-hidden="true" />
        <BriefTool
          label="Bulleted list"
          active={!!editor?.isActive('bulletList')}
          onPress={() => editor?.chain().focus().toggleBulletList().run()}
        >
          <List size={15} aria-hidden="true" />
        </BriefTool>
        <BriefTool
          label="Add link"
          active={!!editor?.isActive('link')}
          onPress={() => { if (editor) promptForBriefLink(editor) }}
        >
          <LinkIcon size={15} aria-hidden="true" />
        </BriefTool>
      </div>
      {editor ? <EditorContent editor={editor} /> : null}
    </div>
  )
}

/**
 * A saved brief, read. Drop this in wherever a stored `requests.description`
 * is rendered so bullets, links and emphasis survive the trip out of the
 * editor. The portal POST sanitises on the way in; this component runs the
 * same allowlist again on the way out, so a description that arrived through
 * any other writer (the admin routes, the MCP worker, an AI draft, an old
 * plain-text row) can never carry markup past the allowlist into the page.
 */
export function RichBriefProse({
  html, className, style,
}: {
  html: string
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <>
      <style>{RICH_BRIEF_PROSE_CSS}</style>
      <div
        className={['tahi-brief-prose', className].filter(Boolean).join(' ')}
        style={style}
        dangerouslySetInnerHTML={{ __html: sanitizeRichText(html) }}
      />
    </>
  )
}

function BriefTool({
  label, active, onPress, children,
}: {
  label: string
  active: boolean
  onPress: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className="tahi-rich-brief-tool tahi-focus-ring"
      data-active={active ? 'true' : undefined}
      aria-pressed={active}
      title={label}
      aria-label={label}
      // Keep the caret where it is: a mousedown on a toolbar button would
      // otherwise blur the editor and collapse the selection being styled.
      onMouseDown={e => e.preventDefault()}
      onClick={onPress}
    >
      {children}
    </button>
  )
}

function promptForBriefLink(editor: Editor) {
  if (typeof window === 'undefined') return
  const previous = editor.getAttributes('link').href as string | undefined
  const url = window.prompt('Link URL', previous ?? 'https://')
  if (url === null) return
  if (url.trim() === '') {
    editor.chain().focus().extendMarkRange('link').unsetLink().run()
    return
  }
  const href = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`
  editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
}
