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
 * Styles live in RICH_BRIEF_CSS below rather than app/globals.css: the block
 * is component-local the same way kanban-board.tsx keeps KANBAN_CSS, so it
 * ships and dies with the component.
 */

import * as React from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Bold, Italic, List, Link as LinkIcon } from 'lucide-react'

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
  color: var(--color-brand-dark);
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
.tahi-rich-brief-editor.ProseMirror ul{ margin: 0.375rem 0; padding-left: 1.25rem; }
.tahi-rich-brief-editor.ProseMirror li{ margin: 0.125rem 0; }
.tahi-rich-brief-editor.ProseMirror li > p{ margin: 0; }
.tahi-rich-brief-editor.ProseMirror strong{ font-weight: 700; }
.tahi-rich-brief-editor.ProseMirror a{
  color: var(--color-brand-dark);
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
