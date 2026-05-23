'use client'

/**
 * <TiptapDocEditor>. The docs-hub rich text editor.
 *
 * Notion / Linear style affordances:
 *   - Top toolbar with heading dropdown, marks, lists, task list,
 *     blockquote, code block, link, image, divider, undo/redo.
 *   - Bubble menu on text selection (bold / italic / strike / code / link).
 *   - Slash command menu — type "/" on an empty line and pick a block
 *     type from the popover (heading levels, lists, task list, quote,
 *     code, divider, image).
 *   - Task lists with checkboxes.
 *   - Image inserts via URL prompt (paste-from-clipboard is browser-
 *     default and Tiptap's Image extension handles dropped URLs).
 *   - Body content is styled with .tahi-doc-prose so the editor
 *     preview matches the rendered view-mode output exactly.
 */

import * as React from 'react'
import { useEditor, EditorContent, Extension, posToDOMRect, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import LinkExtension from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Image from '@tiptap/extension-image'
import Suggestion from '@tiptap/suggestion'
import {
  Bold, Italic, Strikethrough, Code, Code2, Link as LinkIcon, List, ListOrdered,
  ListChecks, Quote, Minus, Heading1, Heading2, Heading3, Image as ImageIcon,
  Undo2, Redo2, ChevronDown, Text, Hash, Image as ImageBlock,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Popover } from '@/components/tahi/popover'

interface TiptapDocEditorProps {
  content: string
  onChange: (html: string) => void
  placeholder?: string
}

// ── Slash command items ─────────────────────────────────────────────

interface SlashItem {
  id: string
  label: string
  description: string
  icon: LucideIcon
  match: string[]
  command: (editor: Editor, range: { from: number; to: number }) => void
}

const SLASH_ITEMS: SlashItem[] = [
  {
    id: 'p',
    label: 'Text',
    description: 'Just start writing with plain text',
    icon: Text,
    match: ['text', 'paragraph', 'p'],
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setParagraph().run()
    },
  },
  {
    id: 'h1',
    label: 'Heading 1',
    description: 'Big section heading',
    icon: Heading1,
    match: ['h1', 'heading 1', 'title'],
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run()
    },
  },
  {
    id: 'h2',
    label: 'Heading 2',
    description: 'Medium section heading',
    icon: Heading2,
    match: ['h2', 'heading 2'],
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run()
    },
  },
  {
    id: 'h3',
    label: 'Heading 3',
    description: 'Small section heading',
    icon: Heading3,
    match: ['h3', 'heading 3'],
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run()
    },
  },
  {
    id: 'bullet',
    label: 'Bulleted list',
    description: 'A simple bulleted list',
    icon: List,
    match: ['bullet', 'list', 'ul', 'unordered'],
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run()
    },
  },
  {
    id: 'numbered',
    label: 'Numbered list',
    description: 'A list with numbering',
    icon: ListOrdered,
    match: ['numbered', 'ordered', 'ol', '1.', 'number'],
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run()
    },
  },
  {
    id: 'task',
    label: 'To-do list',
    description: 'Track tasks with checkboxes',
    icon: ListChecks,
    match: ['task', 'todo', 'check', 'checklist'],
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleTaskList().run()
    },
  },
  {
    id: 'quote',
    label: 'Quote',
    description: 'Capture a quote',
    icon: Quote,
    match: ['quote', 'blockquote', '>'],
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleBlockquote().run()
    },
  },
  {
    id: 'code',
    label: 'Code block',
    description: 'Capture a code snippet',
    icon: Code2,
    match: ['code', 'codeblock', 'snippet'],
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run()
    },
  },
  {
    id: 'divider',
    label: 'Divider',
    description: 'Visually divide blocks',
    icon: Minus,
    match: ['divider', 'hr', 'horizontal rule', 'separator'],
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setHorizontalRule().run()
    },
  },
  {
    id: 'image',
    label: 'Image',
    description: 'Embed an image by URL',
    icon: ImageBlock,
    match: ['image', 'img', 'picture'],
    command: (editor, range) => {
      const url = typeof window !== 'undefined' ? window.prompt('Image URL') : null
      if (url) {
        editor.chain().focus().deleteRange(range).setImage({ src: url }).run()
      } else {
        editor.chain().focus().deleteRange(range).run()
      }
    },
  },
]

function filterSlashItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return SLASH_ITEMS
  return SLASH_ITEMS.filter(item =>
    item.label.toLowerCase().includes(q) ||
    item.match.some(m => m.toLowerCase().includes(q))
  )
}

