'use client'

/**
 * <MessageThread>. The shared messaging container.
 *
 * Renders:
 *   - Optional thread header (title + participant stack + actions)
 *   - Day separators ("Today", "Yesterday", date) between messages
 *     based on the timestamp prop
 *   - A list of <MessageBubble>s (or any custom renderer per item)
 *   - Optional reply-to context strip above the composer
 *   - Optional composer slot at the bottom (typically <MessageComposer>)
 *   - Optional "Load older" affordance at the top
 *
 *   <MessageThread
 *     title="Glasswall · Web redesign"
 *     visibility="external"
 *     participants={[
 *       { id: '1', name: 'Liam', avatarUrl, role: 'admin' },
 *       { id: '2', name: 'Anna', role: 'client' },
 *     ]}
 *     messages={messages}
 *     renderMessage={msg => <MessageBubble {...msg} />}
 *     replyTo={replyParent}
 *     onCancelReply={() => setReply(null)}
 *     composer={<MessageComposer onSend={send} />}
 *     onLoadOlder={loadOlder}
 *     hasMore
 *   />
 *
 * Works for 1:1 DMs, group chats, org channels, request comment
 * threads, deal activity. The thread itself is a generic container;
 * the caller decides what to render in each row and supplies the
 * composer.
 */

import * as React from 'react'
import { ChevronUp, Lock, Loader2 } from 'lucide-react'
import { Avatar } from '@/components/tahi/avatar'
import { Badge } from '@/components/tahi/badge'

export interface MessageThreadParticipant {
  id?: string
  name: string
  avatarUrl?: string
  role?: 'admin' | 'client' | 'system' | string
}

/** Minimal shape the thread needs from each message. */
export interface MessageThreadItem {
  id: string
  /** ISO timestamp used to group messages by day. */
  timestamp: string
}

export interface MessageReplyContext {
  authorName: string
  preview: string
}

interface MessageThreadProps<M extends MessageThreadItem> {
  messages: ReadonlyArray<M>
  renderMessage: (message: M, index: number) => React.ReactNode

  /** Optional header. */
  title?: React.ReactNode
  subtitle?: React.ReactNode
  participants?: ReadonlyArray<MessageThreadParticipant>
  visibility?: 'internal' | 'external'
  /** Slot in the top-right of the header for action buttons. */
  headerActions?: React.ReactNode

  /** When set, the thread is in reply mode: shows a strip above the
   *  composer with the parent message preview + a cancel button. */
  replyTo?: MessageReplyContext | null
  onCancelReply?: () => void

  /** Composer slot at the bottom. Usually <MessageComposer />. */
  composer?: React.ReactNode

  /** When true, show a "Load older" button at the top of the list. */
  hasMore?: boolean
  loadingOlder?: boolean
  onLoadOlder?: () => void

  /** Replaces the body with a centred spinner. */
  loading?: boolean
  /** Render when messages is empty AND not loading. */
  empty?: React.ReactNode

  /** Maximum height for the scrolling area. Default '32rem'. Pass
   *  'none' to let it grow with content (when the parent caps it). */
  maxHeight?: string | 'none'

  className?: string
}

