'use client'

/**
 * <MessageBubble>. One message. Used inside request threads,
 * conversations, deal activity, doc comments, anywhere we render a
 * single message.
 *
 *   <MessageBubble
 *     author={{ name: 'Liam', avatarUrl, role: 'admin' }}
 *     timestamp="2026-05-23T10:14:00Z"
 *     bodyHtml={message.tiptapHtml}
 *     reactions={[{ emoji: '👍', count: 2, mine: true }]}
 *     attachments={message.files}
 *     voiceNote={message.voiceNote}
 *     visibility="internal"
 *     replyTo={parentMessage}
 *     own
 *     actions={[
 *       { label: 'Reply', icon: <Reply />, onClick },
 *       { label: 'Edit', icon: <Pencil />, onClick },
 *       { label: 'Delete', icon: <Trash />, tone: 'danger', onClick },
 *     ]}
 *     onReact={emoji => addReaction(message.id, emoji)}
 *     onReply={() => setReplyParent(message)}
 *   />
 *
 * Layout variants:
 *   own = true   right-aligned bubble (current user's message).
 *                Brand-tinted background.
 *   own = false  left-aligned (default). Neutral bubble.
 *
 *   visibility = 'internal'  shows a small "Internal" chip in the
 *                            header so the team knows clients can't
 *                            see this message.
 *
 *   replyTo                  shows a quoted parent above the body so
 *                            threaded context is visible inline.
 *
 *   compact                  tighter padding for dense activity feeds.
 */

import * as React from 'react'
import { Smile, MoreHorizontal, CornerDownRight } from 'lucide-react'
import { Avatar } from '@/components/tahi/avatar'
import { FileAttachmentList, type FileAttachment } from '@/components/tahi/file-attachment-list'
import { Popover } from '@/components/tahi/popover'
import { Tooltip } from '@/components/tahi/tooltip'

export interface MessageAuthor {
  id?: string
  name: string
  avatarUrl?: string
  /** Display badge: admin (Tahi team) vs client vs system. Affects nothing
   *  functional, just shown as a small tag next to the name. */
  role?: 'admin' | 'client' | 'system' | string
}

export interface MessageReaction {
  emoji: string
  count: number
  /** When true, the current user has reacted with this emoji. */
  mine?: boolean
}

export interface MessageVoiceNote {
  url: string
  durationSeconds?: number
  /** Optional rendered AI transcript. */
  transcript?: string
}

export interface MessageReplyParent {
  authorName: string
  preview: string
  onClick?: () => void
}

export interface MessageAction {
  label: string
  icon?: React.ReactNode
  onClick: () => void
  tone?: 'default' | 'danger'
  disabled?: boolean
}

interface MessageBubbleProps {
  author: MessageAuthor
  /** ISO timestamp or formatted string. ISO is auto-formatted to relative time. */
  timestamp: string
  /** Tiptap-rendered HTML or any React node. */
  bodyHtml?: string
  body?: React.ReactNode
  attachments?: ReadonlyArray<FileAttachment>
  voiceNote?: MessageVoiceNote
  reactions?: ReadonlyArray<MessageReaction>
  replyTo?: MessageReplyParent
  /** Internal = Tahi-team only. Shows a small lock chip. */
  visibility?: 'internal' | 'external'
  /** Right-aligned brand-tinted variant for "my" messages in 1:1 / group chats.
   *  Default false (everyone is left-aligned, threaded-comment style). */
  own?: boolean
  /** Compact spacing for dense activity feeds. */
  compact?: boolean
  /** Show edited indicator next to the timestamp. */
  editedAt?: string
  /** Show "seen" indicator (used in DMs). */
  seen?: boolean

  /** Actions menu items shown behind the 3-dots button on hover. */
  actions?: ReadonlyArray<MessageAction>
  /** When set, the smiley emoji-add button shows; calling adds a reaction. */
  onReact?: (emoji: string) => void
  /** Click on any reaction chip to toggle it. */
  onToggleReaction?: (emoji: string) => void
  /** Click "Reply". Convenience entry, otherwise add a Reply action. */
  onReply?: () => void
  /** Click the avatar (or author name) to navigate to the author's
   *  profile. Hover state added when set. */
  onAuthorClick?: (author: MessageAuthor) => void