// ── Slash command extension ────────────────────────────────────────

interface SlashRendererHandle {
  onStart: (props: { items: SlashItem[]; command: (item: SlashItem) => void; clientRect?: (() => DOMRect | null) | null }) => void
  onUpdate: (props: { items: SlashItem[]; command: (item: SlashItem) => void; clientRect?: (() => DOMRect | null) | null }) => void
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
  onExit: () => void
}

function createSlashRenderer(): () => SlashRendererHandle {
  return () => {
    let popup: HTMLDivElement | null = null
    let items: SlashItem[] = []
    let selectedIndex = 0
    let commandFn: ((item: SlashItem) => void) | null = null

    const render = () => {
      if (!popup) return
      if (items.length === 0) {
        popup.innerHTML = `<div style="padding:0.625rem 0.875rem;font-size:0.75rem;color:var(--color-text-subtle)">No matches</div>`
        return
      }
      const html = items.map((item, i) => {
        const active = i === selectedIndex
        return `
          <button type="button" data-index="${i}" class="tahi-focus-ring" style="
            display: flex; align-items: center; gap: 0.5rem;
            width: 100%; padding: 0.4375rem 0.625rem;
            background: ${active ? 'var(--color-bg-secondary)' : 'transparent'};
            border: none; border-radius: var(--radius-sm);
            cursor: pointer; text-align: left;
          ">
            <span style="
              display: inline-flex; align-items: center; justify-content: center;
              width: 1.75rem; height: 1.75rem; flex-shrink: 0;
              background: var(--color-bg-tertiary); color: var(--color-text-muted);
              border-radius: var(--radius-sm);
            ">${iconSvg(item.id)}</span>
            <span style="flex: 1; min-width: 0;">
              <span style="display: block; font-size: 0.8125rem; font-weight: 600; color: var(--color-text);">${escapeHtml(item.label)}</span>
              <span style="display: block; font-size: 0.6875rem; color: var(--color-text-subtle);">${escapeHtml(item.description)}</span>
            </span>
          </button>
        `
      }).join('')
      popup.innerHTML = html
      popup.querySelectorAll('button[data-index]').forEach(el => {
        el.addEventListener('mousedown', (e) => {
          e.preventDefault()
          const idx = parseInt(el.getAttribute('data-index') ?? '0', 10)
          if (commandFn && items[idx]) commandFn(items[idx])
        })
        el.addEventListener('mouseenter', () => {
          selectedIndex = parseInt(el.getAttribute('data-index') ?? '0', 10)
          render()
        })
      })
    }

    const position = (clientRect?: (() => DOMRect | null) | null) => {
      if (!popup || !clientRect) return
      const r = clientRect()
      if (!r) return
      popup.style.left = `${r.left}px`
      popup.style.top = `${r.bottom + 6}px`
    }

    return {
      onStart: (props) => {
        items = props.items
        commandFn = props.command
        selectedIndex = 0
        popup = document.createElement('div')
        popup.style.cssText = [
          'position:fixed', 'z-index:80',
          'background:var(--color-bg)',
          'border:1px solid var(--color-border)',
          'border-radius:var(--radius-card)',
          'padding:0.25rem',
          'box-shadow:var(--shadow-lg)',
          'max-height:20rem', 'overflow-y:auto',
          'min-width:16rem', 'max-width:20rem',
        ].join(';')
        // Prevent mousedown on the popup body from blurring the editor.
        popup.addEventListener('mousedown', (e) => e.preventDefault())
        document.body.appendChild(popup)
        position(props.clientRect)
        render()
      },
      onUpdate: (props) => {
        items = props.items
        commandFn = props.command
        selectedIndex = 0
        position(props.clientRect)
        render()
      },
      onKeyDown: ({ event }) => {
        if (!items.length) return false
        if (event.key === 'ArrowDown') {
          selectedIndex = (selectedIndex + 1) % items.length
          render()
          return true
        }
        if (event.key === 'ArrowUp') {
          selectedIndex = (selectedIndex - 1 + items.length) % items.length
          render()
          return true
        }
        if (event.key === 'Enter') {
          if (commandFn && items[selectedIndex]) commandFn(items[selectedIndex])
          return true
        }
        if (event.key === 'Escape') {
          popup?.remove()
          popup = null
          return true
        }
        return false
      },
      onExit: () => {
        popup?.remove()
        popup = null
      },
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] ?? c))
}

