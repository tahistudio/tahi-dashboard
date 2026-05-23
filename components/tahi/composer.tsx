'use client'

/**
 * <Composer>. The rich-text + voice + files composer primitive.
 *
 * Self-contained for design-system demos; pass `onUploadFile` to
 * plug in real R2 / Stripe / whatever upload pipeline for production.
 *
 *   <Composer
 *     placeholder="Reply to Anna…"
 *     canBeInternal
 *     onSend={({ html, json, files, voiceNote, visibility }) => post(...)}
 *   />
 *
 * Features:
 *   - Tiptap with StarterKit (bold, italic, lists, code, code blocks),
 *     links, placeholder.
 *   - Slim formatting toolbar above the editor (toggle marks +
 *     blocks via icon buttons). Hidden on mobile by default.
 *   - File attach (paperclip) + image attach buttons + drag/drop
 *     anywhere on the composer surface.
 *   - Voice recorder using MediaRecorder. Click mic → recording UI
 *     with timer + stop button. Stop → inline audio preview with
 *     delete.
 *   - Visibility segmented control (Public / Internal) when
 *     canBeInternal is true. Internal style adds a soft orange tint.
 *   - Cmd/Ctrl+Enter sends. Plain Enter is a new line.
 *   - Staged files render as chips below the editor with name + size
 *     + remove X. Images preview as thumbnail tiles instead of chips.
 *
 * No tracking of upload progress per file — for the production
 * version we'll add that on top.
 */