export function MessageThread<M extends MessageThreadItem>({
  messages,
  renderMessage,
  title,
  subtitle,
  participants,
  visibility = 'external',
  headerActions,
  replyTo,
  onCancelReply,
  composer,
  hasMore = false,
  loadingOlder = false,
  onLoadOlder,
  loading = false,
  empty,
  maxHeight = '32rem',
  className,
}: MessageThreadProps<M>) {
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  // Anchor scroll to the bottom on initial mount + when the message
  // count grows (e.g. new message sent).
  const lastCount = React.useRef(messages.length)
  React.useEffect(() => {
    if (!scrollRef.current) return
    const shouldStick = messages.length > lastCount.current
    lastCount.current = messages.length
    if (shouldStick) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages.length])
  React.useEffect(() => {
    // On first mount, scroll to bottom regardless of count change.
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [])

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-card)',
        overflow: 'hidden',
        minHeight: 0,
      }}
    >
      {(title || subtitle || participants || headerActions) && (
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            padding: '0.75rem 1rem',
            borderBottom: '1px solid var(--color-border-subtle)',
            background: 'var(--color-bg)',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            {title && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4375rem',
                  fontSize: 'var(--text-md)',
                  fontWeight: 600,
                  color: 'var(--color-text)',
                  lineHeight: 1.3,
                }}
              >
                {title}
                {visibility === 'internal' && (
                  <Badge tone="warning" variant="soft" size="sm" leader="icon" icon={<Lock />}>
                    Internal
                  </Badge>
                )}
              </div>
            )}
            {subtitle && (
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: '0.125rem' }}>
                {subtitle}
              </div>
            )}
          </div>
          {participants && participants.length > 0 && (
            <Avatar.Stack max={4}>
              {participants.map(p => (
                <Avatar key={p.id ?? p.name} name={p.name} src={p.avatarUrl} size="xs" noRing />
              ))}
            </Avatar.Stack>
          )}
          {headerActions && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              {headerActions}
            </div>
          )}
        </header>
      )}

      {/* Scrolling messages area */}
      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        style={{
          flex: 1,
          minHeight: 0,
          maxHeight: maxHeight === 'none' ? undefined : maxHeight,
          overflowY: 'auto',
          padding: '0.75rem 1rem',
          background: 'var(--color-bg)',
        }}
      >
        {hasMore && (
          <div style={{ textAlign: 'center', marginBottom: '0.75rem' }}>
            <button
              type="button"
              onClick={onLoadOlder}
              disabled={loadingOlder}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.3125rem',
                padding: '0.3125rem 0.75rem',
                background: 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-xs)',
                fontWeight: 500,
                color: 'var(--color-text-muted)',
                cursor: loadingOlder ? 'wait' : 'pointer',
                transition: 'background-color 150ms ease',
              }}
              onMouseEnter={e => {
                if (loadingOlder) return
                e.currentTarget.style.background = 'var(--color-bg-tertiary)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'var(--color-bg-secondary)'
              }}
            >
              {loadingOlder
                ? <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                : <ChevronUp size={12} aria-hidden="true" />}
              {loadingOlder ? 'Loading' : 'Load older messages'}
            </button>
          </div>
        )}
        {loading ? (
          <div style={{ padding: '2rem', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-subtle)', fontSize: 'var(--text-sm)' }}>
            <Loader2 size={16} className="animate-spin" style={{ color: 'var(--color-brand)', marginRight: '0.5rem' }} aria-hidden="true" />
            Loading messages
          </div>
        ) : messages.length === 0 ? (
          <div style={{ padding: '2rem 1rem' }}>
            {empty ?? (
              <div style={{ textAlign: 'center', color: 'var(--color-text-subtle)', fontSize: 'var(--text-sm)' }}>
                No messages yet.
              </div>
            )}
          </div>
        ) : (
          messages.map((msg, i) => {
            const prev = messages[i - 1]
            const showDay = !prev || dayKey(prev.timestamp) !== dayKey(msg.timestamp)
            return (
              <React.Fragment key={msg.id}>
                {showDay && <DaySeparator timestamp={msg.timestamp} />}
                {renderMessage(msg, i)}
              </React.Fragment>
            )
          })
        )}
      </div>

      {/* Reply-to strip + composer */}
      {(composer || replyTo) && (
        <div
          style={{
            borderTop: '1px solid var(--color-border-subtle)',
            background: 'var(--color-bg)',
          }}
        >
          {replyTo && (
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.5rem',
                padding: '0.5rem 0.875rem',
                borderBottom: '1px solid var(--color-border-subtle)',
                background: 'var(--color-bg-secondary)',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: '0.6875rem',
                  fontWeight: 600,
                  color: 'var(--color-text-subtle)',
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                }}>
                  Replying to {replyTo.authorName}
                </div>
                <div style={{
                  fontSize: 'var(--text-sm)',
                  color: 'var(--color-text-muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {replyTo.preview}
                </div>
              </div>
              {onCancelReply && (
                <button
                  type="button"
                  onClick={onCancelReply}
                  aria-label="Cancel reply"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: '0.125rem 0.4375rem',
                    color: 'var(--color-text-subtle)',
                    fontSize: 'var(--text-xs)',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          )}
          {composer && (
            <div style={{ padding: '0.625rem 0.875rem' }}>
              {composer}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Day separator ───────────────────────────────────────────────────────────

function DaySeparator({ timestamp }: { timestamp: string }) {
  const label = formatDay(timestamp)
  return (
    <div
      role="separator"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.625rem',
        margin: '0.5rem 0 0.75rem',
      }}
    >
      <span style={{ flex: 1, height: 1, background: 'var(--color-border-subtle)' }} />
      <span
        style={{
          fontSize: '0.625rem',
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--color-text-subtle)',
        }}
      >
        {label}
      </span>
      <span style={{ flex: 1, height: 1, background: 'var(--color-border-subtle)' }} />
    </div>
  )
}

function dayKey(ts: string): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function formatDay(ts: string): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diffDays = Math.round((today.getTime() - that.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays > 1 && diffDays < 7) {
    return that.toLocaleDateString('en', { weekday: 'long' })
  }
  return that.toLocaleDateString('en', { day: 'numeric', month: 'short', year: that.getFullYear() === now.getFullYear() ? undefined : 'numeric' })
}
