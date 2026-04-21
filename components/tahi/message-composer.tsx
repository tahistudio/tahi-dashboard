'use client'

/**
 * <MessageComposer> — the thread reply box, V3.
 *
 * Replaces the old <TiptapEditor> with a cleaner interaction model :
 *
 *   - Visibility is a segmented control (Public / Internal) instead of a
 *     confusing 🔒 pill. Always visible to admins, never visible to clients.
 *   - When Internal is active, a persistent banner + amber left border
 *     makes it impossible to mistake for a client-visible reply.
 *   - File attach is DEFERRED until send — files held as local File
 *     objects until the user actually submits the message. No orphans if
 *     the user closes the tab mid-draft. Also supports drag-and-drop onto
 *     the whole composer.
 *   - Cmd/Ctrl+Enter sends. Plain Enter is a new line.
 *   - All colours from design tokens. No hardcoded amber/red Tailwind
 *     classes.
 *
 * Shape :
 *
 *   <MessageComposer
 *     onSubmit={(html, json, attachedFiles, visibility) => ...}
 *     requestId={request.id}
 *     orgId={request.orgId}
 *     clientName={request.orgName}
 *     canBeInternal={isAdmin}          // hides the seg control for clients
 *     defaultVisibility="public"
 *   />
 *
 * The `onSubmit` callback receives the uploaded file metadata so the
 * caller can attach them to the message API call. Upload happens inside
 * this component right before onSubmit is invoked.
 */

