'use client'

/**
 * <ConversationRail>. The left pane: the search box, the three-way lens and
 * the list of rooms.
 *
 * It is the page's rail, in the house sense: the filters live on the left on
 * every list page, and on Messages the filtered list IS the left pane, so the
 * two are one column rather than a rail beside a list beside a thread.
 *
 * At 375 this pane is the whole page and selecting a room replaces it (the
 * parent adds `hidden`); from 64rem it stands beside the thread.
 *
 * Every state is handled here rather than by the parent, so a row can never
 * render against a half-loaded list: loading (skeleton rows), error, empty
 * (nothing has ever been said), no-match (the filter is too narrow) and
 * populated.
 */

import * as React from 'react'
import { AlertTriangle, MessageCircle, Search } from 'lucide-react'
import { LeafGlyph } from '@/components/tahi/tahi-glyphs'
import { RelativeTime } from '@/components/tahi/relative-time'
import {
  INBOX_LENSES,
  REQUEST_STATUS_LABEL,
  inboxRowTitle,
  type InboxLens,
  type InboxThread,
} from '@/lib/messages-inbox'

/** The dot beside a request thread. Tokens only, so dark mode follows. */
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

export interface ConversationRailProps {
  audience: 'client' | 'studio'
  threads: readonly InboxThread[]
  selectedKey: string | null
  onSelect: (thread: InboxThread) => void
  lens: InboxLens
  onLensChange: (lens: InboxLens) => void
  query: string
  onQueryChange: (query: string) => void
  unreadTotal: number
  /** Adds the client-name pill to every row. Studio only. */
  showClientName: boolean
  state: 'loading' | 'error' | 'ready'
  onRetry: () => void
  hidden: boolean
}

export function ConversationRail({
  audience,
  threads,
  selectedKey,
  onSelect,
  lens,
  onLensChange,
  query,
  onQueryChange,
  unreadTotal,
  showClientName,
  state,
  onRetry,
  hidden,
}: ConversationRailProps) {
  return (
    <div className={hidden ? 'pfm-left hidden' : 'pfm-left'}>
      <div className="pfm-left-head">
        <div className="pfm-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={e => onQueryChange(e.target.value)}
            placeholder="Search messages"
            aria-label="Search messages"
          />
        </div>
        <div className="pfm-lens" role="group" aria-label="Filter conversations">
          {INBOX_LENSES.map(l => (
            <button
              key={l.key}
              type="button"
              className={lens === l.key ? 'pfm-lens-b on tahi-focus-ring' : 'pfm-lens-b tahi-focus-ring'}
              aria-pressed={lens === l.key}
              onClick={() => onLensChange(l.key)}
            >
              {l.label}
              {l.key === 'unread' && unreadTotal > 0 && (
                <span className="pfm-lens-n">{unreadTotal}</span>
              )}
            </button>
          ))}
        </div>
      </div>
      <span className="pfm-hair" />
      <div className="pfm-left-scroll">
        <RailBody
          audience={audience}
          state={state}
          threads={threads}
          selectedKey={selectedKey}
          onSelect={onSelect}
          showClientName={showClientName}
          onRetry={onRetry}
          filtering={query.trim().length > 0 || lens !== 'all'}
          onClearFilters={() => { onQueryChange(''); onLensChange('all') }}
        />
      </div>
    </div>
  )
}

