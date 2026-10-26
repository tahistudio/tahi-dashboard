'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { Leaf } from 'lucide-react'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { EmptyState } from '@/components/tahi/empty-state'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'
import { RelativeTime } from '@/components/tahi/relative-time'
import { TahiButton } from '@/components/tahi/tahi-button'
import { Textarea } from '@/components/tahi/input'
import { QA_COMMENT_BODY_MAX, type QaComment } from '@/lib/qa/types'
import {
  filterForSelection,
  groupByViewport,
  matchesFilter,
  oneLine,
  type CommentFilter,
  type NumberedComment,
} from './comments-helpers'

export { commentsTabLabel } from './comments-helpers'

const FILTERS: { value: CommentFilter; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' },
]

const FILTER_EMPTY: Record<CommentFilter, string> = {
  open: 'No open comments.',
  resolved: 'No resolved comments.',
  all: 'No comments.',
}

const CHIP_BASE: CSSProperties = {
  minHeight: '2.75rem',
  padding: '0.375rem 0.75rem',
  fontSize: '0.8125rem',
  fontWeight: 600,
  borderRadius: 'var(--radius-leaf-sm)',
  border: '1px solid var(--color-border)',
  transition: 'background-color 150ms ease, color 150ms ease, border-color 150ms ease',
}

const ACTION_STYLE: CSSProperties = { minHeight: '2.75rem' }

export interface CommentsTabProps {
  comments: NumberedComment[]
  loading: boolean
  error: string | null
  readOnly: boolean
  selectedId: string | null
  onSelect: (id: string) => void
  onShow: (comment: NumberedComment) => void
  onResolve: (id: string, resolved: boolean) => void | Promise<void>
  onEdit: (id: string, body: string) => void | Promise<void>
  onDelete: (id: string) => void | Promise<void>
  onCreateRequest: (comment: NumberedComment) => void | Promise<void>
}

