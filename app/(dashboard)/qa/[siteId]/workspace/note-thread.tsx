'use client'

import { useEffect, useRef, useState } from 'react'
import { MessageSquarePlus, Trash2 } from 'lucide-react'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { RelativeTime } from '@/components/tahi/relative-time'
import { TahiButton } from '@/components/tahi/tahi-button'
import { Textarea } from '@/components/tahi/input'
import { QA_NOTE_BODY_MAX, type QaCommentNote } from '@/lib/qa/types'

const ACTION_STYLE = { minHeight: '2.75rem' } as const

export interface NoteThreadProps {
  commentId: string
  notes: QaCommentNote[]
  resolved: boolean
  readOnly: boolean
  onAdd: (commentId: string, body: string, resolve: boolean) => void | Promise<void>
  onDelete: (commentId: string, noteId: string) => void | Promise<void>
}

/**
 * The thread of notes under one comment, oldest first, with an add-note box. The draft lives here,
 * so a refresh of the comments (which keeps this component mounted) never loses typed text.
 */
export function NoteThread({ commentId, notes, resolved, readOnly, onAdd, onDelete }: NoteThreadProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState<'note' | 'resolve' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<QaCommentNote | null>(null)
  const inputId = `note-${commentId}`
  const triggerId = `note-add-${commentId}`
  const threadId = `note-thread-${commentId}`
  // Focus moves into the box when it opens and back to the trigger when it closes.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open) document.getElementById(inputId)?.focus()
    else if (wasOpen.current) document.getElementById(triggerId)?.focus()
    wasOpen.current = open
  }, [open, inputId, triggerId])

  async function submit(resolve: boolean) {
    const text = draft.trim()
    if (!text) {
      setError('Add some text for the note.')
      return
    }
    setSaving(resolve ? 'resolve' : 'note')
    setError(null)
    try {
      await onAdd(commentId, text, resolve)
      setDraft('')
      setOpen(false)
    } catch {
      setError('Could not save the note. Try again.')
    } finally {
      setSaving(null)
    }
  }

  async function remove(noteId: string) {
    setDeletingId(noteId)
    try {
      await onDelete(commentId, noteId)
    } catch {
      // The caller reports the failure.
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div id={threadId} tabIndex={-1} className="flex min-w-0 flex-col outline-none" style={{ gap: '0.5rem' }}>
      {notes.length > 0 ? (
        <ul
          aria-label="Notes"
          className="flex min-w-0 flex-col"
          style={{ listStyle: 'none', margin: 0, padding: 0, gap: '0.375rem' }}
        >
          {notes.map(note => (
            <li
              key={note.id}
              className="flex min-w-0 items-start justify-between bg-[var(--color-bg-secondary)]"
              style={{ gap: '0.5rem', padding: '0.5rem 0.625rem', borderRadius: 'var(--radius-leaf-sm)', border: '1px solid var(--color-border-subtle)' }}
            >
              <div className="flex min-w-0 flex-col" style={{ gap: '0.125rem' }}>
                <span className="flex flex-wrap items-center text-[var(--color-text-muted)]" style={{ gap: '0 0.375rem', fontSize: '0.75rem' }}>
                  <span style={{ fontWeight: 600 }}>{note.authorName ?? 'Unknown author'}</span>
                  {note.source === 'mcp' ? <span>via assistant</span> : note.source === 'service' ? <span>via service</span> : null}
                  <span aria-hidden="true">·</span>
                  <RelativeTime date={note.createdAt} />
                </span>
                <span className="text-[var(--color-text)]" style={{ fontSize: '0.8125rem', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {note.body}
                </span>
              </div>
              <button
                type="button"
                aria-label="Delete note"
                disabled={readOnly || deletingId === note.id}
                onClick={() => setDeleteTarget(note)}
                className="tahi-focus-ring inline-flex shrink-0 items-center justify-center text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-danger)] disabled:cursor-not-allowed disabled:opacity-50"
                style={{ minWidth: '2.75rem', minHeight: '2.75rem', borderRadius: 'var(--radius-leaf-sm)' }}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {open ? (
        <div className="flex flex-col" style={{ gap: '0.5rem' }}>
          <label htmlFor={inputId} className="sr-only">Add a note</label>
          <Textarea
            id={inputId}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={3}
            maxLength={QA_NOTE_BODY_MAX}
            placeholder="Add a note"
            aria-invalid={error !== null}
          />
          {error ? (
            <p role="alert" className="text-[var(--color-danger)]" style={{ margin: 0, fontSize: '0.8125rem' }}>{error}</p>
          ) : null}
          <div className="flex flex-wrap justify-end" style={{ gap: '0.5rem' }}>
            <TahiButton
              variant="secondary"
              size="sm"
              onClick={() => { setOpen(false); setError(null) }}
              disabled={saving !== null}
              style={ACTION_STYLE}
            >
              Cancel
            </TahiButton>
            {!resolved ? (
              <TahiButton
                variant="secondary"
                size="sm"
                onClick={() => void submit(true)}
                loading={saving === 'resolve'}
                disabled={saving !== null}
                style={ACTION_STYLE}
              >
                Add and resolve
              </TahiButton>
            ) : null}
            <TahiButton
              variant="primary"
              size="sm"
              onClick={() => void submit(false)}
              loading={saving === 'note'}
              disabled={saving !== null}
              style={ACTION_STYLE}
            >
              Add note
            </TahiButton>
          </div>
        </div>
      ) : (
        <div>
          <TahiButton
            variant="ghost"
            size="sm"
            id={triggerId}
            onClick={() => setOpen(true)}
            disabled={readOnly}
            iconLeft={<MessageSquarePlus className="size-4" aria-hidden="true" />}
            style={ACTION_STYLE}
          >
            {notes.length > 0 ? 'Add another note' : 'Add note'}
          </TahiButton>
        </div>
      )}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete this note?"
        description="The note will be removed from the thread. This cannot be undone."
        confirmLabel="Delete note"
        variant="danger"
        onConfirm={async () => {
          const target = deleteTarget
          setDeleteTarget(null)
          if (target) await remove(target.id)
          // The deleted note's button is gone: put focus on the Add note trigger, else the thread.
          window.setTimeout(() => (document.getElementById(triggerId) ?? document.getElementById(threadId))?.focus(), 50)
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
