'use client'

import { formatDistanceToNow } from 'date-fns'
import { Lock, Paperclip, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiPath } from '@/lib/api'
import { sanitizeRichText } from '@/lib/sanitize-rich-text'

/** One file stamped with a message id. Both thread routes return these. */
interface MessageFile {
  id: string
  filename: string
  storageKey: string
  mimeType: string | null
  sizeBytes: number | null
}

interface Message {
  id: string
  authorId: string
  authorType: 'team_member' | 'contact'
  body: string          // HTML from Tiptap
  isInternal: boolean
  editedAt: string | null
  createdAt: string
  /** Attachments posted with this message. Both threads return them; the
   *  portal only ever resolves them for messages the client can already see,
   *  so a file stamped onto an internal note stays out of reach. Optional
   *  because older payloads (and the activity feed) omit the key. */
  files?: MessageFile[]
  teamMemberName?: string | null
  teamMemberAvatar?: string | null
  // Resolved contact-author label from the portal API ("Sam (Acme)").
  authorName?: string | null
  // Server-computed on the portal (own messages carry authorId = contact.id,
  // which never equals the Clerk currentUserId). Admin omits it and falls back
  // to the id comparison below, so admin thread behaviour is unchanged.
  isOwn?: boolean
}

interface RequestThreadProps {
  messages: Message[]
  currentUserId?: string
}

export function RequestThread({ messages, currentUserId }: RequestThreadProps) {
  if (messages.length === 0) {
    return (
      <div className="text-center py-12 text-[var(--color-text-subtle)] text-sm">
        No messages yet. Start the conversation below.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {messages.map((msg) => (
        <MessageBubble
          key={msg.id}
          msg={msg}
          isOwn={msg.isOwn ?? (msg.authorId === currentUserId)}
        />
      ))}
    </div>
  )
}

function MessageBubble({ msg, isOwn }: { msg: Message; isOwn: boolean }) {
  const isTeam = msg.authorType === 'team_member'
  const authorName = isTeam
    ? (msg.teamMemberName ?? 'Tahi Team')
    : (msg.authorName ?? 'Client')

  const timeAgo = (() => {
    try {
      return formatDistanceToNow(new Date(msg.createdAt), { addSuffix: true })
    } catch {
      return ''
    }
  })()

  return (
    <div
      className={cn(
        'group flex gap-3',
        isOwn ? 'flex-row-reverse' : 'flex-row',
      )}
    >
      {/* Avatar */}
      <div className={cn(
        'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold',
        isTeam
          ? 'bg-[var(--color-brand)] text-white'
          : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)]',
      )}>
        {msg.teamMemberAvatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={msg.teamMemberAvatar} alt={authorName} className="w-8 h-8 rounded-full object-cover" />
        ) : (
          <User size={14} />
        )}
      </div>

      {/* Bubble */}
      <div className={cn('flex flex-col gap-1 max-w-[75%]', isOwn ? 'items-end' : 'items-start')}>
        {/* Meta */}
        <div className={cn('flex items-center gap-2 text-xs text-[var(--color-text-subtle)]', isOwn && 'flex-row-reverse')}>
          <span className="font-medium text-[var(--color-text-muted)]">{authorName}</span>
          <span>{timeAgo}</span>
          {msg.editedAt && <span className="italic">(edited)</span>}
          {msg.isInternal && (
            <span
              className="flex items-center gap-0.5 font-semibold"
              style={{ color: 'var(--status-in-review-text)' }}
            >
              <Lock size={10} aria-hidden="true" />
              Internal
            </span>
          )}
        </div>

        {/* Content. Internal is tested BEFORE own: an internal note you wrote
            yourself is still an internal note, and painting it brand green
            would make the one bubble the client must never see look exactly
            like the ones they do see. Own-ness survives as the mirrored
            corner only. Tokens are the in-review (amber) family rather than
            --color-warning-bg, which has no dark override and would render a
            cream bubble under --color-text in dark mode. */}
        <div
          className={cn(
            'px-4 py-3 rounded-[0_12px_0_12px] text-sm prose prose-sm max-w-none',
            msg.isInternal
              ? cn('border', isOwn && 'rounded-[12px_0_12px_0]')
              : isOwn
                ? 'bg-[var(--color-brand)] text-white prose-invert rounded-[12px_0_12px_0]'
                : 'bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text)]',
          )}
          style={msg.isInternal ? {
            background: 'var(--status-in-review-bg)',
            borderColor: 'var(--status-in-review-border)',
            color: 'var(--status-in-review-text)',
          } : undefined}
          // Not every writer sanitises on the way in: the admin messages POST
          // stores the body it is handed, and rows written before that gap was
          // found are still in the table. The allowlist runs here so the
          // reader is filtered whichever path wrote the row.
          dangerouslySetInnerHTML={{ __html: sanitizeRichText(msg.body) }}
        />

        {/* Files posted with this message, under the sentence that explains
            them. The Files panel still lists every attachment on the request;
            this is the one that says which reply carried it. */}
        {(msg.files?.length ?? 0) > 0 && (
          <ul
            className={cn('flex flex-col gap-1 list-none p-0 m-0', isOwn ? 'items-end' : 'items-start')}
            aria-label="Attachments"
          >
            {msg.files?.map(f => (
              <li key={f.id}>
                <a
                  data-private
                  href={apiPath(`/api/uploads/serve?key=${encodeURIComponent(f.storageKey)}`)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tahi-focus-ring inline-flex items-center gap-1.5 text-xs min-h-11 md:min-h-7"
                  style={{
                    padding: '0.25rem 0.5rem',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--color-bg)',
                    color: 'var(--color-text-muted)',
                    textDecoration: 'none',
                    maxWidth: '100%',
                  }}
                >
                  <Paperclip size={11} aria-hidden="true" style={{ flexShrink: 0 }} />
                  <span className="truncate">{f.filename}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