import * as React from 'react'
import { useEditor, EditorContent, Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import LinkExt from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import {
  Bold, Italic, Strikethrough, List, ListOrdered, Code, Code2,
  Link as LinkIcon, Quote,
  Paperclip, Image as ImageIcon, Mic, X, Trash2, Play, Pause, Send,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────

export type ComposerVisibility = 'public' | 'internal'

export interface ComposerStagedFile {
  id: string
  file: File
  /** Local preview URL for images. */
  previewUrl?: string
}

export interface ComposerVoiceNote {
  id: string
  blob: Blob
  url: string
  durationSeconds: number
}

export interface ComposerSendPayload {
  html: string
  /** Tiptap JSON (for storage). */
  json: unknown
  files: ComposerStagedFile[]
  voiceNote: ComposerVoiceNote | null
  visibility: ComposerVisibility
}

interface ComposerProps {
  placeholder?: string
  /** Show the Public / Internal segmented control. */
  canBeInternal?: boolean
  defaultVisibility?: ComposerVisibility
  /** Hide the formatting toolbar entirely (for tight surfaces). */
  hideToolbar?: boolean
  /** Disable file attachment. */
  noFiles?: boolean
  /** Disable voice recording. */
  noVoice?: boolean
  /** Fires on Send (button or Cmd/Ctrl+Enter). Receives all the
   *  state needed to persist the message. */
  onSend?: (payload: ComposerSendPayload) => void | Promise<void>
  className?: string
}

// ── Component ──────────────────────────────────────────────────────────

export function Composer({
  placeholder = 'Write a message…',
  canBeInternal = false,
  defaultVisibility = 'public',
  hideToolbar = false,
  noFiles = false,
  noVoice = false,
  onSend,
  className,
}: ComposerProps) {
  const [visibility, setVisibility] = React.useState<ComposerVisibility>(defaultVisibility)
  const [staged, setStaged] = React.useState<ComposerStagedFile[]>([])
  const [voiceNote, setVoiceNote] = React.useState<ComposerVoiceNote | null>(null)
  const [isDragging, setIsDragging] = React.useState(false)
  const [sending, setSending] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const imageInputRef = React.useRef<HTMLInputElement | null>(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: { HTMLAttributes: { class: 'tahi-code-block' } },
      }),
      LinkExt.configure({
        openOnClick: false,
        HTMLAttributes: { rel: 'noopener', target: '_blank' },
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: '',
    editorProps: {
      attributes: {
        class: 'tahi-composer-editor',
      },
    },
    immediatelyRender: false,
  })

  // Track if the editor has any content. Drives the send-button
  // disabled state alongside file + voice presence.
  const [hasContent, setHasContent] = React.useState(false)
  React.useEffect(() => {
    if (!editor) return
    const update = () => setHasContent(!editor.isEmpty)
    editor.on('update', update)
    editor.on('transaction', update)
    return () => {
      editor.off('update', update)
      editor.off('transaction', update)
    }
  }, [editor])

  const canSend = !!editor && (hasContent || staged.length > 0 || !!voiceNote) && !sending

  // ── File handling ──
  const addFiles = (newFiles: FileList | File[]) => {
    if (noFiles) return
    const fresh: ComposerStagedFile[] = Array.from(newFiles).map(file => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
    }))
    setStaged(prev => [...prev, ...fresh])
  }

  const removeStaged = (id: string) => {
    setStaged(prev => {
      const found = prev.find(s => s.id === id)
      if (found?.previewUrl) URL.revokeObjectURL(found.previewUrl)
      return prev.filter(s => s.id !== id)
    })
  }

  // Clean up object URLs on unmount.
  React.useEffect(() => () => {
    staged.forEach(s => s.previewUrl && URL.revokeObjectURL(s.previewUrl))
    if (voiceNote) URL.revokeObjectURL(voiceNote.url)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Drag and drop ──
  const onDragOver = (e: React.DragEvent) => {
    if (noFiles) return
    e.preventDefault()
    setIsDragging(true)
  }
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }
  const onDrop = (e: React.DragEvent) => {
    if (noFiles) return
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files)
  }

  // ── Submit ──
  const handleSend = async () => {
    if (!editor || !canSend) return
    setSending(true)
    try {
      const payload: ComposerSendPayload = {
        html: editor.getHTML(),
        json: editor.getJSON(),
        files: staged,
        voiceNote,
        visibility,
      }
      await onSend?.(payload)
      // Reset
      editor.commands.clearContent()
      staged.forEach(s => s.previewUrl && URL.revokeObjectURL(s.previewUrl))
      setStaged([])
      if (voiceNote) URL.revokeObjectURL(voiceNote.url)
      setVoiceNote(null)
    } finally {
      setSending(false)
    }
  }

  // ── Keyboard shortcut: Cmd/Ctrl+Enter ──
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      void handleSend()
    }
  }

  const internalTint = visibility === 'internal'

  return (
    <div
      className={className}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onKeyDown={onKeyDown}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        padding: '0.625rem',
        background: internalTint
          ? 'rgba(245, 158, 11, 0.05)'
          : 'var(--color-bg)',
        border: `1px solid ${internalTint ? 'rgba(245, 158, 11, 0.30)' : 'var(--color-border-subtle)'}`,
        borderRadius: 'var(--radius-md)',
        transition: 'border-color 150ms ease, background 150ms ease',
      }}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'var(--color-brand-50)',
            border: '2px dashed var(--color-brand)',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            color: 'var(--color-text-active)',
            pointerEvents: 'none',
            zIndex: 5,
          }}
        >
          Drop to attach
        </div>
      )}

      {/* Toolbar */}
      {!hideToolbar && editor && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.125rem',
            paddingBottom: '0.375rem',
            borderBottom: '1px solid var(--color-border-subtle)',
            flexWrap: 'wrap',
          }}
        >
          <ToolbarGroup>
            <ToolbarButton
              isActive={editor.isActive('bold')}
              onClick={() => editor.chain().focus().toggleBold().run()}
              label="Bold (Cmd/Ctrl+B)"
            >
              <Bold size={13} aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              isActive={editor.isActive('italic')}
              onClick={() => editor.chain().focus().toggleItalic().run()}
              label="Italic"
            >
              <Italic size={13} aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              isActive={editor.isActive('strike')}
              onClick={() => editor.chain().focus().toggleStrike().run()}
              label="Strikethrough"
            >
              <Strikethrough size={13} aria-hidden="true" />
            </ToolbarButton>
          </ToolbarGroup>
          <ToolbarDivider />
          <ToolbarGroup>
            <ToolbarButton
              isActive={editor.isActive('bulletList')}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              label="Bullet list"
            >
              <List size={13} aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              isActive={editor.isActive('orderedList')}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              label="Numbered list"
            >
              <ListOrdered size={13} aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              isActive={editor.isActive('blockquote')}
              onClick={() => editor.chain().focus().toggleBlockquote().run()}
              label="Quote"
            >
              <Quote size={13} aria-hidden="true" />
            </ToolbarButton>
          </ToolbarGroup>
          <ToolbarDivider />
          <ToolbarGroup>
            <ToolbarButton
              isActive={editor.isActive('code')}
              onClick={() => editor.chain().focus().toggleCode().run()}
              label="Inline code"
            >
              <Code size={13} aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              isActive={editor.isActive('codeBlock')}
              onClick={() => editor.chain().focus().toggleCodeBlock().run()}
              label="Code block"
            >
              <Code2 size={13} aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              isActive={editor.isActive('link')}
              onClick={() => promptForLink(editor)}
              label="Add link"
            >
              <LinkIcon size={13} aria-hidden="true" />
            </ToolbarButton>
          </ToolbarGroup>
        </div>
      )}

      {/* Editor */}
      {editor && (
        <EditorContent
          editor={editor}
          style={{
            minHeight: '4.5rem',
            fontSize: 'var(--text-sm)',
            lineHeight: 1.55,
            color: 'var(--color-text)',
            outline: 'none',
          }}
        />
      )}

      {/* Image previews + file chips */}
      {(staged.length > 0 || voiceNote) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4375rem', marginTop: '0.125rem' }}>
          {staged.map(s => (
            s.previewUrl
              ? <ImagePreviewTile key={s.id} item={s} onRemove={() => removeStaged(s.id)} />
              : <FileChip key={s.id} item={s} onRemove={() => removeStaged(s.id)} />
          ))}
          {voiceNote && (
            <VoiceNotePreview
              voiceNote={voiceNote}
              onRemove={() => {
                URL.revokeObjectURL(voiceNote.url)
                setVoiceNote(null)
              }}
            />
          )}
        </div>
      )}

      {/* Footer: attach buttons + visibility + send */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.25rem',
          flexWrap: 'wrap',
        }}
      >
        {!noFiles && (
          <>
            <ToolbarButton
              onClick={() => fileInputRef.current?.click()}
              label="Attach file"
            >
              <Paperclip size={13} aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => imageInputRef.current?.click()}
              label="Attach image"
            >
              <ImageIcon size={13} aria-hidden="true" />
            </ToolbarButton>
            <input
              ref={fileInputRef}
              type="file"
              hidden
              multiple
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files)
                e.target.value = ''
              }}
            />
            <input
              ref={imageInputRef}
              type="file"
              hidden
              accept="image/*"
              multiple
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files)
                e.target.value = ''
              }}
            />
          </>
        )}

        {!noVoice && (
          <VoiceRecorderButton
            onRecorded={(vn) => setVoiceNote(vn)}
            disabled={!!voiceNote}
          />
        )}

        <div style={{ flex: 1 }} />

        {canBeInternal && (
          <VisibilityToggle
            value={visibility}
            onChange={setVisibility}
          />
        )}

        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          aria-label="Send message"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.3125rem',
            height: '1.75rem',
            padding: '0 0.75rem',
            marginLeft: '0.25rem',
            background: canSend ? 'var(--color-brand)' : 'var(--color-bg-tertiary)',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            color: canSend ? '#ffffff' : 'var(--color-text-subtle)',
            fontSize: 'var(--text-xs)',
            fontWeight: 600,
            cursor: canSend ? 'pointer' : 'not-allowed',
            transition: 'background-color 150ms ease, color 150ms ease',
          }}
          onMouseEnter={e => {
            if (canSend) e.currentTarget.style.background = 'var(--color-brand-dark)'
          }}
          onMouseLeave={e => {
            if (canSend) e.currentTarget.style.background = 'var(--color-brand)'
          }}
        >
          <Send size={11} aria-hidden="true" />
          Send
        </button>
      </div>
    </div>
  )
}