import React, { useRef, useState, useCallback, useEffect } from 'react'
import { apiPath } from '@/lib/api'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import LinkExt from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import Mention from '@tiptap/extension-mention'
import {
  Bold, Italic, List, ListOrdered, Code, Link as LinkIcon,
  Paperclip, X, FileText, Image as ImageIcon, Loader2, Send, Lock, Eye,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────────

type Visibility = 'public' | 'internal'

/** A file queued for upload — lives in local state until send. */
interface StagedFile {
  id: string           // client-side uuid so we can key + remove
  file: File           // the raw File object (not uploaded yet)
}

/** Result of uploading a staged file, surfaced to onSubmit. */
export interface UploadedFile {
  fileId: string
  storageKey: string
  filename: string
  mimeType: string
  sizeBytes: number
}

interface MessageComposerProps {
  onSubmit: (html: string, json: unknown, attachedFiles: UploadedFile[], visibility: Visibility) => Promise<void>
  /** Request this message will attach to. Required for file uploads. */
  requestId?: string
  /** Org, passed to the presign endpoint when admin is acting on behalf of a client. */
  orgId?: string
  /** Human name of the client — shown in the Internal banner so the team knows whose eyes they're hiding from. */
  clientName?: string
  /** Hide the Public/Internal segmented control entirely. Default true for admins, false for clients. */
  canBeInternal?: boolean
  /** Initial visibility. Default 'public'. */
  defaultVisibility?: Visibility
  /** Placeholder text in the editor. */
  placeholder?: string
}

// ── File upload helpers ─────────────────────────────────────────────────────

async function presignAndUpload(
  file: File,
  requestId: string | undefined,
  orgId: string | undefined,
): Promise<UploadedFile> {
  // Step 1 : presign
  const presignRes = await fetch(apiPath('/api/uploads/presign'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: file.name, mimeType: file.type, requestId }),
  })
  if (!presignRes.ok) throw new Error('Presign failed')
  const { uploadUrl, storageKey, fileId } = await presignRes.json() as {
    uploadUrl: string; storageKey: string; fileId: string
  }

  // Step 2 : upload to proxy / R2
  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  })
  if (!uploadRes.ok) throw new Error('Upload failed')

  // Step 3 : confirm
  const confirmRes = await fetch(apiPath('/api/uploads/confirm'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileId, storageKey,
      filename: file.name, mimeType: file.type, sizeBytes: file.size,
      requestId,
      ...(orgId ? { orgId } : {}),
    }),
  })
  if (!confirmRes.ok) throw new Error('Confirm failed')

  return {
    fileId, storageKey,
    filename: file.name, mimeType: file.type, sizeBytes: file.size,
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function FileGlyph({ mimeType, size = 13 }: { mimeType: string; size?: number }) {
  if (mimeType.startsWith('image/')) return <ImageIcon size={size} aria-hidden="true" />
  return <FileText size={size} aria-hidden="true" />
}

// ── Component ──────────────────────────────────────────────────────────────

export function MessageComposer({
  onSubmit,
  requestId,
  orgId,
  clientName,
  canBeInternal = false,
  defaultVisibility = 'public',
  placeholder = 'Write a message…',
}: MessageComposerProps) {
  const [visibility, setVisibility] = useState<Visibility>(defaultVisibility)
  const [staged, setStaged] = useState<StagedFile[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /**
   * React doesn't re-render when TipTap's editor content changes, so we
   * mirror the empty state into React state via the editor's `update`
   * callback. Without this, the Send button never lights up when the
   * user types and Cmd+Enter is the only way to dispatch.
   */
  const [isEditorEmpty, setIsEditorEmpty] = useState(true)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isInternal = visibility === 'internal'
  const canAttach = !!requestId

  // ── Tiptap editor ────────────────────────────────────────────────────────
  const editor = useEditor({
    // immediatelyRender:false avoids SSR hydration warnings (Next 15)
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: false }),
      LinkExt.configure({ openOnClick: false, HTMLAttributes: { class: 'underline text-brand' } }),
      Placeholder.configure({ placeholder }),
      Mention.configure({
        HTMLAttributes: {
          class: 'mention',
          style: 'color: var(--color-brand); font-weight: 600; cursor: default;',
        },
        suggestion: {
          char: '@',
          items: async ({ query }) => {
            try {
              const res = await fetch(apiPath('/api/admin/team'))
              if (!res.ok) return []
              const data = await res.json() as { items: Array<{ id: string; name: string }> }
              return data.items
                .filter(m => m.name.toLowerCase().includes(query.toLowerCase()))
                .slice(0, 8)
                .map(m => ({ id: m.id, label: m.name }))
            } catch { return [] }
          },
          // Minimal keyboard popup — same as the old editor.
          render: () => {
            let popup: HTMLDivElement | null = null
            let selectedIndex = 0
            let items: Array<{ id: string; label: string }> = []
            let commandFn: ((item: { id: string; label: string }) => void) | null = null
            function rerender() {
              if (!popup) return
              popup.innerHTML = items.map((item, i) =>
                `<div data-index="${i}" style="padding:0.375rem 0.75rem;cursor:pointer;font-size:0.8125rem;color:var(--color-text);border-radius:0.25rem;${i === selectedIndex ? 'background:var(--color-bg-tertiary);font-weight:600;' : ''}">${item.label}</div>`
              ).join('')
              popup.querySelectorAll('[data-index]').forEach(el => {
                el.addEventListener('mouseenter', () => { selectedIndex = parseInt(el.getAttribute('data-index') ?? '0'); rerender() })
                el.addEventListener('click', () => {
                  const idx = parseInt(el.getAttribute('data-index') ?? '0')
                  if (commandFn && items[idx]) commandFn(items[idx])
                })
              })
            }
            return {
              onStart: (props) => {
                items = props.items as Array<{ id: string; label: string }>
                commandFn = props.command
                selectedIndex = 0
                popup = document.createElement('div')
                popup.style.cssText = 'position:fixed;z-index:50;background:var(--color-bg);border:1px solid var(--color-border);border-radius:0.5rem;padding:0.25rem;box-shadow:var(--shadow-md);max-height:12rem;overflow-y:auto;min-width:10rem;'
                const rect = props.clientRect?.()
                if (rect) { popup.style.left = `${rect.left}px`; popup.style.top = `${rect.bottom + 4}px` }
                rerender()
                document.body.appendChild(popup)
              },
              onUpdate: (props) => {
                items = props.items as Array<{ id: string; label: string }>
                selectedIndex = 0
                const rect = props.clientRect?.()
                if (rect && popup) { popup.style.left = `${rect.left}px`; popup.style.top = `${rect.bottom + 4}px` }
                rerender()
              },
              onKeyDown: ({ event }) => {
                if (event.key === 'ArrowDown') { selectedIndex = (selectedIndex + 1) % items.length; rerender(); return true }
                if (event.key === 'ArrowUp')   { selectedIndex = (selectedIndex - 1 + items.length) % items.length; rerender(); return true }
                if (event.key === 'Enter')     { if (commandFn && items[selectedIndex]) commandFn(items[selectedIndex]); return true }
                if (event.key === 'Escape')    { popup?.remove(); popup = null; return true }
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
        class: 'prose prose-sm max-w-none focus:outline-none',
        style: 'min-height:4.5rem;padding:var(--space-3) var(--space-4);font-size:var(--text-sm);color:var(--color-text);',
      },
    },
    onUpdate: ({ editor }) => {
      // Mirror the editor's empty state into React so the Send button can
      // reactively light up as the user types.
      setIsEditorEmpty(editor.isEmpty)
    },
    onCreate: ({ editor }) => {
      setIsEditorEmpty(editor.isEmpty)
    },
  })

  // ── File pick + drag-drop ────────────────────────────────────────────────
  const addFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files)
    if (!arr.length) return
    setStaged(prev => [
      ...prev,
      ...arr.map(f => ({ id: crypto.randomUUID(), file: f })),
    ])
  }, [])

  const onPick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files)
    e.target.value = ''
  }, [addFiles])

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!canAttach) return
    e.preventDefault()
    e.stopPropagation()
    setDragging(true)
  }, [canAttach])

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.currentTarget === e.target) setDragging(false)
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    if (!canAttach) return
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files)
  }, [canAttach, addFiles])

  const removeFile = useCallback((id: string) => {
    setStaged(prev => prev.filter(f => f.id !== id))
  }, [])

  // ── Submit ─────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!editor) return
    const hasText = !editor.isEmpty
    const hasFiles = staged.length > 0
    if (!hasText && !hasFiles) return
    if (submitting) return

    setSubmitting(true)
    setError(null)
    try {
      // Upload staged files first (sequentially — keeps R2 happy + simple error path)
      const uploaded: UploadedFile[] = []
      for (const { file } of staged) {
        try {
          const result = await presignAndUpload(file, requestId, orgId)
          uploaded.push(result)
        } catch {
          throw new Error(`Failed to upload ${file.name}`)
        }
      }

      await onSubmit(editor.getHTML(), editor.getJSON(), uploaded, visibility)
      editor.commands.clearContent()
      setStaged([])
      setIsEditorEmpty(true) // editor.commands.clearContent() fires onUpdate, but set it explicitly in case the listener races
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send')
    } finally {
      setSubmitting(false)
    }
  }, [editor, staged, submitting, onSubmit, requestId, orgId, visibility])

  // ── Cmd/Ctrl+Enter to send; Enter = newline (default) ──────────────────
  useEffect(() => {
    if (!editor) return
    const view = editor.view
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        void handleSubmit()
      }
    }
    view.dom.addEventListener('keydown', handler)
    return () => view.dom.removeEventListener('keydown', handler)
  }, [editor, handleSubmit])

  if (!editor) return null

  // Use the React-mirrored isEditorEmpty so this re-renders as the user
  // types. Reading `editor.isEmpty` directly would stay stale until the
  // next unrelated re-render.
  const isEmpty = isEditorEmpty && staged.length === 0

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        position: 'relative',
        background: 'var(--color-bg)',
        border: `1px solid ${isInternal ? 'var(--status-in-review-border)' : 'var(--color-border)'}`,
        borderLeft: isInternal
          ? `4px solid var(--status-in-review-dot)`
          : `1px solid var(--color-border)`,
        borderRadius: 'var(--radius-lg)',
        transition: 'border-color 150ms ease',
      }}
    >
      {/* Internal banner — ALWAYS present when internal so users never post internal by accident */}
      {isInternal && (
        <div
          style={{
            padding: 'var(--space-2) var(--space-4)',
            background: 'var(--status-in-review-bg)',
            color: 'var(--status-in-review-text)',
            fontSize: 'var(--text-xs)',
            borderTopLeftRadius: 'calc(var(--radius-lg) - 4px)',
            borderTopRightRadius: 'var(--radius-lg)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
          }}
          role="status"
          aria-live="polite"
        >
          <Lock size={12} aria-hidden="true" />
          <span>
            Internal note. {clientName ? `${clientName} won't see this.` : 'Only your team will see this.'}
          </span>
        </div>
      )}

      {/* Visibility segmented control (admin only) */}
      {canBeInternal && (
        <div
          style={{
            padding: 'var(--space-2) var(--space-3)',
            borderBottom: '1px solid var(--color-border-subtle)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
          }}
        >
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontWeight: 500 }}>Visibility:</span>
          <div
            role="radiogroup"
            aria-label="Message visibility"
            style={{
              display: 'inline-flex',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              overflow: 'hidden',
            }}
          >
            {[
              { value: 'public' as const,   label: 'Public',   Icon: Eye,  tooltip: 'Client can see this' },
              { value: 'internal' as const, label: 'Internal', Icon: Lock, tooltip: 'Team only' },
            ].map(({ value, label, Icon }) => {
              const active = visibility === value
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setVisibility(value)}
                  style={{
                    padding: '0.3125rem 0.625rem',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 'var(--space-1-5)',
                    fontSize: 'var(--text-xs)',
                    fontWeight: 500,
                    background: active
                      ? value === 'internal' ? 'var(--status-in-review-bg)' : 'var(--color-brand-50)'
                      : 'var(--color-bg)',
                    color: active
                      ? value === 'internal' ? 'var(--status-in-review-text)' : 'var(--color-brand)'
                      : 'var(--color-text-muted)',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'background 150ms ease, color 150ms ease',
                  }}
                >
                  <Icon size={12} aria-hidden="true" />
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Editor body */}
      <EditorContent editor={editor} />

      {/* Drag-drop overlay */}
      {dragging && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            background: 'var(--color-brand-50)',
            border: '2px dashed var(--color-brand)',
            borderRadius: 'var(--radius-lg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-brand-dark)',
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            pointerEvents: 'none',
            zIndex: 2,
          }}
        >
          Drop to attach
        </div>
      )}

      {/* Staged files row */}
      {staged.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--space-2)',
            padding: 'var(--space-2) var(--space-3)',
            borderTop: '1px solid var(--color-border-subtle)',
          }}
        >
          {staged.map(s => (
            <span
              key={s.id}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--space-1-5)',
                padding: '0.25rem 0.5rem',
                fontSize: 'var(--text-xs)',
                borderRadius: 'var(--radius-full)',
                background: 'var(--color-bg-tertiary)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-border-subtle)',
              }}
            >
              <FileGlyph mimeType={s.file.type} size={12} />
              <span style={{ maxWidth: '10rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.file.name}
              </span>
              <span style={{ opacity: 0.6, fontSize: '0.6875rem' }}>{formatBytes(s.file.size)}</span>
              <button
                type="button"
                onClick={() => removeFile(s.id)}
                aria-label={`Remove ${s.file.name}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '1rem',
                  height: '1rem',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--color-text-muted)',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Error row */}
      {error && (
        <div
          role="alert"
          style={{
            padding: 'var(--space-2) var(--space-4)',
            background: 'var(--color-danger-bg)',
            color: 'var(--color-danger)',
            fontSize: 'var(--text-xs)',
            borderTop: '1px solid var(--color-border-subtle)',
          }}
        >
          {error}
        </div>
      )}

      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-1)',
          padding: 'var(--space-2) var(--space-3)',
          borderTop: '1px solid var(--color-border-subtle)',
        }}
      >
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive('bold')}
          label="Bold"
        ><Bold size={13} /></ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive('italic')}
          label="Italic"
        ><Italic size={13} /></ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive('bulletList')}
          label="Bulleted list"
        ><List size={13} /></ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive('orderedList')}
          label="Numbered list"
        ><ListOrdered size={13} /></ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleCode().run()}
          active={editor.isActive('code')}
          label="Inline code"
        ><Code size={13} /></ToolbarButton>
        <ToolbarButton
          onClick={() => {
            const url = window.prompt('URL')
            if (!url) return
            editor.chain().focus().setLink({ href: url }).run()
          }}
          active={editor.isActive('link')}
          label="Link"
        ><LinkIcon size={13} /></ToolbarButton>

        {canAttach && (
          <>
            <div style={{ width: 1, height: '1.25rem', background: 'var(--color-border-subtle)', margin: '0 var(--space-1)' }} />
            <ToolbarButton
              onClick={() => fileInputRef.current?.click()}
              label="Attach file"
            ><Paperclip size={13} /></ToolbarButton>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={onPick}
              accept="image/*,.pdf,.zip,.docx,.xlsx,.csv,.txt,.mp4,.mov,.webm"
            />
          </>
        )}

        <div style={{ flex: 1 }} />

        {/* Send button */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isEmpty || submitting}
          aria-label="Send message"
          title="Send (⌘+Enter)"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--space-1-5)',
            padding: '0.375rem 0.75rem',
            fontSize: 'var(--text-xs)',
            fontWeight: 600,
            background: isEmpty || submitting ? 'var(--color-bg-tertiary)' : 'var(--color-brand)',
            color: isEmpty || submitting ? 'var(--color-text-subtle)' : '#ffffff',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            cursor: isEmpty || submitting ? 'not-allowed' : 'pointer',
            transition: 'background 150ms ease',
            minHeight: '1.75rem',
          }}
        >
          {submitting ? (
            <><Loader2 size={12} className="animate-spin" aria-hidden="true" /> Sending…</>
          ) : (
            <><Send size={12} aria-hidden="true" /> Send</>
          )}
        </button>
      </div>
    </div>
  )
}

// ── Small toolbar button ─────────────────────────────────────────────────

function ToolbarButton({
  onClick, active, label, children,
}: {
  onClick: () => void
  active?: boolean
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '1.75rem',
        height: '1.75rem',
        padding: 0,
        border: 'none',
        background: active ? 'var(--color-brand-50)' : 'transparent',
        color: active ? 'var(--color-brand)' : 'var(--color-text-muted)',
        borderRadius: 'var(--radius-sm)',
        cursor: 'pointer',
        transition: 'background 150ms ease, color 150ms ease',
      }}
      onMouseEnter={e => {
        if (!active) {
          e.currentTarget.style.background = 'var(--color-bg-secondary)'
          e.currentTarget.style.color = 'var(--color-text)'
        }
      }}
      onMouseLeave={e => {
        if (!active) {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.color = 'var(--color-text-muted)'
        }
      }}
    >
      {children}
    </button>
  )
}