// Inline SVG for slash-menu icons. Lucide paths kept short so the
// popup stays a vanilla DOM tree (no React reconciler inside it).
function iconSvg(id: string): string {
  const common = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13" viewBox="0 0 24 24"'
  switch (id) {
    case 'p':        return `<svg ${common}><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/></svg>`
    case 'h1':       return `<svg ${common}><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="m17 12 3-2v8"/></svg>`
    case 'h2':       return `<svg ${common}><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1"/></svg>`
    case 'h3':       return `<svg ${common}><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2"/><path d="M17 17.5c2 1.5 4 .3 4-1.5a2 2 0 0 0-2-2"/></svg>`
    case 'bullet':   return `<svg ${common}><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>`
    case 'numbered': return `<svg ${common}><line x1="10" x2="21" y1="6" y2="6"/><line x1="10" x2="21" y1="12" y2="12"/><line x1="10" x2="21" y1="18" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg>`
    case 'task':     return `<svg ${common}><path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/></svg>`
    case 'quote':    return `<svg ${common}><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>`
    case 'code':     return `<svg ${common}><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`
    case 'divider':  return `<svg ${common}><line x1="5" x2="19" y1="12" y2="12"/></svg>`
    case 'image':    return `<svg ${common}><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`
    default:         return ''
  }
}

const SlashCommand = Extension.create({
  name: 'slashCommand',
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: '/',
        startOfLine: false,
        allowSpaces: false,
        items: ({ query }: { query: string }) => filterSlashItems(query),
        command: ({ editor, range, props }: { editor: Editor; range: { from: number; to: number }; props: SlashItem }) => {
          props.command(editor, range)
        },
        render: createSlashRenderer(),
      }),
    ]
  },
})

// ── Editor ─────────────────────────────────────────────────────────