// ── Visibility toggle ──────────────────────────────────────────────────

function VisibilityToggle({
  value,
  onChange,
}: {
  value: ComposerVisibility
  onChange: (next: ComposerVisibility) => void
}) {
  const options: Array<{ value: ComposerVisibility; label: string }> = [
    { value: 'public',   label: 'Public' },
    { value: 'internal', label: 'Internal' },
  ]
  return (
    <div
      role="radiogroup"
      aria-label="Visibility"
      style={{
        display: 'inline-flex',
        padding: '0.125rem',
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-md)',
        gap: '0.0625rem',
      }}
    >
      {options.map(opt => {
        const active = opt.value === value
        const isInternal = opt.value === 'internal'
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            style={{
              padding: '0.1875rem 0.5rem',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              background: active
                ? (isInternal ? 'rgba(245, 158, 11, 0.18)' : 'var(--color-bg)')
                : 'transparent',
              color: active
                ? (isInternal ? '#92400e' : 'var(--color-text)')
                : 'var(--color-text-muted)',
              fontSize: '0.6875rem',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: active && !isInternal ? 'var(--shadow-xs)' : undefined,
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

// ── Toolbar bits ───────────────────────────────────────────────────────

function ToolbarGroup({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'inline-flex', gap: '0.0625rem' }}>{children}</div>
}

function ToolbarDivider() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: 1,
        height: '0.875rem',
        background: 'var(--color-border-subtle)',
        margin: '0 0.25rem',
      }}
    />
  )
}

function ToolbarButton({
  isActive,
  disabled,
  onClick,
  label,
  children,
}: {
  isActive?: boolean
  disabled?: boolean
  onClick: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={isActive}
      aria-label={label}
      title={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '1.75rem',
        height: '1.75rem',
        background: isActive ? 'var(--color-bg-tertiary)' : 'transparent',
        border: 'none',
        borderRadius: 'var(--radius-sm)',
        color: isActive ? 'var(--color-text-active)' : 'var(--color-text-muted)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        transition: 'background-color 120ms ease, color 120ms ease',
      }}
      onMouseEnter={e => {
        if (disabled) return
        if (!isActive) {
          e.currentTarget.style.background = 'var(--color-bg-secondary)'
          e.currentTarget.style.color = 'var(--color-text)'
        }
      }}
      onMouseLeave={e => {
        if (!isActive) {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.color = 'var(--color-text-muted)'
        }
      }}
    >
      {children}
    </button>
  )
}