/** Issues panel tab listing element comments, grouped by viewport. */
export function CommentsTab({
  comments,
  loading,
  error,
  readOnly,
  selectedId,
  onSelect,
  onShow,
  onResolve,
  onEdit,
  onDelete,
  onCreateRequest,
}: CommentsTabProps) {
  const [filter, setFilter] = useState<CommentFilter>('open')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBody, setEditBody] = useState('')
  const [editError, setEditError] = useState<string | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<NumberedComment | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // A selection the filter hides (a pin click on a resolved comment under "Open") widens the filter.
  // Only on a new selection: resolving the selected comment, or picking a filter, must not flip it back.
  const commentsRef = useRef(comments)
  commentsRef.current = comments
  useEffect(() => {
    setFilter(current => filterForSelection(commentsRef.current, selectedId, current))
  }, [selectedId])

  // Scroll once the selected row is on screen: after a selection, or after the filter widened to show it.
  const selectedVisible = selectedId !== null && comments.some(c => c.id === selectedId && matchesFilter(c.status, filter))
  useEffect(() => {
    if (!selectedId || !selectedVisible) return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-comment-id="${selectedId}"]`)
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [selectedId, selectedVisible])

  if (error) {
    return (
      <p role="alert" className="text-[var(--color-danger)]" style={{ margin: 0, fontSize: '0.8125rem' }}>
        Could not load comments. {error}
      </p>
    )
  }

  if (loading && comments.length === 0) {
    return <LoadingSkeleton rows={3} height={72} />
  }

  if (comments.length === 0) {
    return (
      <EmptyState
        variant="inline"
        icon={<Leaf className="w-8 h-8" aria-hidden="true" />}
        title="No comments yet"
        description="Turn on Comment on a frame and click an element to leave one."
      />
    )
  }

  const groups = groupByViewport(comments, filter)

  function startEdit(comment: NumberedComment) {
    setEditingId(comment.id)
    setEditBody(comment.body)
    setEditError(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditBody('')
    setEditError(null)
  }

  async function saveEdit(comment: NumberedComment) {
    const trimmed = editBody.trim()
    if (!trimmed) {
      setEditError('Add some text for the comment.')
      return
    }
    setSavingEdit(true)
    setEditError(null)
    try {
      await onEdit(comment.id, trimmed)
      cancelEdit()
    } catch {
      setEditError('Could not save the comment. Try again.')
    } finally {
      setSavingEdit(false)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    const id = deleteTarget.id
    try {
      await onDelete(id)
    } catch {
      // The caller reports the failure. The dialog closes either way.
    }
    setDeleteTarget(null)
    if (editingId === id) cancelEdit()
  }

  return (
    <div className="flex min-w-0 flex-col" style={{ gap: '0.75rem' }}>
      <div role="group" aria-label="Filter comments" className="flex flex-wrap" style={{ gap: '0.375rem' }}>
        {FILTERS.map(f => {
          const on = filter === f.value
          return (
            <button
              key={f.value}
              type="button"
              aria-pressed={on}
              onClick={() => setFilter(f.value)}
              className="tahi-focus-ring transition-colors hover:bg-[var(--color-bg-tertiary)]"
              style={{
                ...CHIP_BASE,
                background: on ? 'var(--color-brand-50)' : 'var(--color-bg)',
                color: on ? 'var(--color-brand-dark)' : 'var(--color-text-muted)',
                borderColor: on ? 'var(--color-brand)' : 'var(--color-border)',
              }}
            >
              {f.label}
            </button>
          )
        })}
      </div>

      <div ref={listRef} className="flex min-w-0 flex-col" style={{ gap: '1rem' }}>
        {groups.length === 0 ? (
          <p className="text-[var(--color-text-muted)]" style={{ margin: 0, fontSize: '0.8125rem' }}>
            {FILTER_EMPTY[filter]}
          </p>
        ) : null}

        {groups.map(group => (
          <section key={group.viewport} aria-label={`${group.label} comments`} className="flex flex-col" style={{ gap: '0.5rem' }}>
            <h3
              className="text-[var(--color-text-muted)]"
              style={{ margin: 0, fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase' }}
            >
              {group.label}
            </h3>
            <ul className="flex flex-col" style={{ listStyle: 'none', margin: 0, padding: 0, gap: '0.5rem' }}>
              {group.items.map(comment => {
                const selected = comment.id === selectedId
                const resolved = comment.status === 'resolved'
                const isEditing = editingId === comment.id
                return (
                  <li
                    key={comment.id}
                    data-comment-id={comment.id}
                    className="flex min-w-0 flex-col"
                    style={{
                      gap: '0.5rem',
                      padding: '0.75rem',
                      borderRadius: 'var(--radius-leaf-sm)',
                      border: selected ? '2px solid var(--color-brand)' : '1px solid var(--color-border-subtle)',
                      background: selected ? 'var(--color-brand-50)' : 'var(--color-bg)',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(comment.id)}
                      aria-current={selected ? 'true' : undefined}
                      className="tahi-focus-ring flex min-w-0 items-start text-left transition-colors hover:bg-[var(--color-bg-tertiary)]"
                      style={{ gap: '0.625rem', background: 'transparent', padding: 0, borderRadius: 'var(--radius-leaf-sm)' }}
                    >
                      <span
                        className={resolved ? 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)]' : 'bg-[var(--color-brand)] text-white'}
                        style={{
                          flexShrink: 0,
                          minWidth: '1.75rem',
                          height: '1.75rem',
                          padding: '0 0.375rem',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: 'var(--radius-leaf-sm)',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                        }}
                      >
                        {comment.n}
                      </span>
                      <span className="flex min-w-0 flex-col" style={{ gap: '0.25rem' }}>
                        <span
                          className={resolved ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text)]'}
                          style={{ fontSize: '0.875rem', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                        >
                          {comment.body}
                        </span>
                        <ElementLine comment={comment} />
                      </span>
                    </button>

                    <div className="flex flex-wrap items-center text-[var(--color-text-muted)]" style={{ gap: '0.25rem 0.5rem', fontSize: '0.75rem' }}>
                      <span>{comment.authorName ?? 'Unknown author'}</span>
                      <span aria-hidden="true">·</span>
                      <RelativeTime date={comment.createdAt} />
                      {resolved ? <span>· Resolved</span> : null}
                    </div>

                    {isEditing ? (
                      <div className="flex flex-col" style={{ gap: '0.5rem' }}>
                        <label htmlFor={`edit-${comment.id}`} className="sr-only">Edit comment</label>
                        <Textarea
                          id={`edit-${comment.id}`}
                          value={editBody}
                          onChange={e => setEditBody(e.target.value)}
                          rows={3}
                          maxLength={QA_COMMENT_BODY_MAX}
                          aria-invalid={editError !== null}
                        />
                        {editError ? (
                          <p role="alert" className="text-[var(--color-danger)]" style={{ margin: 0, fontSize: '0.8125rem' }}>
                            {editError}
                          </p>
                        ) : null}
                        <div className="flex justify-end" style={{ gap: '0.5rem' }}>
                          <TahiButton variant="secondary" size="sm" onClick={cancelEdit} disabled={savingEdit} style={ACTION_STYLE}>
                            Cancel
                          </TahiButton>
                          <TahiButton
                            variant="primary"
                            size="sm"
                            onClick={() => void saveEdit(comment)}
                            loading={savingEdit}
                            disabled={savingEdit}
                            style={ACTION_STYLE}
                          >
                            Save
                          </TahiButton>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap" style={{ gap: '0.375rem' }}>
                        <TahiButton variant="secondary" size="sm" onClick={() => onShow(comment)} style={ACTION_STYLE}>
                          Show
                        </TahiButton>
                        <TahiButton
                          variant="secondary"
                          size="sm"
                          onClick={() => void onResolve(comment.id, !resolved)}
                          disabled={readOnly}
                          style={ACTION_STYLE}
                        >
                          {resolved ? 'Reopen' : 'Resolve'}
                        </TahiButton>
                        <TahiButton
                          variant="secondary"
                          size="sm"
                          onClick={() => startEdit(comment)}
                          disabled={readOnly}
                          style={ACTION_STYLE}
                        >
                          Edit
                        </TahiButton>
                        <TahiButton
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteTarget(comment)}
                          disabled={readOnly}
                          style={ACTION_STYLE}
                        >
                          Delete
                        </TahiButton>
                        {comment.requestId ? (
                          <Link
                            href={`/requests/${comment.requestId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="tahi-focus-ring inline-flex items-center rounded-[var(--radius-leaf-sm)] px-2 text-[var(--color-brand-dark)] underline transition-colors hover:bg-[var(--color-bg-tertiary)]"
                            style={{ minHeight: '2.75rem', fontSize: '0.8125rem', fontWeight: 600 }}
                          >
                            Request created
                          </Link>
                        ) : (
                          <TahiButton
                            variant="secondary"
                            size="sm"
                            onClick={() => void onCreateRequest(comment)}
                            disabled={readOnly}
                            style={ACTION_STYLE}
                          >
                            Create request
                          </TahiButton>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete this comment?"
        description={deleteTarget ? `Comment ${deleteTarget.n} will be removed from the round. This cannot be undone.` : ''}
        confirmLabel="Delete comment"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

function ElementLine({ comment }: { comment: QaComment }) {
  const snippet = oneLine(comment.elementText)
  return (
    <span className="flex min-w-0 flex-wrap items-baseline" style={{ gap: '0.25rem 0.5rem' }}>
      <code
        className="shrink-0 rounded-[var(--radius-leaf-sm)] bg-[var(--color-bg-tertiary)] px-1.5 text-[var(--color-text-muted)]"
        style={{ fontSize: '0.75rem', lineHeight: 1.5 }}
      >
        {`<${comment.elementTag ?? 'element'}>`}
      </code>
      {snippet ? (
        <span className="text-[var(--color-text-muted)]" style={{ fontSize: '0.75rem', minWidth: 0, overflowWrap: 'anywhere' }}>
          {snippet}
        </span>
      ) : null}
    </span>
  )
}
