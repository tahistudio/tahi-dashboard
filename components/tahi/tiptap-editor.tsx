'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import {
  Bold, Italic, List, ListOrdered, Code, Link as LinkIcon,
  CornerDownLeft, Loader2
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface TiptapEditorProps {
  onSubmit: (html: string, json: unknown) => Promise<void>
  isInternal?: boolean
  onInternalToggle?: (v: boolean) => void
  placeholder?: string
  isAdmin?: boolean
}

export function TiptapEditor({
  onSubmit,
  isInternal = false,
  onInternalToggle,
  placeholder = 'Write a message…',
  isAdmin = false,
}: TiptapEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false }),
      Link.configure({ openOnClick: false, HTMLAttributes: { class: 'underline text-brand' } }),
      Placeholder.configure({ placeholder }),
    ],
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none min-h-[80px] p-3 text-sm',
      },
    },
  })

  const [submitting, setSubmitting] = React.useState(false)

  async function handleSubmit() {
    if (!editor || editor.isEmpty) return
    setSubmitting(true)
    try {
      await onSubmit(editor.getHTML(), editor.getJSON())
      editor.commands.clearContent()
    } finally {
      setSubmitting(false)
    }
  }

  // Cmd/Ctrl+Enter submits
  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
  }

  if (!editor) return null

  return (
    <div
      className={cn(
        'rounded-[0_12px_0_12px] border bg-white overflow-hidden',
        isInternal ? 'border-amber-300 bg-amber-50/30' : 'border-gray-200',
      )}
      onKeyDown={handleKeyDown}
    >
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-gray-100">
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive('bold')}
          title="Bold"
        >
          <Bold size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive('italic')}
          title="Italic"
        >
          <Italic size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleCode().run()}
          active={editor.isActive('code')}
          title="Inline code"
        >
          <Code size={14} />
        </ToolbarBtn>
        <div className="w-px h-4 bg-gray-200 mx-1" />
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive('bulletList')}
          title="Bullet list"
        >
          <List size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive('orderedList')}
          title="Numbered list"
        >
          <ListOrdered size={14} />
        </ToolbarBtn>
        <div className="w-px h-4 bg-gray-200 mx-1" />
        <ToolbarBtn
          onClick={() => {
            const url = prompt('URL:')
            if (url) editor.chain().focus().setLink({ href: url }).run()
          }}
          active={editor.isActive('link')}
          title="Add link"
        >
          <LinkIcon size={14} />
        </ToolbarBtn>

        <div className="flex-1" />

        {isAdmin && onInternalToggle && (
          <button
            type="button"
            onClick={() => onInternalToggle(!isInternal)}
            className={cn(
              'text-xs px-2 py-0.5 rounded-full border transition-colors',
              isInternal
                ? 'border-amber-400 bg-amber-100 text-amber-700'
                : 'border-gray-200 text-gray-400 hover:border-gray-300'
            )}
          >
            🔒 Internal
          </button>
        )}
      </div>

      {/* Editor */}
      <EditorContent editor={editor} />

      {/* Footer */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100 bg-gray-50/50">
        <span className="text-xs text-gray-400">⌘↵ to send</span>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || editor.isEmpty}
          className={cn(
            'flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg transition-colors',
            'bg-[var(--color-brand)] text-white hover:bg-[var(--color-brand-dark)]',
            'disabled:opacity-40 disabled:cursor-not-allowed',
          )}
        >
          {submitting ? <Loader2 size={14} className="animate-spin" /> : <CornerDownLeft size={14} />}
          Send
        </button>
      </div>
    </div>
  )
}

function ToolbarBtn({
  children,
  onClick,
  active,
  title,
}: {
  children: React.ReactNode
  onClick: () => void
  active?: boolean
  title: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'p-1.5 rounded transition-colors',
        active
          ? 'bg-[var(--color-brand)] text-white'
          : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800',
      )}
    >
      {children}
    </button>
  )
}

// React import needed for useState in client component
import React from 'react'
