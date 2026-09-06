'use client'

/**
 * <ThreadPane>. One open room: the head, the messages, and the composer.
 *
 * The head carries the title, the status line, the people stack and, on a
 * request thread, "Open the request". At 375 it also grows a Back button,
 * because selecting a room replaces the list rather than sitting beside it.
 *
 * Two dividers inside the body, and only two:
 *   - a DAY divider whenever the calendar day changes;
 *   - a single NEW line at the first message the reader had not seen. It is
 *     drawn from the cursor the GET returned, captured BEFORE the explicit
 *     mark-read fires, which is why the read does not erase the line it was
 *     supposed to draw.
 */

import * as React from 'react'
import { ArrowLeft, ExternalLink, Eye, Lock, MessageCircle, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { Avatar } from '@/components/tahi/avatar'
import { apiPath } from '@/lib/api'
import { REQUEST_STATUS_LABEL } from '@/lib/messages-inbox'
import { MessageBox } from './message-box'
import type { StagedAttachment, ThreadMessageView, ThreadPayload } from './types'

const STATUS_DOT: Readonly<Record<string, string>> = {
  submitted: 'var(--color-text-subtle)',
  in_review: 'var(--color-warning)',
  in_progress: 'var(--color-info)',
  client_review: 'var(--color-warning)',
  on_hold: 'var(--color-text-subtle)',
  delivered: 'var(--color-brand)',
  cancelled: 'var(--color-text-subtle)',
  archived: 'var(--color-text-subtle)',
}

const DAY_FORMAT = new Intl.DateTimeFormat('en-NZ', { weekday: 'long', day: 'numeric', month: 'short' })
const TIME_FORMAT = new Intl.DateTimeFormat('en-NZ', { hour: 'numeric', minute: '2-digit' })

function dayKey(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

function dayLabel(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const today = new Date()
  const key = d.toISOString().slice(0, 10)
  if (key === today.toISOString().slice(0, 10)) return 'Today'
  const yesterday = new Date(today.getTime() - 86_400_000)
  if (key === yesterday.toISOString().slice(0, 10)) return 'Yesterday'
  return DAY_FORMAT.format(d)
}

function timeLabel(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : TIME_FORMAT.format(d)
}

export interface ThreadPaneProps {
  payload: ThreadPayload | null
  state: 'idle' | 'loading' | 'error' | 'ready'
  /** The cursor as it stood when the room was opened. Drives the New line. */
  seenCursor: string | null
  audience: 'client' | 'studio'
  narrow: boolean
  onBack: () => void
  onRetryLoad: () => void
  onSend: (input: { body: string; isInternal: boolean; attachments: StagedAttachment[] }) => Promise<boolean>
  onRetryMessage: (message: ThreadMessageView) => void
  attachments: StagedAttachment[]
  onPickFiles: (files: FileList | null) => void
  onRemoveAttachment: (key: string) => void
  onVoice: () => void
  recording: boolean
  clientName: string | null
}

export function ThreadPane({
  payload,
  state,
  seenCursor,
  audience,
  narrow,
  onBack,
  onRetryLoad,
  onSend,
  onRetryMessage,
  attachments,
  onPickFiles,
  onRemoveAttachment,
  onVoice,
  recording,
  clientName,
}: ThreadPaneProps) {
  const scroller = React.useRef<HTMLDivElement | null>(null)
  const messageCount = payload?.messages.length ?? 0

  // The pane is a skeleton on the first paint and the ref is still null, so
  // the scroll has to run on state as well as on the count: without it the
  // newest message stays under the fold on open.
  React.useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [state, messageCount, payload?.thread.key])

  if (state === 'idle' || !payload) {
    return (
      <div className="pfm-thread empty">
        <div className="pfm-empty">
          <span className="pfm-empty-ic"><MessageCircle size={20} aria-hidden="true" /></span>
          <h2>Pick a conversation</h2>
          <p>
            {audience === 'client'
              ? 'Your studio line sits at the top. Every request you have open also has its own thread.'
              : 'Every client has a standing line, and every request has its own thread.'}
          </p>
        </div>
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className="pfm-thread">
        <div className="pfm-err" role="alert">
          <span className="pfm-err-t">
            <b>We could not open that conversation</b>
            <small>It may have moved, or the connection dropped. Try again in a moment.</small>
          </span>
          <button type="button" className="pfm-btn tahi-focus-ring" onClick={onRetryLoad}>Try again</button>
        </div>
      </div>
    )
  }

  const { thread, people, messages } = payload
  const title = thread.source === 'request' && thread.requestNumber !== null
    ? `TR-${thread.requestNumber} ${thread.title}`
    : thread.title
  // Read from the room, never hardcoded: the studio side of a client's
  // standing line is whoever is actually in it, so the line stays true the
  // day somebody joins the team or a client is reassigned.
  const studioSide = people.filter(p => p.side === 'team').map(p => p.name)

  return (
    <div className="pfm-thread">
      <header className="pfm-thread-head">
        {narrow && (
          <button type="button" className="pfm-icon-btn tahi-focus-ring" onClick={onBack} aria-label="Back to conversations">
            <ArrowLeft size={18} aria-hidden="true" />
          </button>
        )}
        <div className="pfm-thread-title">
          <h2>{title}</h2>
          <p>
            {thread.source === 'channel' ? (
              audience === 'client'
                ? <span>{studioLine(studioSide)}</span>
                : <span>{thread.orgName ? `The standing line with ${thread.orgName}` : 'A standing client line'}</span>
            ) : (
              <>
                <span
                  className="pfm-dot"
                  aria-hidden="true"
                  style={{ background: STATUS_DOT[thread.status ?? ''] ?? 'var(--color-text-subtle)' }}
                />
                <span>{REQUEST_STATUS_LABEL[thread.status ?? ''] ?? 'Request'}</span>
                {audience === 'studio' && thread.orgName && <span>{`, ${thread.orgName}`}</span>}
              </>
            )}
          </p>
        </div>
        <PeopleStack people={people} />
        {thread.href && (
          <Link href={thread.href} className="pfm-btn small tahi-focus-ring">
            Open the request
            <ExternalLink size={14} aria-hidden="true" />
          </Link>
        )}
      </header>
      <span className="pfm-hair" />

      <div className="pfm-thread-body" ref={scroller}>
        {state === 'loading' && (
          <div className="pfm-skel" aria-hidden="true">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="pfm-skel-row">
                <span className="pfm-skel-sq" />
                <span className="pfm-skel-lines">
                  <span className="pfm-skel-l w70" />
                  <span className="pfm-skel-l w45" />
                </span>
              </div>
            ))}
          </div>
        )}
        {state === 'ready' && messages.length === 0 && (
          <div className="pfm-empty">
            <span className="pfm-empty-ic"><MessageCircle size={20} aria-hidden="true" /></span>
            <h2>Nothing here yet</h2>
            <p>
              {thread.source === 'channel'
                ? 'This is the line for anything that is not about one particular request. Say hello.'
                : 'Ask a question or leave a note, and it stays attached to this piece of work.'}
            </p>
          </div>
        )}
        {state === 'ready' && <MessageStream messages={messages} seenCursor={seenCursor} onRetryMessage={onRetryMessage} />}
      </div>

      <span className="pfm-hair" />
      <MessageBox
        canPost={thread.canPost}
        canInternal={thread.canInternal && audience === 'studio'}
        placeholder={thread.source === 'channel'
          ? (audience === 'client' ? 'Message the studio' : 'Message the client')
          : 'Add a comment or question'}
        hint={audience === 'client'
          ? 'The Tahi team will see this'
          : `${clientName ?? 'The client'} will see this reply`}
        readOnlyNote={`You are reading this as ${clientName ?? 'a client'}. Replies are read-only in client view.`}
        attachments={attachments}
        onPickFiles={onPickFiles}
        onRemoveAttachment={onRemoveAttachment}
        onVoice={onVoice}
        recording={recording}
        onSend={onSend}
      />
    </div>
  )
}

