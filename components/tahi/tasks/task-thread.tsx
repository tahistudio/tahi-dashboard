'use client'

/**
 * <TaskThread>. The task's own comment thread, under the description on the
 * task detail: automation notes (Tahi bot, mirrored from a call or a
 * suggestion once later phases land) and the studio's own replies, in one
 * place. A comment on a task with a linked request is also mirrored into
 * that request's thread as an internal message
 * (lib/task-comments.ts#postTaskComment), so this view is the task-only
 * record, not the only place the line appears.
 *
 * Self-contained data, the same shape as <TimeCard>: the panel that mounts
 * this component passes only the task id, and the card fetches, posts and
 * refetches on its own rather than threading state through the shell.
 */

import * as React from 'react'
import { MessageSquare } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { apiPath } from '@/lib/api'
import { SidebarCard } from '@/components/tahi/rail/sidebar-card'
import { BotAvatarMark } from '@/components/tahi/bot-mark'
import { Avatar } from '@/components/tahi/avatar'
import { TahiButton } from '@/components/tahi/tahi-button'
import { useToast } from '@/components/tahi/toast'

interface ThreadComment {
  id: string
  authorType: string
  authorId: string | null
  authorName: string
  body: string
  quote: string | null
  sourceRef: string | null
  createdAt: string
}

function relativeTime(createdAt: string): string {
  try {
    return formatDistanceToNow(new Date(createdAt), { addSuffix: true })
  } catch {
    return ''
  }
}

function CommentRow({ comment }: { comment: ThreadComment }) {
  const isBot = comment.authorType === 'bot'
  return (
    <div className="flex" style={{ gap: '0.5625rem', alignItems: 'flex-start' }}>
      {isBot ? (
        <BotAvatarMark size={24} />
      ) : (
        <Avatar name={comment.authorName} size={24} noRing tooltip={false} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="flex items-center" style={{ gap: '0.4375rem' }}>
          <span style={{ fontSize: '0.78125rem', fontWeight: 700, color: 'var(--color-text)' }}>
            {comment.authorName}
          </span>
          <span style={{ fontSize: '0.71875rem', fontWeight: 500, color: 'var(--color-text-subtle)' }}>
            {relativeTime(comment.createdAt)}
          </span>
        </div>
        {comment.quote && (
          <blockquote
            style={{
              margin: '0.3125rem 0',
              padding: '0.375rem 0.625rem',
              borderLeft: '2px solid var(--color-border)',
              fontSize: '0.78125rem',
              fontStyle: 'italic',
              lineHeight: 1.5,
              color: 'var(--color-text-subtle)',
            }}
          >
            {comment.quote}
          </blockquote>
        )}
        <p
          style={{
            margin: '0.1875rem 0 0',
            fontSize: '0.8125rem',
            lineHeight: 1.55,
            color: 'var(--color-text)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {comment.body}
        </p>
      </div>
    </div>
  )
}

export function TaskThread({ taskId, readOnly }: { taskId: string; readOnly: boolean }) {
  const { showToast } = useToast()
  const [comments, setComments] = React.useState<ThreadComment[]>([])
  const [loading, setLoading] = React.useState(true)
  const [draft, setDraft] = React.useState('')
  const [sending, setSending] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiPath(`/api/admin/tasks/${taskId}/comments`))
      if (!res.ok) throw new Error('Failed to load')
      const json = (await res.json()) as { comments?: ThreadComment[] }
      setComments(json.comments ?? [])
    } catch {
      setComments([])
    } finally {
      setLoading(false)
    }
  }, [taskId])

  React.useEffect(() => { void load() }, [load])

  const submit = React.useCallback(async () => {
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    try {
      const res = await fetch(apiPath(`/api/admin/tasks/${taskId}/comments`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      if (!res.ok) throw new Error('Failed to post')
      setDraft('')
      await load()
    } catch {
      showToast('Could not post that comment', 'error')
    } finally {
      setSending(false)
    }
  }, [draft, sending, taskId, load, showToast])

  return (
    <SidebarCard
      title="Thread"
      icon={<MessageSquare size={14} />}
      count={comments.length > 0 ? comments.length : undefined}
    >
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {[0, 1].map(i => (
            <div
              key={i}
              className="animate-pulse"
              style={{ height: '2.25rem', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-secondary)' }}
            />
          ))}
        </div>
      ) : comments.length === 0 ? (
        <p style={{ margin: 0, fontSize: '0.8125rem', fontWeight: 500, color: 'var(--color-text-subtle)' }}>
          Nothing here yet. Notes on this task, and anything the bot proposes once it does, land here.
        </p>
      ) : (
        // Newest last: a thread reads top to bottom like the conversation it is.
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: readOnly ? 0 : '0.75rem' }}>
          {comments.map(c => <CommentRow key={c.id} comment={c} />)}
        </div>
      )}

      {!readOnly && (
        <div className="flex items-end" style={{ gap: '0.5rem', marginTop: comments.length === 0 && !loading ? '0.625rem' : 0 }}>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void submit()
              }
            }}
            placeholder="Add a note…"
            aria-label="Add a comment"
            rows={1}
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: '2.75rem',
              maxHeight: '8rem',
              padding: '0.625rem 0.75rem',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-bg-secondary)',
              fontFamily: 'inherit',
              fontSize: '0.8125rem',
              lineHeight: 1.5,
              color: 'var(--color-text)',
              resize: 'vertical',
            }}
          />
          <TahiButton
            variant="primary"
            size="md"
            aria-label="Send comment"
            title="Send (Enter). Shift+Enter for a new line."
            disabled={!draft.trim() || sending}
            loading={sending}
            style={{ minHeight: '2.75rem', minWidth: '2.75rem', padding: 0, flexShrink: 0 }}
            onClick={() => { void submit() }}
          >
            <MessageSquare size={15} aria-hidden="true" />
          </TahiButton>
        </div>
      )}
    </SidebarCard>
  )
}
