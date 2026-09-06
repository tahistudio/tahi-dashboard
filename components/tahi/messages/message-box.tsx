'use client'

/**
 * <MessageBox>. The composer, shared by both audiences and both stores.
 *
 * Deliberately plain text with a paperclip and a mic, not the Tiptap
 * <MessageComposer> the request detail uses. A chat pane is a different
 * instrument from a formal reply on a request: it wants Cmd+Enter, a tray and
 * nothing between the reader and the sentence. The two write paths agree on
 * what they store (both sanitised server-side), so a message written here is
 * indistinguishable from one written there.
 *
 * The internal tab is STUDIO ONLY, and the prop that shows it is resolved
 * server-side (`thread.canInternal`) rather than from an isAdmin flag held in
 * the browser. A client route has no field that could carry `isInternal`, so
 * there is nothing for a forged request to set either.
 *
 * `mode` is a CONTROLLED prop rather than local state. The mic sits in this
 * footer but records and uploads in the page above, so a mode kept privately
 * here was invisible to the voice-note write: a note recorded on the amber tab
 * went out to the client. One owner, one answer, both paths.
 *
 * Read-only is a real state, not a disabled button: an admin previewing a
 * client's portal sees the note that says so.
 */

import * as React from 'react'
import { Eye, Lock, MessageCircle, Mic, Paperclip, Send, X } from 'lucide-react'
import type { StagedAttachment } from './types'

export interface MessageBoxProps {
  canPost: boolean
  canInternal: boolean
  /** Owned by the page, so the mic writes the same visibility this tab shows. */
  mode: 'reply' | 'note'
  onModeChange: (mode: 'reply' | 'note') => void
  placeholder: string
  hint: string
  readOnlyNote: string
  attachments: readonly StagedAttachment[]
  onPickFiles: (files: FileList | null) => void
  onRemoveAttachment: (key: string) => void
  onVoice: () => void
  recording: boolean
  onSend: (input: { body: string; isInternal: boolean; attachments: StagedAttachment[] }) => Promise<boolean>
}

export function MessageBox({
  canPost,
  canInternal,
  mode,
  onModeChange,
  placeholder,
  hint,
  readOnlyNote,
  attachments,
  onPickFiles,
  onRemoveAttachment,
  onVoice,
  recording,
  onSend,
}: MessageBoxProps) {
  const [value, setValue] = React.useState('')
  const [sending, setSending] = React.useState(false)
  const fileInput = React.useRef<HTMLInputElement | null>(null)

  const internal = canInternal && mode === 'note'
  const busy = attachments.some(a => a.busy)
  // A file whose upload failed carries no id, so it would be dropped by the
  // filter below and sent past in silence while its chip sat in the tray. Send
  // is held until it is retried or removed instead.
  const broken = attachments.some(a => a.error)
  const ready = attachments.filter(a => a.fileId)
  const has = value.trim().length > 0 || ready.length > 0

  const send = React.useCallback(async () => {
    if (!has || sending || busy || broken) return
    setSending(true)
    try {
      const ok = await onSend({ body: toParagraphs(value), isInternal: internal, attachments: ready })
      if (ok) setValue('')
    } finally {
      setSending(false)
    }
  }, [has, sending, busy, broken, onSend, value, internal, ready])

  if (!canPost) {
    return (
      <div className="pfm-composer readonly">
        <span className="pfm-comp-ro">
          <Eye size={14} aria-hidden="true" />
          {readOnlyNote}
        </span>
      </div>
    )
  }

  return (
    <div className={internal ? 'pfm-composer internal' : 'pfm-composer'}>
      {canInternal && (
        <div className="pfm-comp-tabs" role="group" aria-label="Who can see this">
          <button
            type="button"
            className={mode === 'reply' ? 'pfm-comp-tab on tahi-focus-ring' : 'pfm-comp-tab tahi-focus-ring'}
            aria-pressed={mode === 'reply'}
            onClick={() => onModeChange('reply')}
          >
            <MessageCircle size={14} aria-hidden="true" />
            Reply to the client
          </button>
          <button
            type="button"
            className={mode === 'note' ? 'pfm-comp-tab note on tahi-focus-ring' : 'pfm-comp-tab note tahi-focus-ring'}
            aria-pressed={mode === 'note'}
            onClick={() => onModeChange('note')}
          >
            <Lock size={13} aria-hidden="true" />
            Internal note
          </button>
        </div>
      )}

      <div className="pfm-comp-area">
        <textarea
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder={internal ? 'Write a note only the studio can see' : placeholder}
          aria-label={internal ? 'Internal note' : placeholder}
          onKeyDown={e => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              void send()
            }
          }}
        />
      </div>

      {attachments.length > 0 && (
        <div className="pfm-comp-tray">
          {attachments.map(a => (
            <span key={a.key} className="pfm-chip">
              <span className="pfm-chip-t">
                <b>{a.filename}</b>
                <small>{a.error ?? a.busy ?? formatBytes(a.sizeBytes)}</small>
              </span>
              <button
                type="button"
                className="pfm-chip-x tahi-focus-ring"
                onClick={() => onRemoveAttachment(a.key)}
                aria-label={`Remove ${a.filename}`}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="pfm-comp-foot">
        <span className={internal ? 'pfm-comp-hint internal' : 'pfm-comp-hint'}>
          {internal ? <Lock size={13} aria-hidden="true" /> : <Eye size={13} aria-hidden="true" />}
          {internal ? 'The client will not see this' : hint}
        </span>
        <div className="pfm-comp-tools">
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={e => {
              onPickFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            className="pfm-icon-btn tahi-focus-ring"
            onClick={() => fileInput.current?.click()}
            aria-label="Attach a file"
            title="Attach a file"
          >
            <Paperclip size={17} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={recording ? 'pfm-icon-btn recording tahi-focus-ring' : 'pfm-icon-btn tahi-focus-ring'}
            onClick={onVoice}
            aria-label={recording
              ? 'Stop recording'
              : internal ? 'Record an internal voice note' : 'Record a voice note'}
            title={recording
              ? 'Stop recording'
              : internal ? 'Record an internal voice note' : 'Record a voice note'}
          >
            <Mic size={17} aria-hidden="true" />
            {recording && <span className="pfm-rec-dot" aria-hidden="true" />}
          </button>
        </div>
        <button
          type="button"
          className="pfm-send tahi-focus-ring"
          onClick={() => void send()}
          disabled={!has || sending || busy || broken}
        >
          {internal ? <Lock size={15} aria-hidden="true" /> : <Send size={15} aria-hidden="true" />}
          {internal ? 'Add note' : sending ? 'Sending' : 'Send'}
        </button>
      </div>
    </div>
  )
}

/**
 * The textarea's plain text, as the same HTML vocabulary the request detail
 * stores.
 *
 * A message body is rendered with dangerouslySetInnerHTML, so a raw textarea
 * value would lose every line break the writer put in. The text is ESCAPED
 * first and only then wrapped, so a client who types `<b>` sees `<b>`: the
 * server sanitiser (lib/sanitize-rich-text.ts) is idempotent about entities,
 * so escaping here does not double-escape there.
 */
export function toParagraphs(value: string): string {
  const escaped = value
    .trim()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  if (!escaped) return ''
  return escaped
    .split(/\n{2,}/)
    .map(block => `<p>${block.split(/\n/).join('<br>')}</p>`)
    .join('')
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