export function TiptapDocEditor({
  content,
  onChange,
  placeholder = 'Type / to insert a block, or just start writing...',
}: TiptapDocEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      LinkExtension.configure({
        openOnClick: false,
        HTMLAttributes: { class: 'tahi-doc-link' },
      }),
      Placeholder.configure({
        placeholder: ({ node }) => {
          if (node.type.name === 'heading') return `Heading ${node.attrs.level}`
          return placeholder
        },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Image.configure({
        HTMLAttributes: { class: 'tahi-doc-image' },
      }),
      SlashCommand,
    ],
    content,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'tahi-doc-prose tahi-doc-editor focus:outline-none min-h-[24rem] p-5',
      },
    },
    onUpdate: ({ editor: e }) => {
      onChange(e.getHTML())
    },
  })

  // Selection-based bubble menu. Tracks the current text selection
  // and positions a floating toolbar above it when non-empty. Hidden
  // when the selection collapses, leaves the editor, or sits inside
  // a code block (where most marks don't apply).
  const [bubble, setBubble] = React.useState<{ x: number; y: number } | null>(null)
  React.useEffect(() => {
    if (!editor) return
    const updateBubble = () => {
      const { selection, doc } = editor.state
      if (selection.empty) { setBubble(null); return }
      if (editor.isActive('codeBlock')) { setBubble(null); return }
      const text = doc.textBetween(selection.from, selection.to, ' ')
      if (!text.trim()) { setBubble(null); return }
      const rect = posToDOMRect(editor.view, selection.from, selection.to)
      // Position above the selection. Clamp to viewport.
      const x = Math.max(8, Math.min(window.innerWidth - 320, rect.left + (rect.width / 2)))
      const y = Math.max(56, rect.top - 8)
      setBubble({ x, y })
    }
    const blur = () => setBubble(null)
    editor.on('selectionUpdate', updateBubble)
    editor.on('transaction', updateBubble)
    editor.on('blur', blur)
    return () => {
      editor.off('selectionUpdate', updateBubble)
      editor.off('transaction', updateBubble)
      editor.off('blur', blur)
    }
  }, [editor])

  const headingMenuRef = React.useRef<HTMLButtonElement | null>(null)
  const [headingOpen, setHeadingOpen] = React.useState(false)

  if (!editor) return null

  const currentBlock: { label: string; icon: LucideIcon } = (() => {
    if (editor.isActive('heading', { level: 1 })) return { label: 'Heading 1', icon: Heading1 }
    if (editor.isActive('heading', { level: 2 })) return { label: 'Heading 2', icon: Heading2 }
    if (editor.isActive('heading', { level: 3 })) return { label: 'Heading 3', icon: Heading3 }
    return { label: 'Text', icon: Text }
  })()
  const CurrentIcon = currentBlock.icon

  return (
    <div
      style={{
        position: 'relative',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.0625rem',
          flexWrap: 'wrap',
          padding: '0.375rem 0.5rem',
          borderBottom: '1px solid var(--color-border-subtle)',
          background: 'var(--color-bg-secondary)',
        }}
      >
        {/* Block-type dropdown */}
        <button
          ref={headingMenuRef}
          type="button"
          onClick={() => setHeadingOpen(o => !o)}
          aria-haspopup="menu"
          aria-expanded={headingOpen}
          className="tahi-focus-ring"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.3125rem',
            padding: '0.25rem 0.5rem',
            background: 'transparent',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.75rem',
            fontWeight: 500,
            color: 'var(--color-text)',
            cursor: 'pointer',
            transition: 'background-color 120ms ease',
            minWidth: '6.5rem',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
        >
          <CurrentIcon size={13} aria-hidden="true" />
          <span style={{ flex: 1, textAlign: 'left' }}>{currentBlock.label}</span>
          <ChevronDown size={11} aria-hidden="true" />
        </button>
        <Popover
          anchorRef={headingMenuRef}
          open={headingOpen}
          onClose={() => setHeadingOpen(false)}
          align="start"
          width="11rem"
        >
          <div role="menu">
            <BlockMenuItem
              icon={<Text size={13} />}
              label="Text"
              active={currentBlock.label === 'Text'}
              onClick={() => { editor.chain().focus().setParagraph().run(); setHeadingOpen(false) }}
            />
            <BlockMenuItem
              icon={<Heading1 size={13} />}
              label="Heading 1"
              active={editor.isActive('heading', { level: 1 })}
              onClick={() => { editor.chain().focus().setNode('heading', { level: 1 }).run(); setHeadingOpen(false) }}
            />
            <BlockMenuItem
              icon={<Heading2 size={13} />}
              label="Heading 2"
              active={editor.isActive('heading', { level: 2 })}
              onClick={() => { editor.chain().focus().setNode('heading', { level: 2 }).run(); setHeadingOpen(false) }}
            />
            <BlockMenuItem
              icon={<Heading3 size={13} />}
              label="Heading 3"
              active={editor.isActive('heading', { level: 3 })}
              onClick={() => { editor.chain().focus().setNode('heading', { level: 3 }).run(); setHeadingOpen(false) }}
            />
          </div>
        </Popover>

        <ToolbarDivider />
        <ToolbarBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold (Cmd/Ctrl+B)">
          <Bold size={13} />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic">
          <Italic size={13} />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Strikethrough">
          <Strikethrough size={13} />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive('code')} title="Inline code">
          <Code size={13} />
        </ToolbarBtn>

        <ToolbarDivider />
        <ToolbarBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bulleted list">
          <List size={13} />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered list">
          <ListOrdered size={13} />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleTaskList().run()} active={editor.isActive('taskList')} title="To-do list">
          <ListChecks size={13} />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Quote">
          <Quote size={13} />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive('codeBlock')} title="Code block">
          <Code2 size={13} />
        </ToolbarBtn>

        <ToolbarDivider />
        <ToolbarBtn
          onClick={() => {
            const url = window.prompt('Link URL', editor.getAttributes('link').href ?? 'https://')
            if (url === null) return
            if (url === '') {
              editor.chain().focus().extendMarkRange('link').unsetLink().run()
            } else {
              editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
            }
          }}
          active={editor.isActive('link')}
          title="Link"
        >
          <LinkIcon size={13} />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => {
            const url = window.prompt('Image URL')
            if (url) editor.chain().focus().setImage({ src: url }).run()
          }}
          active={false}
          title="Image"
        >
          <ImageIcon size={13} />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          active={false}
          title="Divider"
        >
          <Minus size={13} />
        </ToolbarBtn>

        <div style={{ flex: 1 }} />

        <ToolbarBtn onClick={() => editor.chain().focus().undo().run()} active={false} disabled={!editor.can().undo()} title="Undo">
          <Undo2 size={13} />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().redo().run()} active={false} disabled={!editor.can().redo()} title="Redo">
          <Redo2 size={13} />
        </ToolbarBtn>
        <span style={{
          marginLeft: '0.4375rem',
          fontSize: '0.625rem',
          color: 'var(--color-text-subtle)',
          fontWeight: 500,
        }}>
          <Hash size={9} style={{ display: 'inline', marginRight: '0.1875rem', verticalAlign: 'text-top' }} aria-hidden="true" />
          Type <kbd style={kbdStyle}>/</kbd> for commands
        </span>
      </div>

      {/* Editor surface */}
      <EditorContent editor={editor} />

      {/* Bubble menu */}
      {bubble && (
        <div
          style={{
            position: 'fixed',
            left: bubble.x,
            top: bubble.y,
            transform: 'translate(-50%, -100%)',
            zIndex: 80,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.0625rem',
            padding: '0.25rem',
            background: '#1f2924',
            border: '1px solid #2d3d2a',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          <BubbleBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} label="Bold"><Bold size={12} /></BubbleBtn>
          <BubbleBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} label="Italic"><Italic size={12} /></BubbleBtn>
          <BubbleBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} label="Strikethrough"><Strikethrough size={12} /></BubbleBtn>
          <BubbleBtn onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive('code')} label="Inline code"><Code size={12} /></BubbleBtn>
          <BubbleBtn
            onClick={() => {
              const url = window.prompt('Link URL', editor.getAttributes('link').href ?? 'https://')
              if (url === null) return
              if (url === '') {
                editor.chain().focus().extendMarkRange('link').unsetLink().run()
              } else {
                editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
              }
            }}
            active={editor.isActive('link')}
            label="Link"
          ><LinkIcon size={12} /></BubbleBtn>
        </div>
      )}
    </div>
  )
}

