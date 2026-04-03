'use client'

import React, { useRef, useState } from 'react'
import { apiPath } from '@/lib/api'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import Mention from '@tiptap/extension-mention'
import {
  Bold, Italic, List, ListOrdered, Code, Link as LinkIcon,
  CornerDownLeft, Loader2, Paperclip, X, FileText, Image as ImageIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

interface AttachedFile {
  fileId: string
  storageKey: string
  filename: string
  mimeType: string
  sizeBytes: number
  status: 'uploading' | 'done' | 'error'
}

interface TiptapEditorProps {
  onSubmit: (html: string, json: unknown) => Promise<void>
  isInternal?: boolean
  onInternalToggle?: (v: boolean) => void
  placeholder?: string
  isAdmin?: boolean
  /** If provided, enables file attachments (required for upload confirm step) */
  requestId?: string
  /** Org ID for admin uploads on behalf of a client */
  orgId?: string
}

// ── Upload helpers ─────────────────────────────────────────────────────────────

async function uploadFile(
  file: File,
  requestId?: string,
  orgId?: string,
): Promise<AttachedFile> {
  // Step 1: Presign
  const presignRes = await fetch(apiPath('/api/uploads/presign'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: file.name, mimeType: file.type, requestId }),
  })
  if (!presignRes.ok) throw new Error('Presign failed')
  const { uploadUrl, storageKey, fileId } = await presignRes.json() as {
    uploadUrl: string; storageKey: string; fileId: string
  }

  // Step 2: Upload to proxy
  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  })
  if (!uploadRes.ok) throw new Error('Upload failed')

  // Step 3: Confirm
  const confirmRes = await fetch(apiPath('/api/uploads/confirm'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileId,
      storageKey,
      filename: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      requestId,
      ...(orgId ? { orgId } : {}),
    }),
  })
  if (!confirmRes.ok) throw new Error('Confirm failed')

  return {
    fileId,
    storageKey,
    filename: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    status: 'done',
  }
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function fileIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return <ImageIcon size={12} />
  return <FileText size={12} />
}

// ── Component ──────────────────────────────────────────────────────────────────