/** "Liam and Staci, and you", from the people actually in the room. */
function studioLine(names: readonly string[]): string {
  if (names.length === 0) return 'Your line to the studio'
  if (names.length === 1) return `${names[0]}, and you`
  if (names.length === 2) return `${names[0]} and ${names[1]}, and you`
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}, and you`
}

function PeopleStack({ people }: { people: ThreadPayload['people'] }) {
  if (people.length === 0) return null
  const shown = people.slice(0, 4)
  const extra = people.length - shown.length
  return (
    <span className="pfm-stack" aria-label={`${people.length} people on this conversation`}>
      {shown.map(p => (
        <Avatar key={`${p.side}-${p.id}`} name={p.name} src={p.avatarUrl} size={26} tooltip={p.name} />
      ))}
      {extra > 0 && <span className="pfm-face more" aria-hidden="true">{`+${extra}`}</span>}
    </span>
  )
}

function MessageStream({
  messages,
  seenCursor,
  onRetryMessage,
}: {
  messages: readonly ThreadMessageView[]
  seenCursor: string | null
  onRetryMessage: (m: ThreadMessageView) => void
}) {
  const nodes: React.ReactNode[] = []
  let lastDay = ''
  let newLineDrawn = false

  for (const m of messages) {
    const key = dayKey(m.createdAt)
    if (key && key !== lastDay) {
      lastDay = key
      nodes.push(
        <div key={`day-${m.id}`} className="pfm-day"><span>{dayLabel(m.createdAt)}</span></div>,
      )
    }
    // One New line, at the first message the reader had not seen. Their own
    // messages never trigger it: nobody needs telling they wrote something.
    const unseen = !!seenCursor && !!m.createdAt && m.createdAt > seenCursor && !m.isOwn
    const neverRead = !seenCursor && !m.isOwn
    if (!newLineDrawn && (unseen || neverRead)) {
      newLineDrawn = true
      nodes.push(<div key={`new-${m.id}`} className="pfm-newline"><span>New</span></div>)
    }
    nodes.push(<Bubble key={m.id} m={m} onRetry={onRetryMessage} />)
  }

  return <>{nodes}</>
}

function Bubble({ m, onRetry }: { m: ThreadMessageView; onRetry: (m: ThreadMessageView) => void }) {
  const classes = [
    'pfm-msg',
    m.isOwn ? 'own' : 'other',
    m.isInternal ? 'internal' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className={classes}>
      <Avatar name={m.authorName ?? 'Tahi Team'} src={m.authorAvatarUrl} size={32} />
      <div className="pfm-msg-body">
        <div className="pfm-msg-meta">
          <b>{m.authorName ?? 'Tahi Team'}</b>
          <span>{timeLabel(m.createdAt)}</span>
          {m.isInternal && (
            <span className="pfm-msg-int"><Lock size={10} aria-hidden="true" />Internal</span>
          )}
          {m.pending && <span><Eye size={11} aria-hidden="true" /> Sending</span>}
          {m.failed && <span style={{ color: 'var(--color-danger)' }}>Not sent</span>}
        </div>
        {m.body.trim() && (
          <div
            className="pfm-msg-bubble"
            // Sanitised on the way IN, on every write path (sanitizeRichText in
            // both POST routes), so what is stored is already safe to render.
            dangerouslySetInnerHTML={{ __html: m.body }}
          />
        )}
        {m.voiceNote && (
          <div className="pfm-voice">
            {/* The route returns a bare /api/... path. next/link prepends the
                basePath, a native <audio src> and <a href> do not. */}
            <audio controls preload="none" src={apiPath(m.voiceNote.url)}>
              <track kind="captions" />
            </audio>
            {m.voiceNote.durationSeconds !== null && (
              <span className="pfm-voice-len">{formatDuration(m.voiceNote.durationSeconds)}</span>
            )}
          </div>
        )}
        {m.files.length > 0 && (
          <div className="pfm-msg-files">
            {m.files.map(f => (
              <a
                key={f.id}
                className="pfm-chip tahi-focus-ring"
                href={apiPath(`/api/uploads/serve?key=${encodeURIComponent(f.storageKey)}`)}
                target="_blank"
                rel="noreferrer"
              >
                <span className="pfm-chip-t">
                  <b>{f.filename}</b>
                  <small>{formatBytes(f.sizeBytes)}</small>
                </span>
              </a>
            ))}
          </div>
        )}
        {m.failed && (
          <button type="button" className="pfm-btn small tahi-focus-ring" onClick={() => onRetry(m)}>
            <RefreshCw size={13} aria-hidden="true" />
            Try again
          </button>
        )}
      </div>
    </div>
  )
}

function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  const mins = Math.floor(whole / 60)
  const rest = whole % 60
  return `${mins}:${String(rest).padStart(2, '0')}`
}

function formatBytes(n: number | null): string {
  if (n === null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