// ── Toolbar bits ───────────────────────────────────────────────────

function ToolbarBtn({
  children,
  onClick,
  active,
  disabled,
  title,
}: {
  children: React.ReactNode
  onClick: () => void
  active?: boolean
  disabled?: boolean
  title: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={cn(
        'tahi-focus-ring inline-flex items-center justify-center',
      )}
      style={{
        width: '1.75rem',
        height: '1.75rem',
        background: active ? 'var(--color-bg-tertiary)' : 'transparent',
        border: 'none',
        borderRadius: 'var(--radius-sm)',
        color: active ? 'var(--color-text)' : 'var(--color-text-muted)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        transition: 'background-color 120ms ease, color 120ms ease',
      }}
      onMouseEnter={e => {
        if (disabled || active) return
        e.currentTarget.style.background = 'var(--color-bg)'
        e.currentTarget.style.color = 'var(--color-text)'
      }}
      onMouseLeave={e => {
        if (active) return
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.color = 'var(--color-text-muted)'
      }}
    >
      {children}
    </button>
  )
}

function ToolbarDivider() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: 1,
        height: '1rem',
        background: 'var(--color-border)',
        margin: '0 0.25rem',
      }}
    />
  )
}

function BlockMenuItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="w-full inline-flex items-center tahi-focus-ring"
      style={{
        gap: '0.4375rem',
        padding: '0.4375rem 0.625rem',
        background: active ? 'var(--color-bg-secondary)' : 'transparent',
        border: 'none',
        borderRadius: 'var(--radius-sm)',
        fontSize: 'var(--text-sm)',
        color: 'var(--color-text)',
        cursor: 'pointer',
        textAlign: 'left',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
      onMouseLeave={e => { e.currentTarget.style.background = active ? 'var(--color-bg-secondary)' : 'transparent' }}
    >
      <span style={{ color: 'var(--color-text-muted)', display: 'inline-flex' }}>{icon}</span>
      {label}
    </button>
  )
}

function BubbleBtn({
  children,
  onClick,
  active,
  label,
}: {
  children: React.ReactNode
  onClick: () => void
  active?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '1.75rem',
        height: '1.75rem',
        background: active ? '#3a4d34' : 'transparent',
        border: 'none',
        borderRadius: 'var(--radius-sm)',
        color: active ? '#ffffff' : '#cdddca',
        cursor: 'pointer',
        transition: 'background-color 120ms ease, color 120ms ease',
      }}
      onMouseEnter={e => {
        if (!active) {
          e.currentTarget.style.background = '#2a3826'
          e.currentTarget.style.color = '#ffffff'
        }
      }}
      onMouseLeave={e => {
        if (!active) {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.color = '#cdddca'
        }
      }}
    >
      {children}
    </button>
  )
}

const kbdStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '0 0.25rem',
  fontFamily: 'inherit',
  fontSize: '0.6875rem',
  fontWeight: 600,
  background: 'var(--color-bg)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: '0.1875rem',
  color: 'var(--color-text)',
}