// ── File chips + image preview tile ────────────────────────────────────

function FileChip({
  item,
  onRemove,
}: {
  item: ComposerStagedFile
  onRemove: () => void
}) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.375rem',
        padding: '0.25rem 0.4375rem 0.25rem 0.5rem',
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-md)',
        fontSize: 'var(--text-xs)',
        color: 'var(--color-text)',
        maxWidth: '14rem',
      }}
    >
      <Paperclip size={11} aria-hidden="true" style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {item.file.name}
      </span>
      <span style={{ color: 'var(--color-text-subtle)', fontSize: '0.625rem', flexShrink: 0 }}>
        {formatBytes(item.file.size)}
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${item.file.name}`}
        style={{
          background: 'transparent',
          border: 'none',
          padding: '0.0625rem',
          marginLeft: '0.0625rem',
          color: 'var(--color-text-subtle)',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
        }}
      >
        <X size={11} aria-hidden="true" />
      </button>
    </div>
  )
}

function ImagePreviewTile({
  item,
  onRemove,
}: {
  item: ComposerStagedFile
  onRemove: () => void
}) {
  return (
    <div
      style={{
        position: 'relative',
        width: '4rem',
        height: '4rem',
        borderRadius: 'var(--radius-sm)',
        overflow: 'hidden',
        border: '1px solid var(--color-border-subtle)',
        background: 'var(--color-bg-secondary)',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={item.previewUrl}
        alt={item.file.name}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${item.file.name}`}
        style={{
          position: 'absolute',
          top: '0.1875rem',
          right: '0.1875rem',
          width: '1rem',
          height: '1rem',
          borderRadius: 999,
          background: 'rgba(15, 20, 16, 0.6)',
          border: 'none',
          color: '#ffffff',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <X size={9} aria-hidden="true" />
      </button>
    </div>
  )
}

// ── Voice recorder ────────────────────────────────────────────────────