  className?: string
}

const QUICK_EMOJIS = ['👍', '❤️', '🎉', '👀', '🙏', '🔥']

export function MessageBubble({
  author,
  timestamp,
  bodyHtml,
  body,
  attachments,
  voiceNote,
  reactions,
  replyTo,
  visibility = 'external',
  own = false,
  compact = false,
  editedAt,
  seen,
  actions,
  onReact,
  onToggleReaction,
  onReply,
  onAuthorClick,
  className,
}: MessageBubbleProps) {
  const [emojiOpen, setEmojiOpen] = React.useState(false)
  const [actionsOpen, setActionsOpen] = React.useState(false)
  const emojiRef = React.useRef<HTMLButtonElement | null>(null)
  const actionsRef = React.useRef<HTMLButtonElement | null>(null)

  const isInternal = visibility === 'internal'
  const bubbleBg = isInternal
    ? 'var(--color-warning-bg, rgba(245, 158, 11, 0.07))'
    : own
      ? 'var(--color-brand-50)'
      : 'var(--color-bg-secondary)'
  const bubbleBorder = isInternal
    ? '1px solid rgba(245, 158, 11, 0.22)'
    : own
      ? '1px solid var(--color-brand-100)'
      : '1px solid var(--color-border-subtle)'

  const padding = compact ? '0.4375rem 0.625rem' : '0.625rem 0.875rem'
  const bubbleStyle: React.CSSProperties = {
    background: bubbleBg,
    border: bubbleBorder,
    borderRadius: 'var(--radius-md)',
    padding,
    color: 'var(--color-text)',
    fontSize: 'var(--text-sm)',
    lineHeight: 1.5,
    wordBreak: 'break-word',
    maxWidth: own ? '85%' : '100%',
  }

  const handleAddReaction = (emoji: string) => {
    onReact?.(emoji)
    setEmojiOpen(false)
  }

  return (
    <div
      className={['tahi-message-bubble', className].filter(Boolean).join(' ')}
      style={{
        display: 'flex',
        gap: '0.625rem',
        flexDirection: own ? 'row-reverse' : 'row',
        alignItems: 'flex-start',
        marginBottom: compact ? '0.5rem' : '0.875rem',
      }}
    >
      {/* Avatar. Clickable to author profile when onAuthorClick is set. */}
      <span style={{ flexShrink: 0, paddingTop: '0.125rem' }}>
        {onAuthorClick ? (
          <button
            type="button"
            onClick={() => onAuthorClick(author)}
            aria-label={`Open ${author.name}'s profile`}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 0,
              borderRadius: '999px',
              cursor: 'pointer',
              transition: 'box-shadow 150ms ease',
              display: 'inline-flex',
            }}
            onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 0 0 2px var(--color-brand-100)' }}
            onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none' }}
            onFocus={e => { e.currentTarget.style.boxShadow = '0 0 0 2px var(--color-brand-100)' }}
            onBlur={e => { e.currentTarget.style.boxShadow = 'none' }}
          >
            <Avatar
              name={author.name}
              src={author.avatarUrl}
              size={compact ? 'xs' : 'sm'}
              noRing
            />
          </button>
        ) : (
          <Avatar
            name={author.name}
            src={author.avatarUrl}
            size={compact ? 'xs' : 'sm'}
            noRing
          />
        )}
      </span>

      {/* Body column */}
      <div
        style={{
          minWidth: 0,
          maxWidth: 'calc(100% - 2.5rem)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.25rem',
          alignItems: own ? 'flex-end' : 'flex-start',
        }}
      >
        {/* Header. First name + timestamp, with a small orange dot
            indicating internal-only notes (Tahi team can see, client
            cannot). Tooltip on the dot explains. Role-based badges
            (Tahi / Client) intentionally omitted — they were noise. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: '0.4375rem',
            flexDirection: own ? 'row-reverse' : 'row',
            flexWrap: 'wrap',
          }}
        >
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4375rem',
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            color: 'var(--color-text)',
          }}>
            {onAuthorClick ? (
              <button
                type="button"
                onClick={() => onAuthorClick(author)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  font: 'inherit',
                  color: 'inherit',
                  cursor: 'pointer',
                }}
                onMouseEnter={e => { e.currentTarget.style.textDecoration = 'underline' }}
                onMouseLeave={e => { e.currentTarget.style.textDecoration = 'none' }}
              >
                {firstNameOf(author.name)}
              </button>
            ) : (
              firstNameOf(author.name)
            )}
            {isInternal && (
              <Tooltip
                label="Internal note. Only the Tahi team can see this."
                side="top"
              >
                <span
                  role="img"
                  aria-label="Internal note"
                  tabIndex={0}
                  style={{
                    display: 'inline-block',
                    width: '0.5rem',
                    height: '0.5rem',
                    borderRadius: 999,
                    background: '#F59E0B',
                    flexShrink: 0,
                    cursor: 'help',
                  }}
                />
              </Tooltip>
            )}
          </span>
          <span
            style={{
              fontSize: '0.6875rem',
              color: 'var(--color-text-subtle)',
              fontWeight: 500,
            }}
            title={timestamp}
          >
            {formatTimestamp(timestamp)}
            {editedAt && <span style={{ marginLeft: '0.3125rem', fontStyle: 'italic' }}>(edited)</span>}
          </span>
        </div>

        {/* Bubble */}
        <div style={bubbleStyle}>
          {/* Reply-to quote */}
          {replyTo && (
            <button
              type="button"
              onClick={replyTo.onClick}
              style={{
                display: 'flex',
                gap: '0.3125rem',
                alignItems: 'flex-start',
                width: '100%',
                padding: '0.375rem 0.5rem',
                marginBottom: '0.5rem',
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 'var(--radius-sm)',
                cursor: replyTo.onClick ? 'pointer' : 'default',
                textAlign: 'left',
              }}
            >
              <CornerDownRight
                size={11}
                aria-hidden="true"
                style={{ color: 'var(--color-text-subtle)', flexShrink: 0, marginTop: '0.125rem' }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
                  {replyTo.authorName}
                </div>
                <div
                  style={{
                    fontSize: 'var(--text-xs)',
                    color: 'var(--color-text-subtle)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: '24rem',
                  }}
                >
                  {replyTo.preview}
                </div>
              </div>
            </button>
          )}

          {/* Body. Either dangerouslySetInnerHTML (Tiptap output) or arbitrary node. */}
          {bodyHtml
            ? <div className="tahi-message-body" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
            : body}

          {/* Voice note */}
          {voiceNote && <VoiceNoteInline voiceNote={voiceNote} />}

          {/* Attachments inside the bubble for context. Compact list. */}
          {attachments && attachments.length > 0 && (
            <div style={{ marginTop: '0.5rem' }}>
              <FileAttachmentList
                items={attachments}
                variant={attachments.some(a => isProbablyImage(a)) ? 'grid' : 'list'}
                maxItems={attachments.length > 6 ? 5 : undefined}
              />
            </div>
          )}
        </div>

        {/* Reactions */}
        {reactions && reactions.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.25rem',
              alignItems: 'center',
            }}
          >
            {reactions.map(r => (
              <button
                key={r.emoji}
                type="button"
                onClick={() => onToggleReaction?.(r.emoji)}
                aria-pressed={r.mine || undefined}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.1875rem',
                  height: '1.375rem',
                  padding: '0 0.4375rem',
                  background: r.mine ? 'var(--color-brand-50)' : 'var(--color-bg-secondary)',
                  border: r.mine
                    ? '1px solid var(--color-brand-100)'
                    : '1px solid var(--color-border-subtle)',
                  borderRadius: 999,
                  fontSize: '0.6875rem',
                  fontWeight: 500,
                  color: r.mine ? 'var(--color-text-active)' : 'var(--color-text)',
                  cursor: onToggleReaction ? 'pointer' : 'default',
                  transition: 'background-color 150ms ease, border-color 150ms ease',
                }}
              >
                <span aria-hidden="true">{r.emoji}</span>
                <span>{r.count}</span>
              </button>
            ))}
            {onReact && (
              <button
                ref={emojiRef}
                type="button"
                onClick={() => setEmojiOpen(o => !o)}
                aria-label="Add reaction"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '1.375rem',
                  height: '1.375rem',
                  background: 'transparent',
                  border: '1px dashed var(--color-border)',
                  borderRadius: 999,
                  color: 'var(--color-text-subtle)',
                  cursor: 'pointer',
                  transition: 'background-color 150ms ease, color 150ms ease',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'var(--color-bg-secondary)'
                  e.currentTarget.style.color = 'var(--color-text)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.color = 'var(--color-text-subtle)'
                }}
              >
                <Smile size={11} aria-hidden="true" />
              </button>
            )}
            <Popover
              anchorRef={emojiRef}
              open={emojiOpen}
              onClose={() => setEmojiOpen(false)}
              align="start"
              width="auto"
            >
              <div style={{ display: 'flex', gap: '0.125rem', padding: '0.25rem' }}>
                {QUICK_EMOJIS.map(e => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => handleAddReaction(e)}
                    aria-label={`React with ${e}`}
                    style={{
                      width: '2rem',
                      height: '2rem',
                      background: 'transparent',
                      border: 'none',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '1.125rem',
                      cursor: 'pointer',
                      transition: 'background-color 120ms ease',
                    }}
                    onMouseEnter={ev => { ev.currentTarget.style.background = 'var(--color-bg-secondary)' }}
                    onMouseLeave={ev => { ev.currentTarget.style.background = 'transparent' }}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </Popover>
          </div>
        )}

        {/* Seen indicator (DMs only). Tiny muted line. */}
        {seen && (
          <span style={{ fontSize: '0.625rem', color: 'var(--color-text-subtle)' }}>
            Seen
          </span>
        )}
      </div>

      {/* Hover actions: emoji add + 3-dots. Sit OUTSIDE the bubble so
          the same row works for owned + other-author messages. */}
      {(onReact || onReply || (actions && actions.length > 0)) && (
        <div
          className="tahi-message-actions"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.125rem',
            paddingTop: '0.25rem',
            transition: 'opacity 150ms ease',
          }}
        >
          {onReact && (!reactions || reactions.length === 0) && (
            <>
              <button
                ref={emojiRef}
                type="button"
                onClick={() => setEmojiOpen(o => !o)}
                aria-label="Add reaction"
                style={hoverActionStyle}
                onMouseEnter={hoverActionEnter}
                onMouseLeave={hoverActionLeave}
              >
                <Smile size={13} aria-hidden="true" />
              </button>
              <Popover
                anchorRef={emojiRef}
                open={emojiOpen}
                onClose={() => setEmojiOpen(false)}
                align="end"
                width="auto"
              >
                <div style={{ display: 'flex', gap: '0.125rem', padding: '0.25rem' }}>
                  {QUICK_EMOJIS.map(e => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => handleAddReaction(e)}
                      aria-label={`React with ${e}`}
                      style={{
                        width: '2rem',
                        height: '2rem',
                        background: 'transparent',
                        border: 'none',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '1.125rem',
                        cursor: 'pointer',
                      }}
                      onMouseEnter={ev => { ev.currentTarget.style.background = 'var(--color-bg-secondary)' }}
                      onMouseLeave={ev => { ev.currentTarget.style.background = 'transparent' }}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </Popover>
            </>
          )}
          {onReply && (
            <button
              type="button"
              onClick={onReply}
              aria-label="Reply"
              style={hoverActionStyle}
              onMouseEnter={hoverActionEnter}
              onMouseLeave={hoverActionLeave}
            >
              <CornerDownRight size={13} aria-hidden="true" />
            </button>
          )}
          {actions && actions.length > 0 && (
            <>
              <button
                ref={actionsRef}
                type="button"
                onClick={() => setActionsOpen(o => !o)}
                aria-label="More actions"
                style={hoverActionStyle}
                onMouseEnter={hoverActionEnter}
                onMouseLeave={hoverActionLeave}
              >
                <MoreHorizontal size={13} aria-hidden="true" />
              </button>
              <Popover
                anchorRef={actionsRef}
                open={actionsOpen}
                onClose={() => setActionsOpen(false)}
                align="end"
                width="11rem"
              >
                <div role="menu">
                  {actions.map((a, i) => (
                    <button
                      key={i}
                      type="button"
                      role="menuitem"
                      disabled={a.disabled}
                      onClick={() => { a.onClick(); setActionsOpen(false) }}
                      className="w-full inline-flex items-center"
                      style={{
                        gap: '0.5rem',
                        padding: '0.4375rem 0.625rem',
                        background: 'transparent',
                        border: 'none',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: 'var(--text-sm)',
                        color: a.tone === 'danger' ? 'var(--color-danger)' : 'var(--color-text)',
                        cursor: a.disabled ? 'not-allowed' : 'pointer',
                        opacity: a.disabled ? 0.5 : 1,
                        textAlign: 'left',
                      }}
                      onMouseEnter={e => {
                        if (a.disabled) return
                        e.currentTarget.style.background = a.tone === 'danger'
                          ? 'var(--color-danger-bg, rgba(220, 38, 38, 0.10))'
                          : 'var(--color-bg-secondary)'
                      }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                    >
                      {a.icon && (
                        <span style={{
                          color: a.tone === 'danger' ? 'var(--color-danger)' : 'var(--color-text-muted)',
                          display: 'inline-flex',
                        }}>
                          {a.icon}
                        </span>
                      )}
                      {a.label}
                    </button>
                  ))}
                </div>
              </Popover>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const hoverActionStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '1.5rem',
  height: '1.5rem',
  background: 'transparent',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-text-subtle)',
  cursor: 'pointer',
  transition: 'background-color 150ms ease, color 150ms ease',
}
function hoverActionEnter(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.background = 'var(--color-bg-secondary)'
  e.currentTarget.style.color = 'var(--color-text)'
}
function hoverActionLeave(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.background = 'transparent'
  e.currentTarget.style.color = 'var(--color-text-subtle)'
}

function isProbablyImage(a: FileAttachment): boolean {
  if (a.thumbnailUrl) return true
  const ext = (a.name.split('.').pop() ?? '').toLowerCase()
  return (a.mime ?? '').startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'].includes(ext)
}

function firstNameOf(fullName: string): string {
  // "Liam Miller" -> "Liam". Falls back to the whole string for
  // single-word names or unusual inputs.
  const trimmed = fullName.trim()
  const space = trimmed.indexOf(' ')
  if (space < 0) return trimmed
  return trimmed.slice(0, space)
}

function formatTimestamp(ts: string): string {
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ts
  const now = Date.now()
  const diff = now - date.getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 30) return 'Just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  return date.toLocaleDateString('en', { day: 'numeric', month: 'short' })
}

// ── Voice note inline player (lightweight placeholder) ──────────────────────
//
// Renders an audio element with a label + duration. The real recorder
// + playback infrastructure lives elsewhere; this primitive embeds the
// playback control consistently in the bubble.

function VoiceNoteInline({ voiceNote }: { voiceNote: MessageVoiceNote }) {
  return (
    <div
      style={{
        marginTop: '0.5rem',
        padding: '0.4375rem 0.5rem',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-sm)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.375rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span
          aria-hidden="true"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '1.5rem',
            height: '1.5rem',
            borderRadius: 999,
            background: 'var(--color-brand-50)',
            color: 'var(--color-brand)',
            flexShrink: 0,
            fontSize: '0.6875rem',
            fontWeight: 700,
          }}
        >
          ♪
        </span>
        <audio controls src={voiceNote.url} style={{ width: '100%', maxWidth: '20rem', height: '2rem' }} />
        {voiceNote.durationSeconds != null && (
          <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)', flexShrink: 0 }}>
            {formatDuration(voiceNote.durationSeconds)}
          </span>
        )}
      </div>
      {voiceNote.transcript && (
        <p style={{
          margin: 0,
          fontSize: '0.6875rem',
          color: 'var(--color-text-muted)',
          fontStyle: 'italic',
          lineHeight: 1.5,
        }}>
          &ldquo;{voiceNote.transcript}&rdquo;
        </p>
      )}
    </div>
  )
}

function formatDuration(seconds: number): string {
  const min = Math.floor(seconds / 60)
  const sec = Math.floor(seconds % 60)
  return `${min}:${String(sec).padStart(2, '0')}`
}
