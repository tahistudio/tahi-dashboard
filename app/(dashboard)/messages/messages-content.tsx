'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  MessageSquare, Search, Plus, Send, Users, Hash, AtSign,
  ChevronRight, Loader2, Lock,
} from 'lucide-react'
import { apiPath } from '@/lib/api'

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
}

interface ParticipantOption {
  id: string
  name: string
  type: 'team_member' | 'contact'
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

function getInitial(name: string): string {
  return name.charAt(0).toUpperCase()
}

function getConversationDisplayName(conv: ConversationSummary): string {
  if (conv.name) return conv.name
  if (conv.type === 'org_channel' && conv.orgName) return conv.orgName
  if (conv.participantNames.length > 0) {
    return conv.participantNames.slice(0, 3).join(', ')
  }
  return 'Unnamed conversation'
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

// ── Component ─────────────────────────────────────────────────────────────────

export function MessagesContent({ isAdmin }: { isAdmin: boolean }) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeConvId, setActiveConvId] = useState<string | null>(null)
  const [messages, setMessages] = useState<MessageItem[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [composerText, setComposerText] = useState('')
  const [sending, setSending] = useState(false)
  const [showNewDialog, setShowNewDialog] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

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

  // Scroll to bottom when messages load
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ── Send message ──────────────────────────────────────────────────────────

  const handleSend = async () => {
    if (!composerText.trim() || !activeConvId || sending) return
    setSending(true)
    try {
      const endpoint = isAdmin
        ? `/api/admin/conversations/${activeConvId}/messages`
        : `/api/portal/conversations/${activeConvId}/messages`
      const res = await fetch(apiPath(endpoint), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: composerText.trim() }),
      })
      if (!res.ok) throw new Error('Failed to send')
      setComposerText('')
      await fetchMessages(activeConvId)
      // Refresh conversation list to update last message
      await fetchConversations()
    } catch {
      // Error sending message
    } finally {
      setSending(false)
    }
  }

  // ── Filter conversations by search ────────────────────────────────────────

  const filtered = conversations.filter(c => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    const name = getConversationDisplayName(c).toLowerCase()
    return name.includes(q) || (c.orgName?.toLowerCase().includes(q) ?? false)
  })

  const activeConv = conversations.find(c => c.id === activeConvId) ?? null

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Messages</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            {isAdmin ? 'Conversations with clients and team.' : 'Messages with the Tahi team.'}
          </p>
        </div>
        <button
          onClick={() => setShowNewDialog(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white transition-colors"
          style={{
            background: 'var(--color-brand)',
            borderRadius: 'var(--radius-button)',
            border: 'none',
            cursor: 'pointer',
            minHeight: '2.75rem',
          }}
        >
          <Plus className="w-4 h-4" />
          New Conversation
        </button>
      </div>

      <div
        className="flex flex-1 overflow-hidden"
        style={{
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-card)',
          background: 'var(--color-bg)',
          minHeight: '28rem',
        }}
      >
        {/* Left panel: conversation list */}
        <div
          className="flex flex-col flex-shrink-0"
          style={{
            width: '20rem',
            borderRight: '1px solid var(--color-border)',
          }}
        >
          {/* Search */}
          <div style={{ padding: '0.75rem', borderBottom: '1px solid var(--color-border-subtle)' }}>
            <div
              className="flex items-center gap-2"
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: 'var(--radius-input)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg-secondary)',
              }}
            >
              <Search className="w-4 h-4 text-[var(--color-text-subtle)]" />
              <input
                type="text"
                placeholder="Search conversations..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="flex-1 text-sm bg-transparent border-none outline-none text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)]"
              />
            </div>
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="animate-pulse">
                    <div className="h-4 rounded" style={{ background: 'var(--color-bg-tertiary)', width: '75%' }} />
                    <div className="h-3 rounded mt-2" style={{ background: 'var(--color-bg-tertiary)', width: '50%' }} />
                  </div>
                ))}
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                <p className="text-sm text-[var(--color-text-muted)]">Failed to load conversations.</p>
                <button
                  onClick={fetchConversations}
                  className="mt-2 text-sm font-medium"
                  style={{ color: 'var(--color-brand)', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  Retry
                </button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                <div
                  className="w-12 h-12 brand-gradient flex items-center justify-center mb-3"
                  style={{ borderRadius: 'var(--radius-leaf-sm)' }}
                >
                  <MessageSquare className="w-6 h-6 text-white" />
                </div>
                <p className="text-sm font-medium text-[var(--color-text)]">
                  {searchQuery ? 'No matching conversations' : 'No conversations yet'}
                </p>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  {searchQuery ? 'Try a different search term.' : 'Start a conversation to get going.'}
                </p>
              </div>
            ) : (
              filtered.map(conv => {
                const isActive = conv.id === activeConvId
                const TypeIcon = TYPE_LABELS[conv.type]?.icon ?? MessageSquare
                const displayName = getConversationDisplayName(conv)

                return (
                  <button
                    key={conv.id}
                    onClick={() => setActiveConvId(conv.id)}
                    className="w-full text-left transition-colors"
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '0.75rem',
                      padding: '0.75rem',
                      borderBottom: '1px solid var(--color-border-subtle)',
                      background: isActive ? 'var(--color-bg-tertiary)' : 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      minHeight: '2.75rem',
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
                          style={{ color: 'var(--color-text-muted)', maxWidth: '12rem' }}
                        >
                          {conv.lastMessage
                            ? stripHtml(conv.lastMessage.body)
                            : 'No messages yet'}
                        </p>
                        {conv.unreadCount > 0 && (
                          <span
                            className="flex items-center justify-center text-xs font-semibold text-white flex-shrink-0"
                            style={{
                              background: 'var(--color-brand)',
                              borderRadius: 'var(--radius-full)',
                              minWidth: '1.25rem',
                              height: '1.25rem',
                              padding: '0 0.25rem',
                              fontSize: '0.625rem',
                            }}
                          >
                            {conv.unreadCount}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 mt-1">
                        <span
                          className="text-xs px-1.5 py-0.5"
                          style={{
                            background: 'var(--color-bg-tertiary)',
                            borderRadius: 'var(--radius-badge)',
                            color: 'var(--color-text-subtle)',
                            fontSize: '0.625rem',
                            fontWeight: 500,
                          }}
                        >
                          {TYPE_LABELS[conv.type]?.label ?? conv.type}
                        </span>
                        {conv.visibility === 'internal' && (
                          <span
                            className="flex items-center gap-0.5 text-xs px-1.5 py-0.5"
                            style={{
                              background: 'var(--color-warning-bg)',
                              borderRadius: 'var(--radius-badge)',
                              color: 'var(--color-warning)',
                              fontSize: '0.625rem',
                              fontWeight: 500,
                            }}
                          >
                            <Lock className="w-2.5 h-2.5" aria-hidden="true" />
                            Internal
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* Right panel: conversation thread */}
        <div className="flex flex-col flex-1 min-w-0">
          {!activeConvId ? (
            <div className="flex flex-col items-center justify-center flex-1 text-center px-4">
              <div
                className="w-16 h-16 brand-gradient flex items-center justify-center mb-4"
                style={{ borderRadius: 'var(--radius-leaf)' }}
              >
                <MessageSquare className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-base font-semibold text-[var(--color-text)] mb-2">
                Select a conversation
              </h3>
              <p className="text-sm text-[var(--color-text-muted)] max-w-xs">
                Choose a conversation from the list or start a new one.
              </p>
            </div>
          ) : (
            <>
              {/* Thread header */}
              <div
                className="flex items-center gap-3 flex-shrink-0"
                style={{
                  padding: '0.75rem 1rem',
                  borderBottom: '1px solid var(--color-border)',
                }}
              >
                {activeConv && (
                  <>
                    <div
                      className="flex items-center justify-center flex-shrink-0"
                      style={{
                        width: '2rem',
                        height: '2rem',
                        borderRadius: 'var(--radius-leaf-sm)',
                        background: 'var(--color-brand)',
                        color: '#ffffff',
                      }}
                    >
                      {(() => {
                        const TypeIcon = TYPE_LABELS[activeConv.type]?.icon ?? MessageSquare
                        return <TypeIcon className="w-4 h-4" />
                      })()}
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold text-[var(--color-text)] truncate">
                        {getConversationDisplayName(activeConv)}
                      </h2>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {activeConv.participantCount} participant{activeConv.participantCount !== 1 ? 's' : ''}
                        {activeConv.orgName ? ` - ${activeConv.orgName}` : ''}
                      </p>
                    </div>
                  </>
                )}
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto" style={{ padding: '1rem' }}>
                {messagesLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin text-[var(--color-text-subtle)]" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <p className="text-sm text-[var(--color-text-muted)]">
                      No messages yet. Send one to get started.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {messages.map(msg => (
                      <div
                        key={msg.id}
                        className="flex gap-3"
                        style={{
                          background: msg.isInternal ? 'var(--color-bg-tertiary)' : 'transparent',
                          padding: msg.isInternal ? '0.75rem' : '0',
                          borderRadius: msg.isInternal ? 'var(--radius-card)' : '0',
                        }}
                      >
                        {/* Avatar */}
                        <div
                          className="flex items-center justify-center flex-shrink-0"
                          style={{
                            width: '2rem',
                            height: '2rem',
                            borderRadius: 'var(--radius-full)',
                            background: msg.authorType === 'team_member'
                              ? 'var(--color-brand-50)'
                              : 'var(--color-info-bg)',
                            color: msg.authorType === 'team_member'
                              ? 'var(--color-brand)'
                              : 'var(--color-info)',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                          }}
                        >
                          {getInitial(msg.authorName)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2">
                            <span className="text-sm font-semibold text-[var(--color-text)]">
                              {msg.authorName}
                            </span>
                            <span className="text-xs text-[var(--color-text-subtle)]">
                              {formatTime(msg.createdAt)}
                            </span>
                            {msg.isInternal && (
                              <span
                                className="text-xs px-1.5 py-0.5"
                                style={{
                                  background: 'var(--color-warning-bg)',
                                  color: 'var(--color-warning)',
                                  borderRadius: 'var(--radius-badge)',
                                  fontSize: '0.625rem',
                                  fontWeight: 500,
                                }}
                              >
                                Internal
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-[var(--color-text)] mt-0.5 whitespace-pre-wrap break-words">
                            {stripHtml(msg.body)}
                          </div>
                        </div>
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>

              {/* Composer */}
              <div
                className="flex-shrink-0"
                style={{
                  padding: '0.75rem 1rem',
                  borderTop: '1px solid var(--color-border)',
                }}
              >
                <div
                  className="flex items-end gap-2"
                  style={{
                    padding: '0.5rem 0.75rem',
                    borderRadius: 'var(--radius-input)',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg-secondary)',
                  }}
                >
                  <textarea
                    value={composerText}
                    onChange={e => setComposerText(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handleSend()
                      }
                    }}
                    placeholder="Type a message..."
                    rows={1}
                    className="flex-1 text-sm bg-transparent border-none outline-none text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] resize-none"
                    style={{ minHeight: '1.5rem', maxHeight: '6rem' }}
                  />
                  <button
                    onClick={handleSend}
                    disabled={!composerText.trim() || sending}
                    className="flex items-center justify-center flex-shrink-0 transition-colors"
                    style={{
                      width: '2rem',
                      height: '2rem',
                      borderRadius: 'var(--radius-button)',
                      background: composerText.trim() ? 'var(--color-brand)' : 'var(--color-bg-tertiary)',
                      color: composerText.trim() ? '#ffffff' : 'var(--color-text-subtle)',
                      border: 'none',
                      cursor: composerText.trim() ? 'pointer' : 'default',
                    }}
                    aria-label="Send message"
                  >
                    {sending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* New Conversation Dialog */}
      {showNewDialog && (
        <NewConversationDialog
          isAdmin={isAdmin}
          onClose={() => setShowNewDialog(false)}
          onCreated={(id: string) => {
            setShowNewDialog(false)
            setActiveConvId(id)
            fetchConversations()
          }}
        />
      )}
    </div>
  )
}

// ── New Conversation Dialog ─────────────────────────────────────────────────

function NewConversationDialog({
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
            participantIds: [],
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0, 0, 0, 0.5)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-conv-title"
    >
      <div
        className="w-full max-w-md"
        style={{
          background: 'var(--color-bg)',
          borderRadius: 'var(--radius-card)',
          boxShadow: 'var(--shadow-lg)',
          padding: '1.5rem',
        }}
      >
        <h2
          id="new-conv-title"
          className="text-lg font-semibold text-[var(--color-text)] mb-4"
        >
          New Conversation
        </h2>

        <div className="space-y-4">
          {isAdmin ? (
            <>
              {/* Type */}
              <div>
                <label htmlFor="conv-type" className="block text-sm font-medium text-[var(--color-text)] mb-1">
                  Type
                </label>
                <select
                  id="conv-type"
                  value={type}
                  onChange={e => setType(e.target.value)}
                  className="w-full text-sm text-[var(--color-text)]"
                  style={{
                    padding: '0.5rem 0.75rem',
                    borderRadius: 'var(--radius-input)',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg)',
                    minHeight: '2.75rem',
                  }}
                >
                  <option value="direct">Direct Message</option>
                  <option value="group">Group</option>
                  <option value="org_channel">Org Channel</option>
                  <option value="request_thread">Request Thread</option>
                </select>
              </div>

              {/* Name (for group/channel) */}
              {(type === 'group' || type === 'org_channel') && (
                <div>
                  <label htmlFor="conv-name" className="block text-sm font-medium text-[var(--color-text)] mb-1">
                    Name
                  </label>
                  <input
                    id="conv-name"
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Conversation name..."
                    className="w-full text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)]"
                    style={{
                      padding: '0.5rem 0.75rem',
                      borderRadius: 'var(--radius-input)',
                      border: '1px solid var(--color-border)',
                      background: 'var(--color-bg)',
                      minHeight: '2.75rem',
                    }}
                  />
                </div>
              )}

              {/* Visibility */}
              <div>
                <label htmlFor="conv-visibility" className="block text-sm font-medium text-[var(--color-text)] mb-1">
                  Visibility
                </label>
                <select
                  id="conv-visibility"
                  value={visibility}
                  onChange={e => setVisibility(e.target.value)}
                  className="w-full text-sm text-[var(--color-text)]"
                  style={{
                    padding: '0.5rem 0.75rem',
                    borderRadius: 'var(--radius-input)',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg)',
                    minHeight: '2.75rem',
                  }}
                >
                  <option value="external">External (visible to clients)</option>
                  <option value="internal">Internal (team only)</option>
                </select>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-[var(--color-text-muted)]">
                Start a new conversation with the Tahi team.
              </p>
              {/* Initial message for portal users */}
              <div>
                <label htmlFor="conv-initial-msg" className="block text-sm font-medium text-[var(--color-text)] mb-1">
                  Message (optional)
                </label>
                <textarea
                  id="conv-initial-msg"
                  value={initialMessage}
                  onChange={e => setInitialMessage(e.target.value)}
                  placeholder="Type your first message..."
                  rows={3}
                  className="w-full text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] resize-none"
                  style={{
                    padding: '0.5rem 0.75rem',
                    borderRadius: 'var(--radius-input)',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg)',
                  }}
                />
              </div>
            </>
          )}

          {errorMsg && (
            <div aria-live="polite" className="text-sm" style={{ color: 'var(--color-danger)' }}>
              {errorMsg}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium transition-colors"
            style={{
              color: 'var(--color-text-muted)',
              background: 'var(--color-bg-secondary)',
              borderRadius: 'var(--radius-button)',
              border: '1px solid var(--color-border)',
              cursor: 'pointer',
              minHeight: '2.75rem',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="px-4 py-2 text-sm font-medium text-white transition-colors"
            style={{
              background: 'var(--color-brand)',
              borderRadius: 'var(--radius-button)',
              border: 'none',
              cursor: creating ? 'not-allowed' : 'pointer',
              opacity: creating ? 0.7 : 1,
              minHeight: '2.75rem',
            }}
          >
            {creating ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