function VoiceRecorderButton({
  onRecorded,
  disabled,
}: {
  onRecorded: (vn: ComposerVoiceNote) => void
  disabled: boolean
}) {
  const [recording, setRecording] = React.useState(false)
  const [elapsed, setElapsed] = React.useState(0)
  const [error, setError] = React.useState<string | null>(null)
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null)
  const chunksRef = React.useRef<Blob[]>([])
  const startMsRef = React.useRef<number>(0)
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null)

  const cleanupStream = () => {
    mediaRecorderRef.current?.stream.getTracks().forEach(t => t.stop())
    mediaRecorderRef.current = null
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const start = async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type ?? 'audio/webm' })
        const url = URL.createObjectURL(blob)
        const durationSeconds = Math.max(1, Math.round((Date.now() - startMsRef.current) / 1000))
        onRecorded({
          id: crypto.randomUUID(),
          blob,
          url,
          durationSeconds,
        })
        cleanupStream()
      }
      mediaRecorderRef.current = recorder
      startMsRef.current = Date.now()
      setElapsed(0)
      recorder.start(250)
      setRecording(true)
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startMsRef.current) / 1000))
      }, 250)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mic permission denied')
    }
  }

  const stop = () => {
    setRecording(false)
    mediaRecorderRef.current?.stop()
  }

  React.useEffect(() => () => { cleanupStream() }, [])

  if (recording) {
    return (
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.4375rem',
          padding: '0.1875rem 0.5rem',
          background: 'rgba(220, 38, 38, 0.10)',
          border: '1px solid rgba(220, 38, 38, 0.30)',
          borderRadius: 'var(--radius-md)',
          fontSize: 'var(--text-xs)',
          color: 'var(--color-danger)',
          fontWeight: 600,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: '0.5rem',
            height: '0.5rem',
            borderRadius: 999,
            background: 'var(--color-danger)',
          }}
          className="animate-pulse"
        />
        Recording
        <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--color-danger)' }}>
          {formatDuration(elapsed)}
        </span>
        <button
          type="button"
          onClick={stop}
          aria-label="Stop recording"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.1875rem',
            padding: '0.1875rem 0.4375rem',
            marginLeft: '0.25rem',
            background: 'var(--color-danger)',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            color: '#ffffff',
            fontSize: '0.6875rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Stop
        </button>
      </div>
    )
  }

  return (
    <>
      <ToolbarButton
        onClick={start}
        disabled={disabled}
        label={disabled ? 'Voice note already recorded' : 'Record voice note'}
      >
        <Mic size={13} aria-hidden="true" />
      </ToolbarButton>
      {error && (
        <span style={{ fontSize: '0.6875rem', color: 'var(--color-danger)', marginLeft: '0.25rem' }}>
          {error}
        </span>
      )}
    </>
  )
}

function VoiceNotePreview({
  voiceNote,
  onRemove,
}: {
  voiceNote: ComposerVoiceNote
  onRemove: () => void
}) {
  const audioRef = React.useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = React.useState(false)
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.4375rem',
        padding: '0.25rem 0.4375rem 0.25rem 0.5rem',
        background: 'var(--color-brand-50)',
        border: '1px solid var(--color-brand-100)',
        borderRadius: 'var(--radius-md)',
        fontSize: 'var(--text-xs)',
        color: 'var(--color-text)',
      }}
    >
      <button
        type="button"
        onClick={() => {
          if (!audioRef.current) return
          if (playing) audioRef.current.pause()
          else void audioRef.current.play()
        }}
        aria-label={playing ? 'Pause voice note' : 'Play voice note'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '1.25rem',
          height: '1.25rem',
          borderRadius: 999,
          background: 'var(--color-brand)',
          border: 'none',
          color: '#ffffff',
          cursor: 'pointer',
        }}
      >
        {playing ? <Pause size={10} aria-hidden="true" /> : <Play size={10} aria-hidden="true" />}
      </button>
      <span style={{ fontWeight: 500 }}>Voice note</span>
      <span style={{ color: 'var(--color-text-subtle)', fontVariantNumeric: 'tabular-nums' }}>
        {formatDuration(voiceNote.durationSeconds)}
      </span>
      <audio
        ref={audioRef}
        src={voiceNote.url}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        hidden
      />
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove voice note"
        style={{
          background: 'transparent',
          border: 'none',
          padding: '0.0625rem',
          color: 'var(--color-text-subtle)',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
        }}
      >
        <Trash2 size={11} aria-hidden="true" />
      </button>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function promptForLink(editor: Editor) {
  if (typeof window === 'undefined') return
  const previousUrl = editor.getAttributes('link').href as string | undefined
  const url = window.prompt('URL', previousUrl ?? 'https://')
  if (url === null) return
  if (url === '') {
    editor.chain().focus().extendMarkRange('link').unsetLink().run()
    return
  }
  editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
}
