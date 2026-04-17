'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  MessageSquare, Search, Plus, Send, Users, Hash, AtSign,
  Loader2, Lock, Eye, EyeOff, Mic, Square, Trash2, ArrowLeft,
} from 'lucide-react'
import { apiPath } from '@/lib/api'
import { SearchableSelect } from '@/components/tahi/searchable-select'
import { useImpersonation } from '@/components/tahi/impersonation-banner'

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

// Deterministic waveform bar heights (seeded pattern, not random per render)
const WAVEFORM_HEIGHTS = [
  0.35, 0.55, 0.75, 0.45, 0.90, 0.60, 0.80, 0.40, 0.95, 0.50,
  0.70, 0.85, 0.30, 0.65, 1.00, 0.55, 0.45, 0.80, 0.60, 0.38,
]

function VoiceNotePlayer({ body }: { body: string }) {
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const durationMatch = body.match(/(\d+)s/)
  const duration = durationMatch ? parseInt(durationMatch[1]) : 0

  // Animate progress when "playing"
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
      {/* Waveform bars (deterministic) */}
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

// ── Component ─────────────────────────────────────────────────────────────────

export function MessagesContent({ isAdmin: isAdminProp }: { isAdmin: boolean }) {
  const { isImpersonatingClient } = useImpersonation()
  // Only switch to client view when impersonating a client, not a team member
  const isAdmin = isAdminProp && !isImpersonatingClient
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
  const [isRecording, setIsRecording] = useState(false)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [recordingDuration, setRecordingDuration] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
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

  // ── Delete message ────────────────────────────────────────────────────────

  const handleDeleteMessage = async (messageId: string) => {
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
  }

  // ── Voice recording ───────────────────────────────────────────────────────

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      const chunks: Blob[] = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }

      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunks, { type: 'audio/webm' })
        setRecordedBlob(blob)
        setIsRecording(false)
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current)
          recordingTimerRef.current = null
        }
      }

      mediaRecorderRef.current = recorder
      recorder.start()
      setIsRecording(true)
      setRecordingDuration(0)
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1)
      }, 1000)
    } catch {
      // Microphone access denied or unavailable
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
  }

  const discardRecording = () => {
    setRecordedBlob(null)
    setRecordingDuration(0)
  }

  const sendVoiceNote = async () => {
    if (!recordedBlob || !activeConvId) return
    setSending(true)
    try {
      // 1. Get presigned URL
      const presignRes = await fetch(apiPath('/api/uploads/presign'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: `voice-note-${Date.now()}.webm`,
          mimeType: 'audio/webm',
        }),
      })
      if (!presignRes.ok) throw new Error('Failed to get upload URL')
      const { uploadUrl, storageKey, fileId } = await presignRes.json() as {
        uploadUrl: string
        storageKey: string
        fileId: string
      }

      // 2. Upload to R2
      await fetch(apiPath(uploadUrl), {
        method: 'PUT',
        headers: { 'Content-Type': 'audio/webm' },
        body: recordedBlob,
      })

      // 3. Confirm upload
      await fetch(apiPath('/api/uploads/confirm'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId }),
      })

      // 4. Send a message with voice note reference
      const endpoint = isAdmin
        ? `/api/admin/conversations/${activeConvId}/messages`
        : `/api/portal/conversations/${activeConvId}/messages`
      await fetch(apiPath(endpoint), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: `[Voice note: ${recordingDuration}s]`,
          voiceNote: {
            storageKey,
            durationSeconds: recordingDuration,
            mimeType: 'audio/webm',
          },
        }),
      })

      setRecordedBlob(null)
      setRecordingDuration(0)
      await fetchMessages(activeConvId)
      await fetchConversations()
    } catch {
      // Error uploading voice note
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
      <div className="flex items-center justify-between mb-6">
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
          className={`flex flex-col flex-shrink-0 w-full md:w-80 md:max-w-80 ${activeConvId ? 'hidden md:flex' : 'flex'}`}
          style={{
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
                {!searchQuery && (
                  <button
                    onClick={() => setShowNewDialog(true)}
                    className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                    style={{
                      padding: '0.5rem 1rem',
                      background: 'var(--color-brand)',
                      borderRadius: 'var(--radius-button, 0.5rem)',
                      border: 'none',
                      cursor: 'pointer',
                      minHeight: '2.75rem',
                    }}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Start a conversation
                  </button>
                )}
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
        <div className={`flex flex-col flex-1 min-w-0 ${activeConvId ? 'flex' : 'hidden md:flex'}`}>
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
                {/* Back button for mobile */}
                <button
                  onClick={() => setActiveConvId(null)}
                  className="flex items-center justify-center flex-shrink-0 md:hidden"
                  style={{
                    width: '2rem',
                    height: '2rem',
                    borderRadius: 'var(--radius-button)',
                    background: 'var(--color-bg-secondary)',
                    color: 'var(--color-text-muted)',
                    border: 'none',
                    cursor: 'pointer',
                    minHeight: '2.75rem',
                    minWidth: '2.75rem',
                  }}
                  aria-label="Back to conversations"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
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
                    {messages.map(msg => {
                      const isDeleted = !!msg.deletedAt

                      return (
                        <div
                          key={msg.id}
                          className="group flex gap-3"
                          style={{
                            background: isDeleted
                              ? 'transparent'
                              : msg.isInternal ? 'var(--color-bg-tertiary)' : 'transparent',
                            padding: msg.isInternal && !isDeleted ? '0.75rem' : '0',
                            borderRadius: msg.isInternal && !isDeleted ? 'var(--radius-card)' : '0',
                          }}
                        >
                          {/* Avatar */}
                          <div
                            className="flex items-center justify-center flex-shrink-0"
                            style={{
                              width: '2rem',
                              height: '2rem',
                              borderRadius: 'var(--radius-full)',
                              background: isDeleted
                                ? 'var(--color-bg-tertiary)'
                                : msg.authorType === 'team_member'
                                  ? 'var(--color-brand-50)'
                                  : 'var(--color-info-bg)',
                              color: isDeleted
                                ? 'var(--color-text-subtle)'
                                : msg.authorType === 'team_member'
                                  ? 'var(--color-brand)'
                                  : 'var(--color-info)',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                            }}
                          >
                            {getInitial(msg.authorName)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-[var(--color-text)]">
                                {msg.authorName}
                              </span>
                              <span className="text-xs text-[var(--color-text-subtle)]">
                                {formatTime(msg.createdAt)}
                              </span>
                              {msg.isInternal && !isDeleted && (
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
                              {/* Delete button (admin only, on hover) */}
                              {isAdmin && !isDeleted && (
                                <button
                                  onClick={() => handleDeleteMessage(msg.id)}
                                  className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                                  style={{
                                    width: '1.5rem',
                                    height: '1.5rem',
                                    borderRadius: 'var(--radius-button)',
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    color: 'var(--color-text-subtle)',
                                    marginLeft: 'auto',
                                  }}
                                  aria-label="Delete message"
                                  title="Delete message"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                            {isDeleted ? (
                              <p
                                className="text-sm mt-0.5"
                                style={{
                                  color: 'var(--color-text-subtle)',
                                  fontStyle: 'italic',
                                }}
                              >
                                This message has been removed.
                              </p>
                            ) : msg.body.startsWith('[Voice note:') ? (
                              <VoiceNotePlayer body={msg.body} />
                            ) : (
                              <div className="text-sm text-[var(--color-text)] mt-0.5 whitespace-pre-wrap break-words">
                                {stripHtml(msg.body)}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
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
                  {/* Voice note controls */}
                  {isRecording ? (
                    <button
                      onClick={stopRecording}
                      className="flex items-center justify-center flex-shrink-0 transition-colors"
                      style={{
                        width: '2rem',
                        height: '2rem',
                        borderRadius: 'var(--radius-button)',
                        background: 'var(--color-danger)',
                        color: '#ffffff',
                        border: 'none',
                        cursor: 'pointer',
                      }}
                      aria-label="Stop recording"
                    >
                      <Square className="w-3.5 h-3.5" />
                    </button>
                  ) : recordedBlob ? (
                    <>
                      <span className="text-xs text-[var(--color-text-muted)] flex-shrink-0">
                        {recordingDuration}s recorded
                      </span>
                      <button
                        onClick={discardRecording}
                        className="flex items-center justify-center flex-shrink-0 transition-colors"
                        style={{
                          width: '2rem',
                          height: '2rem',
                          borderRadius: 'var(--radius-button)',
                          background: 'var(--color-bg-tertiary)',
                          color: 'var(--color-danger)',
                          border: 'none',
                          cursor: 'pointer',
                        }}
                        aria-label="Discard recording"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={sendVoiceNote}
                        disabled={sending}
                        className="flex items-center justify-center flex-shrink-0 transition-colors"
                        style={{
                          width: '2rem',
                          height: '2rem',
                          borderRadius: 'var(--radius-button)',
                          background: 'var(--color-brand)',
                          color: '#ffffff',
                          border: 'none',
                          cursor: 'pointer',
                        }}
                        aria-label="Send voice note"
                      >
                        {sending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Send className="w-4 h-4" />
                        )}
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={startRecording}
                      className="flex items-center justify-center flex-shrink-0 transition-colors hover:opacity-80"
                      style={{
                        width: '2rem',
                        height: '2rem',
                        borderRadius: 'var(--radius-button)',
                        background: 'var(--color-bg-tertiary)',
                        color: 'var(--color-text-muted)',
                        border: 'none',
                        cursor: 'pointer',
                      }}
                      aria-label="Record voice note"
                    >
                      <Mic className="w-4 h-4" />
                    </button>
                  )}

                  {/* Hide text send button when voice note is recorded (avoids duplicate) */}
                  {!recordedBlob && (
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
                  )}
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

      {/* Mobile bottom nav spacer */}
      <div className="h-28 md:hidden" aria-hidden="true" />
    </div>
  )
}

// ── New Conversation Dialog ─────────────────────────────────────────────────

interface ParticipantSelectOption {
  value: string
  label: string
  subtitle?: string
}

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
            opts.push({ value: `team:${m.id}`, label: m.name, subtitle: `Team - ${m.email}` })
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

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center"
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

              {/* Participants */}
              <div>
                <label className="block text-sm font-medium text-[var(--color-text)] mb-1">
                  Participants
                </label>
                <SearchableSelect
                  options={participantOptions.filter(o => !selectedParticipantIds.includes(o.value))}
                  value={participantSearch}
                  onChange={addParticipant}
                  placeholder="Add a participant..."
                  searchPlaceholder="Search team or clients..."
                  allowClear
                />
                {selectedParticipantIds.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {selectedParticipantIds.map(pid => {
                      const opt = participantOptions.find(o => o.value === pid)
                      return (
                        <span
                          key={pid}
                          className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full"
                          style={{
                            background: 'var(--color-brand-50)',
                            color: 'var(--color-brand-dark)',
                          }}
                        >
                          {opt?.label ?? pid}
                          <button
                            type="button"
                            onClick={() => removeParticipant(pid)}
                            className="ml-0.5 hover:opacity-70"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0 }}
                            aria-label={`Remove ${opt?.label ?? pid}`}
                          >
                            x
                          </button>
                        </span>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Visibility */}
              <div>
                <label className="block text-sm font-medium text-[var(--color-text)] mb-1">
                  Visibility
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setVisibility('external')}
                    className="flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-lg border transition-colors"
                    style={{
                      background: visibility === 'external' ? 'var(--color-brand-50)' : 'var(--color-bg)',
                      borderColor: visibility === 'external' ? 'var(--color-brand)' : 'var(--color-border)',
                      color: visibility === 'external' ? 'var(--color-brand-dark)' : 'var(--color-text-muted)',
                      cursor: 'pointer',
                    }}
                  >
                    <Eye className="w-3.5 h-3.5" />
                    External
                  </button>
                  <button
                    type="button"
                    onClick={() => setVisibility('internal')}
                    className="flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-lg border transition-colors"
                    style={{
                      background: visibility === 'internal' ? 'var(--color-warning-bg)' : 'var(--color-bg)',
                      borderColor: visibility === 'internal' ? 'var(--color-warning)' : 'var(--color-border)',
                      color: visibility === 'internal' ? 'var(--color-warning)' : 'var(--color-text-muted)',
                      cursor: 'pointer',
                    }}
                  >
                    <EyeOff className="w-3.5 h-3.5" />
                    Internal
                  </button>
                </div>
                <p className="text-xs mt-1" style={{ color: 'var(--color-text-subtle)' }}>
                  {visibility === 'internal' ? 'Only visible to the Tahi team.' : 'Visible to clients and team.'}
                </p>
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