export function TiptapEditor({
  onSubmit,
  isInternal = false,
  onInternalToggle,
  placeholder = 'Write a message…',
  isAdmin = false,
  requestId,
  orgId,
}: TiptapEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false }),
      Link.configure({ openOnClick: false, HTMLAttributes: { class: 'underline text-brand' } }),
      Placeholder.configure({ placeholder }),
      Mention.configure({
        HTMLAttributes: {
          class: 'mention',
          style: 'color: var(--color-brand); font-weight: 600; cursor: default;',
        },
        suggestion: {
          char: '@',
          items: async ({ query }: { query: string }) => {
            try {
              const res = await fetch(apiPath('/api/admin/team'))
              if (!res.ok) return []
              const data = await res.json() as { items: Array<{ id: string; name: string; title: string | null }> }
              return data.items
                .filter(m => m.name.toLowerCase().includes(query.toLowerCase()))
                .slice(0, 8)
                .map(m => ({ id: m.id, label: m.name }))
            } catch { return [] }
          },
          render: () => {
            let popup: HTMLDivElement | null = null
            let selectedIndex = 0
            let items: Array<{ id: string; label: string }> = []
            let commandFn: ((item: { id: string; label: string }) => void) | null = null

            function updatePopup() {
              if (!popup) return
              popup.innerHTML = items.map((item, i) =>
                `<div class="mention-item${i === selectedIndex ? ' selected' : ''}" data-index="${i}" style="padding: 0.375rem 0.75rem; cursor: pointer; font-size: 0.8125rem; color: var(--color-text); border-radius: 0.25rem; ${i === selectedIndex ? 'background: var(--color-bg-tertiary); font-weight: 600;' : ''}">${item.label}</div>`
              ).join('')
              popup.querySelectorAll('.mention-item').forEach(el => {
                el.addEventListener('mouseenter', () => {
                  selectedIndex = parseInt(el.getAttribute('data-index') ?? '0')
                  updatePopup()
                })
                el.addEventListener('click', () => {
                  const idx = parseInt(el.getAttribute('data-index') ?? '0')
                  if (commandFn && items[idx]) commandFn(items[idx])
                })
              })
            }

            return {
              onStart: (props: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
                items = props.items
                commandFn = props.command
                selectedIndex = 0
                popup = document.createElement('div')
                popup.style.cssText = 'position: fixed; z-index: 50; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: 0.5rem; padding: 0.25rem; box-shadow: 0 4px 12px rgba(0,0,0,0.1); max-height: 12rem; overflow-y: auto; min-width: 10rem;'
                const rect = props.clientRect?.()
                if (rect) {
                  popup.style.left = `${rect.left}px`
                  popup.style.top = `${rect.bottom + 4}px`
                }
                updatePopup()
                document.body.appendChild(popup)
              },
              onUpdate: (props: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
                items = props.items
                selectedIndex = 0
                const rect = props.clientRect?.()
                if (rect && popup) {
                  popup.style.left = `${rect.left}px`
                  popup.style.top = `${rect.bottom + 4}px`
                }
                updatePopup()
              },
              onKeyDown: (props: { event: KeyboardEvent }) => {
                if (props.event.key === 'ArrowDown') { selectedIndex = (selectedIndex + 1) % items.length; updatePopup(); return true }
                if (props.event.key === 'ArrowUp') { selectedIndex = (selectedIndex - 1 + items.length) % items.length; updatePopup(); return true }
                if (props.event.key === 'Enter') { if (commandFn && items[selectedIndex]) commandFn(items[selectedIndex]); return true }
                if (props.event.key === 'Escape') { popup?.remove(); popup = null; return true }
                return false
              },
              onExit: () => { popup?.remove(); popup = null },
            }
          },
        },
      }),
    ],
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none min-h-[80px] p-3 text-sm',
      },
    },
  })

  const [submitting, setSubmitting] = useState(false)
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const canAttach = !!requestId

  // ── File pick handler ──────────────────────────────────────────────────────

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    e.target.value = '' // reset so same file can be re-picked

    for (const file of files) {
      // Add placeholder "uploading" entry
      const placeholderId = crypto.randomUUID()
      const placeholder: AttachedFile = {
        fileId: placeholderId,
        storageKey: '',
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        status: 'uploading',
      }
      setAttachedFiles(prev => [...prev, placeholder])

      try {
        const done = await uploadFile(file, requestId, orgId)
        // Replace placeholder with confirmed file
        setAttachedFiles(prev =>
          prev.map(f => f.fileId === placeholderId ? { ...done, status: 'done' } : f)
        )
      } catch {
        setAttachedFiles(prev =>
          prev.map(f => f.fileId === placeholderId ? { ...f, status: 'error' } : f)
        )
      }
    }
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (!editor) return
    const hasText = !editor.isEmpty
    const hasFiles = attachedFiles.some(f => f.status === 'done')
    if (!hasText && !hasFiles) return

    // Block if any file still uploading
    if (attachedFiles.some(f => f.status === 'uploading')) return

    setSubmitting(true)
    try {
      await onSubmit(editor.getHTML(), editor.getJSON())
      editor.commands.clearContent()
      setAttachedFiles([])
    } finally {
      setSubmitting(false)
    }
  }

  // Cmd/Ctrl+Enter submits
  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      void handleSubmit()
    }
  }

  if (!editor) return null

  const isEmpty = editor.isEmpty && attachedFiles.length === 0
  const isUploading = attachedFiles.some(f => f.status === 'uploading')

  return (
    <div
      className={cn(
        'rounded-[0_12px_0_12px] border bg-[var(--color-bg)] overflow-hidden',
        isInternal ? 'border-amber-300 bg-amber-50/30 dark:bg-amber-950/30' : 'border-[var(--color-border)]',
      )}
      onKeyDown={handleKeyDown}
    >
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-[var(--color-border-subtle)]">
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
        <div className="w-px h-4 bg-[var(--color-border-subtle)] mx-1" />
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
        <div className="w-px h-4 bg-[var(--color-border-subtle)] mx-1" />
        <ToolbarBtn
          onClick={() => {
            const url = window.prompt('URL:')
            if (url) editor.chain().focus().setLink({ href: url }).run()
          }}
          active={editor.isActive('link')}
          title="Add link"
        >
          <LinkIcon size={14} />
        </ToolbarBtn>

        {canAttach && (
          <>
            <div className="w-px h-4 bg-[var(--color-border-subtle)] mx-1" />
            <ToolbarBtn
              onClick={() => fileInputRef.current?.click()}
              active={false}
              title="Attach file"
            >
              <Paperclip size={14} />
            </ToolbarBtn>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileChange}
              accept="image/*,.pdf,.zip,.docx,.xlsx,.csv,.txt,.mp4,.mov,.webm"
            />
          </>
        )}

        <div className="flex-1" />

        {isAdmin && onInternalToggle && (
          <button
            type="button"
            onClick={() => onInternalToggle(!isInternal)}
            className={cn(
              'text-xs px-2 py-0.5 rounded-full border transition-colors',
              isInternal
                ? 'border-amber-400 bg-amber-100 text-amber-700'
                : 'border-[var(--color-border)] text-[var(--color-text-subtle)] hover:border-[var(--color-border)]'
            )}
          >
            🔒 Internal
          </button>
        )}
      </div>

      {/* Editor */}
      <EditorContent editor={editor} />

      {/* Attached files chips */}
      {attachedFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 px-3 py-2 border-t border-[var(--color-border-subtle)]">
          {attachedFiles.map(f => (
            <div
              key={f.fileId}
              className={cn(
                'flex items-center gap-1.5 px-2 py-1 rounded-full text-xs border',
                f.status === 'error'
                  ? 'bg-red-50 border-red-200 text-red-700'
                  : f.status === 'uploading'
                    ? 'bg-[var(--color-bg-secondary)] border-[var(--color-border)] text-[var(--color-text-muted)]'
                    : 'bg-[var(--color-brand-50)] border-[var(--color-brand-100)] text-[var(--color-brand-dark)]'
              )}
            >
              {f.status === 'uploading' ? (
                <Loader2 size={10} className="animate-spin" />
              ) : (
                fileIcon(f.mimeType)
              )}
              <span className="max-w-[120px] truncate">{f.filename}</span>
              {f.status === 'done' && (
                <span className="text-[10px] opacity-60">{formatBytes(f.sizeBytes)}</span>
              )}
              {f.status === 'error' && <span className="text-[10px]">failed</span>}
              {f.status !== 'uploading' && (
                <button
                  type="button"
                  onClick={() => setAttachedFiles(prev => prev.filter(x => x.fileId !== f.fileId))}
                  className="ml-0.5 opacity-60 hover:opacity-100"
                >
                  <X size={10} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-secondary)]">
        <span className="text-xs text-[var(--color-text-subtle)]">
          {isUploading ? 'Uploading…' : '⌘↵ to send'}
        </span>
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={submitting || isEmpty || isUploading}
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

// ── Toolbar button ─────────────────────────────────────────────────────────────

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
          : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text)]',
      )}
    >
      {children}
    </button>
  )
}
