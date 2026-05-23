'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  MessageSquare, Plus, Users, Hash, AtSign,
  Lock, ArrowLeft, Edit3, Trash2,
} from 'lucide-react'
import { apiPath } from '@/lib/api'
import { useImpersonation } from '@/components/tahi/impersonation-banner'

// Design-system primitives
import { Card } from '@/components/tahi/card'
import { Input } from '@/components/tahi/input'
import { Badge } from '@/components/tahi/badge'
import { TahiButton } from '@/components/tahi/tahi-button'
import { EmptyState } from '@/components/tahi/empty-state'
import { SlideOver } from '@/components/tahi/slide-over'
import { FilterBar, type FilterDef, type ActiveFilter } from '@/components/tahi/filter-bar'
import { MessageThread } from '@/components/tahi/message-thread'
import { MessageBubble } from '@/components/tahi/message-bubble'
import { Composer, type ComposerSendPayload } from '@/components/tahi/composer'
import { SearchableSelect } from '@/components/tahi/searchable-select'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ConversationSummary {
  id: string
  type: string
  name: string | null
  orgId: string | null
  orgName: string | null
  visibility: string
  participantNames: string[]
  participantCount: number
  lastMessage: {
    id: string
    body: string
    createdAt: string
    authorType: string
  } | null
  unreadCount: number
  updatedAt: string
}

interface MessageItem {
  id: string
  body: string
  isInternal: boolean
  authorId: string
  authorType: string
  authorName: string
  authorAvatarUrl: string | null
  createdAt: string
  editedAt: string | null
  deletedAt: string | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, { label: string; icon: typeof MessageSquare }> = {
  direct: { label: 'DM', icon: AtSign },
  group: { label: 'Group', icon: Users },
  org_channel: { label: 'Channel', icon: Hash },
  request_thread: { label: 'Thread', icon: MessageSquare },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    if (diffDays === 0) {
      return d.toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' })
    }
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) {
      return d.toLocaleDateString('en-NZ', { weekday: 'short' })
    }
    return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })
  } catch {
    return ''
  }
}

function getConversationDisplayName(conv: ConversationSummary): string {
  if (conv.name) return conv.name
  if (conv.type === 'org_channel' && conv.orgName) return conv.orgName
  if (conv.participantNames.length > 0) {
    return conv.participantNames.slice(0, 3).join(', ')
  }
  return 'Unnamed conversation'
}

// Deterministic waveform bar heights (seeded pattern, not random per render)
const WAVEFORM_HEIGHTS = [
  0.35, 0.55, 0.75, 0.45, 0.90, 0.60, 0.80, 0.40, 0.95, 0.50,
  0.70, 0.85, 0.30, 0.65, 1.00, 0.55, 0.45, 0.80, 0.60, 0.38,
]

// NOTE: VoiceNotePlayer is intentionally preserved as-is. It animates a
// fake progress bar rather than playing the recorded audio. The real
// fix is tracked under T735 (P1 — STATUS.md). Do not "fix" it here.
function VoiceNotePlayer({ body }: { body: string }) {
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const durationMatch = body.match(/(\d+)s/)
  const duration = durationMatch ? parseInt(durationMatch[1]) : 0

  useEffect(() => {
    if (!playing) return
    const totalMs = duration * 1000
    const interval = totalMs / 20
    const timer = setInterval(() => {
      setProgress(prev => {
        if (prev >= 20) {
          setPlaying(false)
          return 0
        }
        return prev + 1
      })
    }, interval || 100)
    return () => clearInterval(timer)
  }, [playing, duration])

  function handlePlayPause() {
    if (playing) {
      setPlaying(false)
    } else {
      setProgress(0)
      setPlaying(true)
    }
  }

  return (
    <div
      className="flex items-center gap-3 mt-1"
      style={{
        padding: '0.5rem 0.75rem',
        background: 'var(--color-bg-secondary)',
        borderRadius: '1.25rem',
        maxWidth: '16rem',
      }}
    >
      <button
        type="button"
        onClick={handlePlayPause}
        style={{
          width: '2rem',
          height: '2rem',
          borderRadius: '50%',
          background: 'var(--color-brand)',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          color: 'white',
        }}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? (
          <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor">
            <rect x="0" y="0" width="3" height="12" rx="1" />
            <rect x="7" y="0" width="3" height="12" rx="1" />
          </svg>
        ) : (
          <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor">
            <path d="M0 0L10 6L0 12z" />
          </svg>
        )}
      </button>
      <div className="flex items-center gap-0.5 flex-1">
        {WAVEFORM_HEIGHTS.map((h, i) => (
          <div
            key={i}
            style={{
              width: '0.1875rem',
              height: `${h * 1.25}rem`,
              borderRadius: '0.125rem',
              background: i < progress ? 'var(--color-brand)' : 'var(--color-border)',
              transition: 'background 0.15s',
            }}
          />
        ))}
      </div>
      <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}>
        {playing ? `${Math.min(Math.round((progress / 20) * duration), duration)}s` : `${duration}s`}
      </span>
    </div>
  )
}

