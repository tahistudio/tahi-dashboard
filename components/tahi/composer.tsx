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
import Mention from '@tiptap/extension-mention'
import {
  Bold, Italic, Strikethrough, List, ListOrdered, Code, Code2,
  Link as LinkIcon, Quote,
  Paperclip, Image as ImageIcon, Mic, X, Trash2, Play, Pause, Send,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────

export type ComposerVisibility = 'public' | 'internal'

export type MentionType = 'person' | 'org' | 'request' | 'task'

export interface MentionItem {
  id: string
  type: MentionType
  /** Display label inside the chip and the suggestion list. */
  label: string
  /** Optional secondary line in the suggestion list. */
  sub?: string
  /** Optional URL the mention chip navigates to on click. */
  href?: string
  /** When true, this item is hidden from the picker on public
   *  messages. Use for entities only the Tahi team should see
   *  (Tahi-internal tasks, other clients' requests, etc.). Internal
   *  notes show everything so the team can link freely. Default
   *  false (visible in both public and internal). */
  internalOnly?: boolean
}

/** Pluggable mention sources. The composer searches across all four
 *  whenever the user types @. Empty arrays are fine. */
export interface MentionSources {
  people?: ReadonlyArray<MentionItem>
  orgs?: ReadonlyArray<MentionItem>
  requests?: ReadonlyArray<MentionItem>
  tasks?: ReadonlyArray<MentionItem>
}

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
  /** When set, @-mentions are enabled. Provides the sources the
   *  suggestion popover searches across (people, orgs, requests,
   *  tasks). Production callers should filter these to entities the
   *  current conversation participants have access to. */
  mentionSources?: MentionSources
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
  mentionSources,
  onSend,
  className,
}: ComposerProps) {
  // Keep the latest sources in a ref so Tiptap's items() can read the
  // current array without recreating the editor on each render.
  const mentionSourcesRef = React.useRef<MentionSources | undefined>(mentionSources)
  React.useEffect(() => {
    mentionSourcesRef.current = mentionSources
  }, [mentionSources])
  // Visibility ref so the mention picker filters by what participants
  // can see. On public messages the picker hides internalOnly items;
  // on internal notes everything is fair game.
  const visibilityRef = React.useRef<ComposerVisibility>(defaultVisibility)
  const [visibility, setVisibility] = React.useState<ComposerVisibility>(defaultVisibility)
  React.useEffect(() => { visibilityRef.current = visibility }, [visibility])
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
      buildMentionExtension({
        sourcesRef: mentionSourcesRef,
        visibilityRef,
      }),
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

  // Transient banner that surfaces e.g. "Removed 2 internal-only
  // references" after the visibility toggle scrubs the draft.
  const [scrubNotice, setScrubNotice] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (!scrubNotice) return
    const t = setTimeout(() => setScrubNotice(null), 4500)
    return () => clearTimeout(t)
  }, [scrubNotice])

  // Strip internalOnly mention nodes from the doc. Returns the count.
  const stripInternalMentions = React.useCallback((): number => {
    if (!editor) return 0
    const positions: Array<{ from: number; to: number }> = []
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'mention' && node.attrs.internalOnly) {
        positions.push({ from: pos, to: pos + node.nodeSize })
      }
    })
    if (positions.length === 0) return 0
    // Delete from end to start so positions stay valid.
    let tr = editor.state.tr
    for (let i = positions.length - 1; i >= 0; i--) {
      tr = tr.delete(positions[i].from, positions[i].to)
    }
    editor.view.dispatch(tr)
    return positions.length
  }, [editor])

  // Security guard. When the user flips visibility back to Public
  // after inserting any internal-only mentions, strip them
  // immediately so they can never leak to a public recipient.
  React.useEffect(() => {
    if (visibility !== 'public') return
    const removed = stripInternalMentions()
    if (removed > 0) {
      setScrubNotice(
        `Removed ${removed} internal-only ${removed === 1 ? 'reference' : 'references'} the client can't see.`,
      )
    }
  }, [visibility, stripInternalMentions])

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
    // Belt-and-braces: even if the toggle effect missed, never let an
    // internal-only mention go out on a Public message.
    if (visibility === 'public') {
      const removed = stripInternalMentions()
      if (removed > 0) {
        setScrubNotice(
          `Blocked send: removed ${removed} internal-only ${removed === 1 ? 'reference' : 'references'}. Review the message, then send again.`,
        )
        return
      }
    }
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
      // Reset. Don't revoke staged previewUrl or voiceNote.url here —
      // the consumer received those URLs in `payload` and may still
      // be using them to render the just-sent bubble. Revoking would
      // break the image / voice preview the consumer just mounted.
      editor.commands.clearContent()
      setStaged([])
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
      className={['tahi-composer', className].filter(Boolean).join(' ')}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onKeyDown={onKeyDown}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        padding: '0.875rem 1rem',
        background: internalTint
          ? 'rgba(245, 158, 11, 0.05)'
          : 'var(--color-bg)',
        border: `1px solid ${internalTint ? 'rgba(245, 158, 11, 0.30)' : 'var(--color-border-subtle)'}`,
        borderRadius: 'var(--radius-md)',
        transition: 'border-color 150ms ease, background 150ms ease, box-shadow 150ms ease',
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

      {/* Internal-mention scrub notice. Fires when the visibility flip
          (or the send guard) strips internalOnly mentions from the
          draft. Auto-dismisses after a few seconds. */}
      {scrubNotice && (
        <div
          role="status"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.4375rem',
            padding: '0.375rem 0.5625rem',
            background: 'rgba(245, 158, 11, 0.10)',
            border: '1px solid rgba(245, 158, 11, 0.30)',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.75rem',
            color: '#92400e',
            lineHeight: 1.4,
          }}
        >
          <span aria-hidden="true" style={{ fontSize: '0.875rem', lineHeight: 1 }}>!</span>
          <span style={{ flex: 1 }}>{scrubNotice}</span>
          <button
            type="button"
            onClick={() => setScrubNotice(null)}
            aria-label="Dismiss notice"
            style={{
              background: 'transparent',
              border: 'none',
              padding: 0,
              color: '#92400e',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            <X size={11} aria-hidden="true" />
          </button>
        </div>
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

// ── @-mention search + suggestion popover ─────────────────────────────

/** Builds the Tiptap Mention extension wired to live sources + visibility.
 *
 * Refs let the consumer swap sources / visibility without recreating
 * the editor. Used by Composer for new messages and by MessageBubble
 * for inline edits — anywhere @ should work the same way. */
export function buildMentionExtension(opts: {
  sourcesRef: React.MutableRefObject<MentionSources | undefined>
  visibilityRef: React.MutableRefObject<ComposerVisibility>
}) {
  return Mention.extend({
    addAttributes() {
      return {
        id:    { default: null },
        label: { default: null },
        type:  {
          default: 'person',
          parseHTML: el => el.getAttribute('data-mention-type') ?? 'person',
          renderHTML: attrs => ({ 'data-mention-type': attrs.type }),
        },
        internalOnly: {
          default: false,
          parseHTML: el => el.getAttribute('data-internal-only') === 'true',
          renderHTML: attrs => attrs.internalOnly ? { 'data-internal-only': 'true' } : {},
        },
      }
    },
  }).configure({
    HTMLAttributes: { class: 'tahi-mention' },
    renderHTML: ({ options, node }) => {
      const attrs = node.attrs as { id?: string; label?: string; type?: MentionType; internalOnly?: boolean }
      const extra: Record<string, string> = {
        'data-mention-type': attrs.type ?? 'person',
        'data-mention-id': attrs.id ?? '',
      }
      if (attrs.internalOnly) extra['data-internal-only'] = 'true'
      return [
        'span',
        { ...options.HTMLAttributes, ...extra },
        `@${attrs.label ?? attrs.id ?? ''}`,
      ]
    },
    suggestion: {
      char: '@',
      items: ({ query }) => searchMentions(
        opts.sourcesRef.current,
        query,
        opts.visibilityRef.current,
      ),
      command: ({ editor, range, props }) => {
        const p = props as { id: string; label: string; type?: MentionType; internalOnly?: boolean }
        const nodeAfter = editor.view.state.selection.$to.nodeAfter
        const overrideSpace = nodeAfter?.text?.startsWith(' ')
        const replaceRange = overrideSpace ? { ...range, to: range.to + 1 } : range
        editor
          .chain()
          .focus()
          .insertContentAt(replaceRange, [
            {
              type: 'mention',
              attrs: {
                id: p.id,
                label: p.label,
                type: p.type ?? 'person',
                internalOnly: p.internalOnly ?? false,
              },
            },
            { type: 'text', text: ' ' },
          ])
          .run()
      },
      render: createMentionSuggestionRender(),
    },
  })
}

interface MentionMatch extends MentionItem {
  /** Order within its group. Lower comes first. */
  rank: number
}

function searchMentions(
  sources: MentionSources | undefined,
  query: string,
  visibility: ComposerVisibility,
): MentionMatch[] {
  if (!sources) return []
  const q = query.trim().toLowerCase()
  const pools: Array<{ type: MentionType; items: ReadonlyArray<MentionItem> }> = [
    { type: 'person',  items: sources.people   ?? [] },
    { type: 'org',     items: sources.orgs     ?? [] },
    { type: 'request', items: sources.requests ?? [] },
    { type: 'task',    items: sources.tasks    ?? [] },
  ]
  const out: MentionMatch[] = []
  for (const pool of pools) {
    let rank = 0
    for (const item of pool.items) {
      // Access scoping: on public messages, hide internal-only items
      // so the user can't accidentally link an entity the recipient
      // can't see. On internal notes, everything is visible.
      if (item.internalOnly && visibility === 'public') continue
      if (!q || item.label.toLowerCase().includes(q) || (item.sub?.toLowerCase().includes(q))) {
        out.push({ ...item, type: pool.type, rank: rank++ })
        if (rank >= 6) break // cap each group
      }
    }
  }
  return out
}

const MENTION_GROUP_LABEL: Record<MentionType, string> = {
  person:  'People',
  org:     'Clients',
  request: 'Requests',
  task:    'Tasks',
}

interface SuggestionRenderProps {
  items: MentionMatch[]
  command: (item: { id: string; label: string; type: MentionType; internalOnly?: boolean }) => void
  clientRect?: (() => DOMRect | null) | null
  event?: KeyboardEvent
}

function createMentionSuggestionRender() {
  return () => {
    let popup: HTMLDivElement | null = null
    let selectedIndex = 0
    let items: MentionMatch[] = []
    let commandFn: SuggestionRenderProps['command'] | null = null

    function rerender() {
      if (!popup) return
      if (items.length === 0) {
        popup.innerHTML = `<div style="padding:0.5rem 0.75rem;font-size:0.75rem;color:var(--color-text-subtle)">No matches</div>`
        return
      }
      const groups: Record<MentionType, MentionMatch[]> = {
        person: [], org: [], request: [], task: [],
      }
      items.forEach(item => { groups[item.type].push(item) })

      let flatIndex = 0
      const sections: string[] = []
      ;(['person', 'org', 'request', 'task'] as const).forEach(type => {
        const groupItems = groups[type]
        if (groupItems.length === 0) return
        sections.push(`
          <div style="padding:0.4375rem 0.75rem 0.1875rem;font-size:0.625rem;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:var(--color-text-subtle);">
            ${MENTION_GROUP_LABEL[type]}
          </div>
        `)
        groupItems.forEach(item => {
          const i = flatIndex
          flatIndex += 1
          const active = i === selectedIndex
          const iconSvg = iconSvgFor(item.type)
          sections.push(`
            <div data-index="${i}"
                 style="display:flex;align-items:center;gap:0.5rem;padding:0.375rem 0.625rem;cursor:pointer;border-radius:0.25rem;${active ? 'background:var(--color-bg-secondary);' : ''}">
              <span style="display:inline-flex;align-items:center;justify-content:center;width:1.25rem;height:1.25rem;border-radius:0.25rem;background:var(--color-bg-tertiary);color:var(--color-text-muted);flex-shrink:0;">${iconSvg}</span>
              <span style="flex:1;min-width:0;">
                <span style="display:block;font-size:0.8125rem;font-weight:500;color:var(--color-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(item.label)}</span>
                ${item.sub ? `<span style="display:block;font-size:0.6875rem;color:var(--color-text-subtle);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(item.sub)}</span>` : ''}
              </span>
            </div>
          `)
        })
      })
      popup.innerHTML = sections.join('')
      popup.querySelectorAll('[data-index]').forEach(el => {
        el.addEventListener('mouseenter', () => {
          selectedIndex = parseInt(el.getAttribute('data-index') ?? '0')
          rerender()
        })
        // Use mousedown (not click) so the mention is inserted before
        // Tiptap's suggestion plugin can fire onExit and unmount the
        // popup. Some browsers dispatch click on the new DOM element
        // that replaces the one we mousedowned on (due to the rerender
        // on hover), so click handlers fire on a stale target.
        const fire = (e: Event) => {
          e.preventDefault()
          const idx = parseInt(el.getAttribute('data-index') ?? '0')
          if (commandFn && items[idx]) {
            commandFn({
              id: items[idx].id,
              label: items[idx].label,
              type: items[idx].type,
              internalOnly: items[idx].internalOnly ?? false,
            })
          }
        }
        el.addEventListener('mousedown', fire)
      })
    }

    function position(props: { clientRect?: (() => DOMRect | null) | null }) {
      if (!popup || !props.clientRect) return
      const rect = props.clientRect()
      if (!rect) return
      popup.style.left = `${rect.left}px`
      popup.style.top  = `${rect.bottom + 6}px`
    }

    return {
      onStart: (props: SuggestionRenderProps) => {
        items = props.items
        commandFn = props.command
        selectedIndex = 0
        popup = document.createElement('div')
        popup.style.cssText = [
          'position:fixed',
          'z-index:60',
          'background:var(--color-bg)',
          'border:1px solid var(--color-border)',
          'border-radius:var(--radius-card)',
          'padding:0.25rem',
          'box-shadow:var(--shadow-lg)',
          'max-height:18rem',
          'overflow-y:auto',
          'min-width:16rem',
          'max-width:22rem',
        ].join(';')
        // Prevent clicks on the popover from blurring the Tiptap
        // editor. Without this preventDefault, clicking an item moves
        // focus out of the editor and Tiptap's command() inserts the
        // mention into nowhere (or duplicates the query text). Apply
        // on mousedown which fires before blur.
        popup.addEventListener('mousedown', (e) => e.preventDefault())
        document.body.appendChild(popup)
        position(props)
        rerender()
      },
      onUpdate: (props: SuggestionRenderProps) => {
        items = props.items
        selectedIndex = 0
        position(props)
        rerender()
      },
      onKeyDown: ({ event }: { event: KeyboardEvent }) => {
        if (!items.length) return false
        if (event.key === 'ArrowDown') {
          selectedIndex = (selectedIndex + 1) % items.length
          rerender()
          return true
        }
        if (event.key === 'ArrowUp') {
          selectedIndex = (selectedIndex - 1 + items.length) % items.length
          rerender()
          return true
        }
        if (event.key === 'Enter') {
          if (commandFn && items[selectedIndex]) {
            commandFn({
              id: items[selectedIndex].id,
              label: items[selectedIndex].label,
              type: items[selectedIndex].type,
              internalOnly: items[selectedIndex].internalOnly ?? false,
            })
          }
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

// Inline SVG glyphs for the mention popover icon tiles. We don't
// hydrate React inside the Tiptap popover (it's a vanilla DOM node),
// so we inline the Lucide path data here.
function iconSvgFor(type: MentionType): string {
  const common = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="11" height="11" viewBox="0 0 24 24"'
  switch (type) {
    case 'person':
      return `<svg ${common}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`
    case 'org':
      return `<svg ${common}><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/></svg>`
    case 'request':
      return `<svg ${common}><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>`
    case 'task':
      return `<svg ${common}><rect x="3" y="5" width="6" height="6" rx="1"/><path d="m3 17 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/></svg>`
  }
}