function RailBody({
  audience,
  state,
  threads,
  selectedKey,
  onSelect,
  showClientName,
  onRetry,
  filtering,
  onClearFilters,
}: {
  audience: 'client' | 'studio'
  state: 'loading' | 'error' | 'ready'
  threads: readonly InboxThread[]
  selectedKey: string | null
  onSelect: (thread: InboxThread) => void
  showClientName: boolean
  onRetry: () => void
  filtering: boolean
  onClearFilters: () => void
}) {
  if (state === 'loading') {
    return (
      <div className="pfm-skel" aria-hidden="true">
        {[0, 1, 2, 3, 4].map(i => (
          <div key={i} className="pfm-skel-row">
            <span className="pfm-skel-sq" />
            <span className="pfm-skel-lines">
              <span className="pfm-skel-l w70" />
              <span className="pfm-skel-l w45" />
            </span>
          </div>
        ))}
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className="pfm-err" role="alert">
        <AlertTriangle size={18} aria-hidden="true" style={{ color: 'var(--color-danger)' }} />
        <span className="pfm-err-t">
          <b>We could not load your messages</b>
          <small>Something went wrong reaching the studio. Try again in a moment.</small>
        </span>
        <button type="button" className="pfm-btn tahi-focus-ring" onClick={onRetry}>Try again</button>
      </div>
    )
  }

  if (threads.length === 0 && filtering) {
    return (
      <div className="pfm-empty">
        <span className="pfm-empty-ic"><Search size={20} aria-hidden="true" /></span>
        <h2>No conversations match</h2>
        <p>Try a different word, or clear the filter.</p>
        <button type="button" className="pfm-btn pfm-empty-a tahi-focus-ring" onClick={onClearFilters}>
          Clear filters
        </button>
      </div>
    )
  }

  if (threads.length === 0) {
    return (
      <div className="pfm-empty">
        <span className="pfm-empty-ic"><MessageCircle size={20} aria-hidden="true" /></span>
        <h2>No conversations yet</h2>
        <p>
          {audience === 'client'
            ? 'Your line to the studio opens the moment your first request lands. Every request also has its own thread.'
            : 'A client line opens the first time somebody writes on it, and every request carries its own thread.'}
        </p>
      </div>
    )
  }

  return (
    <div className="pfm-list">
      {threads.map(t => (
        <ConversationRow
          key={t.key}
          audience={audience}
          thread={t}
          selected={selectedKey === t.key}
          onSelect={onSelect}
          showClientName={showClientName}
        />
      ))}
    </div>
  )
}

function ConversationRow({
  audience,
  thread,
  selected,
  onSelect,
  showClientName,
}: {
  audience: 'client' | 'studio'
  thread: InboxThread
  selected: boolean
  onSelect: (thread: InboxThread) => void
  showClientName: boolean
}) {
  const last = thread.lastMessage
  const who = last?.authorName ? `${last.authorName}: ` : ''
  const preview = last
    ? `${who}${last.isVoice && !last.snippet ? 'Voice note' : last.snippet}`
    : 'No messages yet'
  const classes = [
    'pfm-row',
    'tahi-focus-ring',
    selected ? 'on' : '',
    thread.unreadCount > 0 ? 'unread' : '',
  ].filter(Boolean).join(' ')

  return (
    <button
      type="button"
      className={classes}
      onClick={() => onSelect(thread)}
      aria-current={selected ? 'true' : undefined}
    >
      <span className="pfm-row-ic">
        {thread.source === 'channel' ? (
          <span className="pfm-studio-mark" aria-hidden="true">
            <LeafGlyph size={16} />
          </span>
        ) : (
          <span className="pfm-req-mark" aria-hidden="true">
            <span
              className="pfm-dot"
              style={{ background: STATUS_DOT[thread.status ?? ''] ?? 'var(--color-text-subtle)' }}
            />
          </span>
        )}
      </span>
      <span className="pfm-row-t">
        <span className="pfm-row-top">
          <b>{inboxRowTitle(thread)}</b>
          {last?.at && (
            <span className="pfm-row-at"><RelativeTime date={last.at} /></span>
          )}
        </span>
        <span className="pfm-row-prev">{preview}</span>
        <span className="pfm-row-tags">
          <span className="pfm-pill">
            {thread.source === 'channel'
              ? (audience === 'client' ? 'Your studio line' : 'Client line')
              : (REQUEST_STATUS_LABEL[thread.status ?? ''] ?? 'Request')}
          </span>
          {showClientName && thread.orgName && <span className="pfm-pill">{thread.orgName}</span>}
        </span>
      </span>
      {thread.unreadCount > 0 && (
        <span className="pfm-unread" aria-label={`${thread.unreadCount} unread`}>
          {thread.unreadCount}
        </span>
      )}
    </button>
  )
}