function stripHtml(text: string): string {
  // Simple strip for message preview - handles Tiptap JSON or plain text
  try {
    const parsed = JSON.parse(text)
    if (parsed.content) {
      const texts: string[] = []
      for (const node of parsed.content) {
        if (node.content) {
          for (const child of node.content) {
            if (child.text) texts.push(child.text)
          }
        }
      }
      return texts.join(' ')
    }
    return text
  } catch {
    return text.replace(/<[^>]*>/g, '')
  }
}

function looksLikeHtml(s: string): boolean {
  return /^\s*<[a-z]/i.test(s)
}

function escapeHtmlText(s: string): string {
  return s.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] ?? c))
}

// Convert stored body to HTML for MessageBubble. Plain-text messages
// get wrapped in <p> with newlines preserved; existing HTML passes
// through untouched.
function bodyToHtml(raw: string): string {
  if (!raw) return ''
  if (looksLikeHtml(raw)) return raw
  // Plain text — escape and preserve line breaks.
  const escaped = escapeHtmlText(raw).replace(/\n/g, '<br />')
  return `<p>${escaped}</p>`
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MessagesContent({ isAdmin: isAdminProp }: { isAdmin: boolean }) {
  const { isImpersonatingClient } = useImpersonation()
  // Only switch to client view when impersonating a client, not a team member
  const isAdmin = isAdminProp && !isImpersonatingClient
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([])
  const [activeConvId, setActiveConvId] = useState<string | null>(null)
  const [messages, setMessages] = useState<MessageItem[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [showNewDialog, setShowNewDialog] = useState(false)

  // ── Fetch conversations ───────────────────────────────────────────────────

  const fetchConversations = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const endpoint = isAdmin ? '/api/admin/conversations' : '/api/portal/conversations'
      const res = await fetch(apiPath(endpoint))
      if (!res.ok) throw new Error('Failed to load conversations')
      const data = await res.json() as { conversations?: ConversationSummary[] }
      setConversations(data.conversations ?? [])
    } catch {
      setError(true)
      setConversations([])
    } finally {
      setLoading(false)
    }
  }, [isAdmin])

  useEffect(() => { fetchConversations() }, [fetchConversations])

  // ── Fetch messages for active conversation ────────────────────────────────

  const fetchMessages = useCallback(async (convId: string) => {
    setMessagesLoading(true)
    try {
      const endpoint = isAdmin
        ? `/api/admin/conversations/${convId}/messages`
        : `/api/portal/conversations/${convId}/messages`
      const res = await fetch(apiPath(endpoint))
      if (!res.ok) throw new Error('Failed to load messages')
      const data = await res.json() as { items?: MessageItem[] }
      setMessages(data.items ?? [])
    } catch {
      setMessages([])
    } finally {
      setMessagesLoading(false)
    }
  }, [isAdmin])

  useEffect(() => {
    if (activeConvId) {
      fetchMessages(activeConvId)
    }
  }, [activeConvId, fetchMessages])

  // ── Send message (via Composer payload) ───────────────────────────────────

  const handleSend = useCallback(async (payload: ComposerSendPayload) => {
    if (!activeConvId || sending) return
    setSending(true)
    try {
      const endpoint = isAdmin
        ? `/api/admin/conversations/${activeConvId}/messages`
        : `/api/portal/conversations/${activeConvId}/messages`

      // Voice note path: presign → upload to R2 → confirm → send message
      // with the voiceNote reference. Mirrors the original flow exactly.
      if (payload.voiceNote) {
        const presignRes = await fetch(apiPath('/api/uploads/presign'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: `voice-note-${Date.now()}.webm`,
            mimeType: payload.voiceNote.blob.type || 'audio/webm',
          }),
        })
        if (!presignRes.ok) throw new Error('Failed to get upload URL')
        const { uploadUrl, storageKey, fileId } = await presignRes.json() as {
          uploadUrl: string
          storageKey: string
          fileId: string
        }
        // uploadUrl is already absolute — don't wrap in apiPath().
        await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': payload.voiceNote.blob.type || 'audio/webm' },
          body: payload.voiceNote.blob,
        })
        await fetch(apiPath('/api/uploads/confirm'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileId }),
        })
        await fetch(apiPath(endpoint), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: `[Voice note: ${payload.voiceNote.durationSeconds}s]`,
            voiceNote: {
              storageKey,
              durationSeconds: payload.voiceNote.durationSeconds,
              mimeType: payload.voiceNote.blob.type || 'audio/webm',
            },
          }),
        })
      } else {
        // Regular message: send Tiptap HTML as the body. The existing
        // API stores whatever string is in `content` and the read path
        // (stripHtml) handles both Tiptap JSON and HTML/plain text.
        const html = payload.html?.trim()
        if (!html || stripHtml(html).trim().length === 0) return
        await fetch(apiPath(endpoint), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: html }),
        })
      }

      await fetchMessages(activeConvId)
      await fetchConversations()
    } catch {
      // Error sending message — silently swallow to match prior behaviour.
    } finally {
      setSending(false)
    }
  }, [activeConvId, isAdmin, sending, fetchMessages, fetchConversations])

  // ── Delete message ────────────────────────────────────────────────────────

  const handleDeleteMessage = useCallback(async (messageId: string) => {
    if (!activeConvId || !isAdmin) return
    try {
      const res = await fetch(apiPath(`/api/admin/conversations/${activeConvId}/messages`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, deleted: true }),
      })
      if (!res.ok) throw new Error('Failed to delete')
      await fetchMessages(activeConvId)
    } catch {
      // Error deleting message
    }
  }, [activeConvId, isAdmin, fetchMessages])

  // ── Filter conversations by search + chips ────────────────────────────────

  const typeValues = useMemo(() => {
    const f = activeFilters.find(a => a.id === 'type')
    return new Set(f?.values ?? [])
  }, [activeFilters])

  const visibilityValues = useMemo(() => {
    const f = activeFilters.find(a => a.id === 'visibility')
    return new Set(f?.values ?? [])
  }, [activeFilters])

  const filtered = conversations.filter(c => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      const name = getConversationDisplayName(c).toLowerCase()
      const matchesText = name.includes(q) || (c.orgName?.toLowerCase().includes(q) ?? false)
      if (!matchesText) return false
    }
    if (typeValues.size > 0 && !typeValues.has(c.type)) return false
    if (visibilityValues.size > 0 && !visibilityValues.has(c.visibility)) return false
    return true
  })

  const activeConv = conversations.find(c => c.id === activeConvId) ?? null

  // Filter definitions for the chip-builder bar above the list.
  const filterDefs: FilterDef[] = useMemo(() => ([
    {
      id: 'type',
      label: 'Type',
      kind: 'multiselect',
      options: [
        { value: 'direct',         label: 'Direct'  },
        { value: 'group',          label: 'Group'   },
        { value: 'org_channel',    label: 'Channel' },
        { value: 'request_thread', label: 'Thread'  },
      ],
    },
    ...(isAdmin ? ([{
      id: 'visibility',
      label: 'Visibility',
      kind: 'multiselect' as const,
      options: [
        { value: 'external', label: 'External' },
        { value: 'internal', label: 'Internal', tone: 'warning' as const },
      ],
    }]) : []),
  ]), [isAdmin])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.875rem', height: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '14rem' }}>
          <h1 style={{
            margin: 0,
            fontSize: '1.5rem',
            fontWeight: 700,
            color: 'var(--color-text)',
            letterSpacing: '-0.015em',
          }}>Messages</h1>
          <p style={{
            margin: '0.25rem 0 0',
            fontSize: '0.875rem',
            color: 'var(--color-text-muted)',
            lineHeight: 1.5,
          }}>
            {isAdmin ? 'Conversations with clients and team.' : 'Messages with the Tahi team.'}
          </p>
        </div>
        <TahiButton
          size="sm"
          onClick={() => setShowNewDialog(true)}
          iconLeft={<Plus className="w-3.5 h-3.5" />}
        >
          New conversation
        </TahiButton>
      </div>

      {/* Filter row. Search lives here too so the chip + search read
          as one connected control surface (matches the docs page). */}
      <FilterBar
        filters={filterDefs}
        active={activeFilters}
        onChange={setActiveFilters}
        search={{
          value: searchQuery,
          onChange: setSearchQuery,
          placeholder: 'Search conversations',
        }}
        size="sm"
      />

      {/* Two-pane shell. Outer Card gives the unified rounded surface;
          inner flex split holds the list (left) and thread (right).
          On mobile only one pane is visible at a time. */}
      <Card padding="none" style={{ flex: 1, display: 'flex', minHeight: '32rem', overflow: 'hidden' }}>
        {/* Left: conversation list */}
        <div
          className={`flex flex-col flex-shrink-0 w-full md:w-80 md:max-w-80 ${activeConvId ? 'hidden md:flex' : 'flex'}`}
          style={{ borderRight: '1px solid var(--color-border-subtle)' }}
        >
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div style={{ padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="animate-pulse">
                    <div style={{ height: '0.875rem', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-tertiary)', width: '75%' }} />
                    <div style={{ height: '0.625rem', borderRadius: 'var(--radius-sm)', marginTop: '0.4375rem', background: 'var(--color-bg-tertiary)', width: '50%' }} />
                  </div>
                ))}
              </div>
            ) : error ? (
              <div style={{ padding: '2rem 1rem', textAlign: 'center' }}>
                <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', margin: 0 }}>
                  Failed to load conversations.
                </p>
                <TahiButton variant="ghost" size="sm" onClick={fetchConversations} style={{ marginTop: '0.5rem' }}>
                  Retry
                </TahiButton>
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={<MessageSquare className="w-6 h-6" />}
                title={searchQuery || activeFilters.length > 0 ? 'No matches' : 'No conversations yet'}
                description={searchQuery || activeFilters.length > 0
                  ? 'Try clearing a filter or adjusting your search.'
                  : 'Start a conversation to get going.'}
                action={
                  searchQuery || activeFilters.length > 0
                    ? undefined
                    : (
                      <TahiButton
                        size="sm"
                        onClick={() => setShowNewDialog(true)}
                        iconLeft={<Plus className="w-3.5 h-3.5" />}
                      >
                        Start a conversation
                      </TahiButton>
                    )
                }
                variant="inline"
              />
            ) : (
              filtered.map(conv => {
                const isActive = conv.id === activeConvId
                const TypeIcon = TYPE_LABELS[conv.type]?.icon ?? MessageSquare
                const displayName = getConversationDisplayName(conv)

                return (
                  <button
                    key={conv.id}
                    onClick={() => setActiveConvId(conv.id)}
                    className="w-full text-left"
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '0.75rem',
                      padding: '0.75rem',
                      borderBottom: '1px solid var(--color-border-subtle)',
                      background: isActive ? 'var(--color-bg-tertiary)' : 'transparent',
                      border: 'none',
                      borderBottomWidth: 1,
                      borderBottomStyle: 'solid',
                      borderBottomColor: 'var(--color-border-subtle)',
                      cursor: 'pointer',
                      minHeight: '2.75rem',
                      transition: 'background-color 120ms ease',
                    }}
                    onMouseEnter={e => {
                      if (!isActive) e.currentTarget.style.background = 'var(--color-bg-secondary)'
                    }}
                    onMouseLeave={e => {
                      if (!isActive) e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    <div
                      className="flex items-center justify-center flex-shrink-0"
                      style={{
                        width: '2.25rem',
                        height: '2.25rem',
                        borderRadius: 'var(--radius-leaf-sm)',
                        background: isActive ? 'var(--color-brand)' : 'var(--color-bg-tertiary)',
                        color: isActive ? '#ffffff' : 'var(--color-text-muted)',
                      }}
                    >
                      <TypeIcon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span
                          className="text-sm truncate"
                          style={{
                            fontWeight: conv.unreadCount > 0 ? 600 : 500,
                            color: 'var(--color-text)',
                          }}
                        >
                          {displayName}
                        </span>
                        {conv.lastMessage && (
                          <span className="text-xs flex-shrink-0 ml-2" style={{ color: 'var(--color-text-subtle)' }}>
                            {formatTime(conv.lastMessage.createdAt)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between mt-0.5">
                        <p
                          className="text-xs truncate"
                          style={{ color: 'var(--color-text-muted)', maxWidth: '12rem', margin: 0 }}
                        >
                          {conv.lastMessage
                            ? stripHtml(conv.lastMessage.body)
                            : 'No messages yet'}
                        </p>
                        {conv.unreadCount > 0 && (
                          <Badge tone="brand" variant="solid" size="sm">
                            {conv.unreadCount}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1 mt-1.5">
                        <Badge tone="neutral" variant="soft" size="sm">
                          {TYPE_LABELS[conv.type]?.label ?? conv.type}
                        </Badge>
                        {conv.visibility === 'internal' && (
                          <Badge tone="warning" variant="soft" size="sm" leader="icon" icon={<Lock />}>
                            Internal
                          </Badge>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* Right: thread */}
        <div className={`flex flex-col flex-1 min-w-0 ${activeConvId ? 'flex' : 'hidden md:flex'}`}>
          {!activeConv ? (
            <div className="flex flex-col items-center justify-center flex-1 text-center px-4">
              <EmptyState
                icon={<MessageSquare className="w-8 h-8" />}
                title="Select a conversation"
                description="Choose a conversation from the list or start a new one."
                variant="inline"
              />
            </div>
          ) : (
            <MessageThread<MessageItem & { timestamp: string }>
              title={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4375rem' }}>
                  {/* Mobile back affordance. Hidden on md+. */}
                  <button
                    type="button"
                    onClick={() => setActiveConvId(null)}
                    className="md:hidden"
                    aria-label="Back to conversations"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '1.75rem',
                      height: '1.75rem',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--color-bg-secondary)',
                      border: 'none',
                      color: 'var(--color-text-muted)',
                      cursor: 'pointer',
                      marginRight: '0.125rem',
                    }}
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  {getConversationDisplayName(activeConv)}
                </span>
              }
              subtitle={
                <>
                  {activeConv.participantCount} participant{activeConv.participantCount !== 1 ? 's' : ''}
                  {activeConv.orgName ? ` · ${activeConv.orgName}` : ''}
                </>
              }
              visibility={activeConv.visibility === 'internal' ? 'internal' : 'external'}
              messages={messages.map(m => ({ ...m, timestamp: m.createdAt }))}
              loading={messagesLoading}
              empty={
                <EmptyState
                  icon={<MessageSquare className="w-6 h-6" />}
                  title="No messages yet"
                  description="Send one to get the conversation started."
                  variant="inline"
                />
              }
              maxHeight="none"
              renderMessage={(msg) => {
                const isDeleted = !!msg.deletedAt
                const isVoice = !isDeleted && msg.body.startsWith('[Voice note:')

                return (
                  <MessageBubble
                    author={{
                      name: msg.authorName,
                      avatarUrl: msg.authorAvatarUrl ?? undefined,
                      role: msg.authorType === 'team_member' ? 'admin' : 'client',
                    }}
                    timestamp={msg.createdAt}
                    editedAt={msg.editedAt ?? undefined}
                    visibility={msg.isInternal ? 'internal' : 'external'}
                    bodyHtml={isDeleted ? undefined : isVoice ? undefined : bodyToHtml(stripHtml(msg.body))}
                    body={
                      isDeleted
                        ? (
                          <span style={{ color: 'var(--color-text-subtle)', fontStyle: 'italic' }}>
                            This message has been removed.
                          </span>
                        )
                        : isVoice
                          ? <VoiceNotePlayer body={msg.body} />
                          : undefined
                    }
                    actions={
                      isAdmin && !isDeleted
                        ? [
                            {
                              label: 'Delete',
                              icon: <Trash2 size={13} />,
                              tone: 'danger',
                              onClick: () => handleDeleteMessage(msg.id),
                            },
                          ]
                        : undefined
                    }
                  />
                )
              }}
              composer={
                <Composer
                  placeholder="Type a message..."
                  canBeInternal={isAdmin}
                  defaultVisibility={activeConv.visibility === 'internal' ? 'internal' : 'public'}
                  hideToolbar
                  noFiles
                  onSend={handleSend}
                />
              }
            />
          )}
        </div>
      </Card>

      {/* New Conversation slide-over */}
      <SlideOver
        open={showNewDialog}
        onClose={() => setShowNewDialog(false)}
        icon={<Edit3 size={15} />}
        title="New conversation"
        subtitle={isAdmin ? 'Pick a type, add participants, send.' : 'Start a thread with the Tahi team.'}
        maxWidth="48rem"
      >
        <NewConversationForm
          isAdmin={isAdmin}
          onClose={() => setShowNewDialog(false)}
          onCreated={(id: string) => {
            setShowNewDialog(false)
            setActiveConvId(id)
            fetchConversations()
          }}
        />
      </SlideOver>

      {/* Mobile bottom nav spacer */}
      <div className="h-28 md:hidden" aria-hidden="true" />
    </div>
  )
}

// ── New Conversation form (lives inside the SlideOver) ────────────────────────

interface ParticipantSelectOption {
  value: string
  label: string
  subtitle?: string
}

function NewConversationForm({
  isAdmin,
  onClose,
  onCreated,
}: {
  isAdmin: boolean
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const [type, setType] = useState<string>('direct')
  const [name, setName] = useState('')
  const [visibility, setVisibility] = useState<string>('external')
  const [initialMessage, setInitialMessage] = useState('')
  const [creating, setCreating] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [participantOptions, setParticipantOptions] = useState<ParticipantSelectOption[]>([])
  const [selectedParticipantIds, setSelectedParticipantIds] = useState<string[]>([])
  const [participantSearch, setParticipantSearch] = useState<string | null>(null)

  // Load team members + contacts as participant options
  useEffect(() => {
    if (!isAdmin) return

    async function load() {
      try {
        const [teamRes, clientsRes] = await Promise.all([
          fetch(apiPath('/api/admin/team')),
          fetch(apiPath('/api/admin/clients')),
        ])

        const opts: ParticipantSelectOption[] = []

        if (teamRes.ok) {
          const data = await teamRes.json() as { items: Array<{ id: string; name: string; email: string }> }
          for (const m of (data.items ?? [])) {
            opts.push({ value: `team:${m.id}`, label: m.name, subtitle: `Team · ${m.email}` })
          }
        }

        if (clientsRes.ok) {
          const data = await clientsRes.json() as { organisations: Array<{ id: string; name: string }> }
          for (const org of (data.organisations ?? [])) {
            opts.push({ value: `org:${org.id}`, label: org.name, subtitle: 'Client org' })
          }
        }

        setParticipantOptions(opts)
      } catch {
        // Failed to load participants
      }
    }

    load()
  }, [isAdmin])

  function addParticipant(val: string | null) {
    if (!val) return
    setParticipantSearch(null)
    if (!selectedParticipantIds.includes(val)) {
      setSelectedParticipantIds(prev => [...prev, val])
    }
  }

  function removeParticipant(val: string) {
    setSelectedParticipantIds(prev => prev.filter(id => id !== val))
  }

  const handleCreate = async () => {
    setCreating(true)
    setErrorMsg('')
    try {
      const endpoint = isAdmin ? '/api/admin/conversations' : '/api/portal/conversations'
      const payload = isAdmin
        ? {
            type,
            name: name.trim() || null,
            visibility,
            participantIds: selectedParticipantIds,
          }
        : {
            type: 'direct',
            content: initialMessage.trim() || undefined,
          }
      const res = await fetch(apiPath(endpoint), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const errData = await res.json() as { error?: string }
        throw new Error(errData.error ?? 'Failed to create conversation')
      }
      const result = await res.json() as { id: string }
      onCreated(result.id)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to create conversation')
    } finally {
      setCreating(false)
    }
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '0.625rem',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--color-text-subtle)',
    marginBottom: '0.3125rem',
  }

  return (
    <>
      <SlideOver.Body>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {isAdmin ? (
            <>
              {/* Type */}
              <div>
                <label htmlFor="conv-type" style={labelStyle}>Type</label>
                <select
                  id="conv-type"
                  value={type}
                  onChange={e => setType(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg)',
                    fontSize: 'var(--text-sm)',
                    color: 'var(--color-text)',
                    minHeight: '2.25rem',
                  }}
                >
                  <option value="direct">Direct message</option>
                  <option value="group">Group</option>
                  <option value="org_channel">Org channel</option>
                  <option value="request_thread">Request thread</option>
                </select>
              </div>

              {/* Name (for group/channel) */}
              {(type === 'group' || type === 'org_channel') && (
                <div>
                  <label htmlFor="conv-name" style={labelStyle}>Name</label>
                  <Input
                    id="conv-name"
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Conversation name..."
                    inputSize="md"
                  />
                </div>
              )}

              {/* Participants */}
              <div>
                <label style={labelStyle}>Participants</label>
                <SearchableSelect
                  options={participantOptions.filter(o => !selectedParticipantIds.includes(o.value))}
                  value={participantSearch}
                  onChange={addParticipant}
                  placeholder="Add a participant..."
                  searchPlaceholder="Search team or clients..."
                  allowClear
                />
                {selectedParticipantIds.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginTop: '0.5rem' }}>
                    {selectedParticipantIds.map(pid => {
                      const opt = participantOptions.find(o => o.value === pid)
                      return (
                        <Badge
                          key={pid}
                          tone="brand"
                          variant="soft"
                          size="sm"
                          onRemove={() => removeParticipant(pid)}
                        >
                          {opt?.label ?? pid}
                        </Badge>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Visibility */}
              <div>
                <label style={labelStyle}>Visibility</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <TahiButton
                    variant={visibility === 'external' ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={() => setVisibility('external')}
                  >
                    External
                  </TahiButton>
                  <TahiButton
                    variant={visibility === 'internal' ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={() => setVisibility('internal')}
                  >
                    Internal
                  </TahiButton>
                </div>
                <p style={{ fontSize: '0.75rem', marginTop: '0.375rem', color: 'var(--color-text-subtle)' }}>
                  {visibility === 'internal' ? 'Only visible to the Tahi team.' : 'Visible to clients and team.'}
                </p>
              </div>
            </>
          ) : (
            <>
              <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', margin: 0 }}>
                Start a new conversation with the Tahi team.
              </p>
              <div>
                <label htmlFor="conv-initial-msg" style={labelStyle}>Message (optional)</label>
                <textarea
                  id="conv-initial-msg"
                  value={initialMessage}
                  onChange={e => setInitialMessage(e.target.value)}
                  placeholder="Type your first message..."
                  rows={3}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg)',
                    fontSize: 'var(--text-sm)',
                    color: 'var(--color-text)',
                    resize: 'none',
                    fontFamily: 'inherit',
                  }}
                />
              </div>
            </>
          )}

          {errorMsg && (
            <div aria-live="polite" style={{ fontSize: '0.8125rem', color: 'var(--color-danger)' }}>
              {errorMsg}
            </div>
          )}
        </div>
      </SlideOver.Body>
      <SlideOver.Footer>
        <TahiButton variant="secondary" size="sm" onClick={onClose}>
          Cancel
        </TahiButton>
        <div style={{ flex: 1 }} />
        <TahiButton size="sm" onClick={handleCreate} disabled={creating}>
          {creating ? 'Creating...' : 'Create'}
        </TahiButton>
      </SlideOver.Footer>
    </>
  )
}
