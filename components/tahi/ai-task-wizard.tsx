'use client'

import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react'
import { Sparkles, Send, Loader2, Pencil, Check, ChevronDown } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { SlideOver } from '@/components/tahi/slide-over'

// ── Types ─────────────────────────────────────────────────────────────────────

interface TaskDraft {
  id: string
  title: string
  description: string
  category: string
  type: 'small' | 'large'
  estimatedHours: number
  priority: 'low' | 'medium' | 'high' | 'urgent'
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  tasks?: TaskDraft[]
}

interface AiTaskWizardProps {
  open: boolean
  onClose: () => void
  onTasksCreated?: () => void
  context?: {
    orgId?: string
    trackType?: string
  }
}

// ── Category and priority style maps ──────────────────────────────────────────

// Categories are non-semantic tags : use distinct-but-neutral palette so
// "Strategy" doesn't look dangerous and "Content" doesn't look like a warning.
const CATEGORY_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  design:      { bg: 'var(--status-client-review-bg)', text: 'var(--status-client-review-text)', label: 'Design'      }, // purple
  development: { bg: 'var(--status-submitted-bg)',     text: 'var(--status-submitted-text)',     label: 'Development' }, // blue
  content:     { bg: 'var(--status-in-progress-bg)',   text: 'var(--status-in-progress-text)',   label: 'Content'     }, // teal
  seo:         { bg: 'var(--color-brand-50)',          text: 'var(--color-brand)',               label: 'SEO'         }, // brand green
  strategy:    { bg: 'var(--color-bg-tertiary)',       text: 'var(--color-text-muted)',          label: 'Strategy'    }, // neutral (not a warning!)
}

// Priority uses the shared priority-* tokens so wizard High/Urgent matches
// the rest of the app (high = red, urgent = rose).
const PRIORITY_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  low:    { bg: 'var(--color-bg-tertiary)',    text: 'var(--color-text-muted)',       label: 'Low'    },
  medium: { bg: 'var(--status-submitted-bg)',  text: 'var(--status-submitted-text)',  label: 'Medium' },
  high:   { bg: 'var(--priority-high-bg)',     text: 'var(--priority-high-text)',     label: 'High'   },
  urgent: { bg: 'var(--priority-urgent-bg)',   text: 'var(--priority-urgent-text)',   label: 'Urgent' },
}

const CATEGORY_OPTIONS = ['design', 'development', 'content', 'seo', 'strategy']
const PRIORITY_OPTIONS: Array<TaskDraft['priority']> = ['low', 'medium', 'high', 'urgent']

const INITIAL_MESSAGE: ChatMessage = {
  role: 'assistant',
  content: 'What do you need help with? I can create tasks for design, development, content, SEO, or strategy work.',
}

// ── Main Component ────────────────────────────────────────────────────────────

export function AiTaskWizard({ open, onClose, onTasksCreated, context = {} }: AiTaskWizardProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MESSAGE])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<TaskDraft | null>(null)
  const [hoveredButton, setHoveredButton] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Get the latest tasks from messages
  const latestTasks = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].tasks && messages[i].tasks!.length > 0) {
        return { tasks: messages[i].tasks!, index: i }
      }
    }
    return null
  })()

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input when panel opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 300)
    }
  }, [open])

  // Reset state when closing
  const handleClose = useCallback(() => {
    onClose()
    setTimeout(() => {
      setMessages([INITIAL_MESSAGE])
      setInput('')
      setSending(false)
      setCreating(false)
      setEditingTaskId(null)
      setEditForm(null)
    }, 300)
  }, [onClose])

  // Send message to wizard API
  const handleSend = useCallback(async () => {
    const trimmed = input.trim()
    if (!trimmed || sending) return

    const userMessage: ChatMessage = { role: 'user', content: trimmed }
    const updatedMessages = [...messages, userMessage]
    setMessages(updatedMessages)
    setInput('')
    setSending(true)

    try {
      const apiMessages = updatedMessages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({ role: m.role, content: m.content }))

      const res = await fetch(apiPath('/api/admin/ai/task-wizard'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages, context }),
      })

      if (!res.ok) throw new Error('Failed to get response')

      const data = await res.json() as { reply: string; tasks?: TaskDraft[]; done: boolean }
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: data.reply,
        tasks: data.tasks,
      }
      setMessages(prev => [...prev, assistantMessage])
    } catch {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' },
      ])
    } finally {
      setSending(false)
    }
  }, [input, sending, messages, context])

  // Handle keyboard submit
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }, [handleSend])

  // Edit task handlers
  const startEdit = useCallback((task: TaskDraft) => {
    setEditingTaskId(task.id)
    setEditForm({ ...task })
  }, [])

  const saveEdit = useCallback(() => {
    if (!editForm || !latestTasks) return

    const updatedTasks = latestTasks.tasks.map(t =>
      t.id === editForm.id ? editForm : t
    )

    setMessages(prev => prev.map((m, i) =>
      i === latestTasks.index ? { ...m, tasks: updatedTasks } : m
    ))

    setEditingTaskId(null)
    setEditForm(null)
  }, [editForm, latestTasks])

  const cancelEdit = useCallback(() => {
    setEditingTaskId(null)
    setEditForm(null)
  }, [])

  // Create tasks
  const handleCreateTasks = useCallback(async () => {
    if (!latestTasks || creating) return
    setCreating(true)

    try {
      const results: boolean[] = []
      for (const task of latestTasks.tasks) {
        // Map wizard priority to schema priority (standard | high | urgent)
        let mappedPriority = 'standard'
        if (task.priority === 'urgent') mappedPriority = 'urgent'
        else if (task.priority === 'high') mappedPriority = 'high'

        // Task type: client_task when org is set, tahi_internal otherwise
        const taskType = context.orgId ? 'client_task' : 'tahi_internal'

        // Append category and estimated hours as metadata in description
        const descParts = [task.description]
        if (task.category) descParts.push(`\nCategory: ${task.category}`)
        if (task.estimatedHours) descParts.push(`Estimated hours: ${task.estimatedHours}`)

        const res = await fetch(apiPath('/api/admin/tasks'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: task.title,
            description: descParts.join('\n'),
            type: taskType,
            priority: mappedPriority,
            orgId: context.orgId ?? null,
          }),
        })
        results.push(res.ok)
      }

      const allOk = results.every(Boolean)
      if (allOk) {
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            content: `Done! ${latestTasks.tasks.length === 1 ? 'Task has' : `All ${latestTasks.tasks.length} tasks have`} been created successfully.`,
          },
        ])
        onTasksCreated?.()
      } else {
        setMessages(prev => [
          ...prev,
          { role: 'assistant', content: 'Some tasks could not be created. Please try again.' },
        ])
      }
    } catch {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: 'Failed to create tasks. Please try again.' },
      ])
    } finally {
      setCreating(false)
    }
  }, [latestTasks, creating, context.orgId, onTasksCreated])

  if (!open) return null

  return (
    <SlideOver
      open={open}
      onClose={handleClose}
      icon={<Sparkles size={15} />}
      title="AI Task Wizard"
      subtitle="Describe what you need and I will create tasks"
      maxWidth="28rem"
    >
      {/* Header is now part of SlideOver. Keep the wrapper empty to satisfy JSX structure. */}
      <div style={{ display: 'none' }}>
        </div>

        {/* Messages area */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '1rem 1.25rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}
        >
          {messages.map((msg, idx) => (
            <div key={idx}>
              <MessageBubble message={msg} />
              {msg.tasks && msg.tasks.length > 0 && (
                <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {msg.tasks.map(task => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      editing={editingTaskId === task.id}
                      editForm={editingTaskId === task.id ? editForm : null}
                      onStartEdit={() => startEdit(task)}
                      onSaveEdit={saveEdit}
                      onCancelEdit={cancelEdit}
                      onEditFormChange={setEditForm}
                      hoveredButton={hoveredButton}
                      onHoverButton={setHoveredButton}
                    />
                  ))}

                  {/* Create Tasks button */}
                  <button
                    onClick={() => void handleCreateTasks()}
                    disabled={creating}
                    onMouseEnter={() => setHoveredButton('create')}
                    onMouseLeave={() => setHoveredButton(null)}
                    style={{
                      width: '100%',
                      padding: '0.75rem 1rem',
                      borderRadius: '0.5rem',
                      border: 'none',
                      background: creating
                        ? 'var(--color-text-subtle)'
                        : hoveredButton === 'create'
                          ? 'var(--color-brand-dark)'
                          : 'var(--color-brand)',
                      color: '#ffffff',
                      fontSize: '0.875rem',
                      fontWeight: 600,
                      cursor: creating ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem',
                      transition: 'background 150ms ease',
                      minHeight: '2.75rem',
                    }}
                  >
                    {creating && <Loader2 style={{ width: '1rem', height: '1rem' }} className="animate-spin" />}
                    {creating
                      ? 'Creating...'
                      : `Create ${msg.tasks.length === 1 ? 'Task' : `${msg.tasks.length} Tasks`}`
                    }
                  </button>
                </div>
              )}
            </div>
          ))}

          {/* Sending indicator */}
          {sending && (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <div
                style={{
                  width: '1.75rem',
                  height: '1.75rem',
                  borderRadius: '0 0.5rem 0 0.5rem',
                  background: 'linear-gradient(135deg, var(--color-brand), var(--color-brand-dark))',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Sparkles style={{ width: '0.75rem', height: '0.75rem', color: '#ffffff' }} />
              </div>
              <div
                style={{
                  padding: '0.75rem 1rem',
                  borderRadius: '0.5rem',
                  background: 'var(--color-bg-secondary)',
                  display: 'flex',
                  gap: '0.375rem',
                  alignItems: 'center',
                }}
              >
                <Loader2 style={{ width: '0.875rem', height: '0.875rem', color: 'var(--color-text-subtle)' }} className="animate-spin" />
                <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                  Thinking...
                </span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div
          style={{
            padding: '0.75rem 1.25rem 1rem',
            borderTop: '1px solid var(--color-border)',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              gap: '0.5rem',
              alignItems: 'flex-end',
            }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe what you need..."
              rows={1}
              style={{
                flex: 1,
                padding: '0.625rem 0.75rem',
                borderRadius: '0.5rem',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
                color: 'var(--color-text)',
                fontSize: '0.875rem',
                fontFamily: 'inherit',
                resize: 'none',
                outline: 'none',
                minHeight: '2.5rem',
                maxHeight: '6rem',
                lineHeight: 1.5,
              }}
              onFocus={e => {
                e.currentTarget.style.borderColor = 'var(--color-brand)'
              }}
              onBlur={e => {
                e.currentTarget.style.borderColor = 'var(--color-border)'
              }}
            />
            <button
              onClick={() => void handleSend()}
              disabled={!input.trim() || sending}
              onMouseEnter={() => setHoveredButton('send')}
              onMouseLeave={() => setHoveredButton(null)}
              style={{
                padding: '0.625rem',
                borderRadius: '0.5rem',
                border: 'none',
                background: !input.trim() || sending
                  ? 'var(--color-bg-tertiary)'
                  : hoveredButton === 'send'
                    ? 'var(--color-brand-dark)'
                    : 'var(--color-brand)',
                color: !input.trim() || sending
                  ? 'var(--color-text-subtle)'
                  : '#ffffff',
                cursor: !input.trim() || sending ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background 150ms ease',
                minWidth: '2.5rem',
                minHeight: '2.5rem',
                flexShrink: 0,
              }}
              aria-label="Send message"
            >
              {sending
                ? <Loader2 style={{ width: '1rem', height: '1rem' }} className="animate-spin" />
                : <Send style={{ width: '1rem', height: '1rem' }} />
              }
            </button>
          </div>
          <p
            style={{
              fontSize: '0.6875rem',
              color: 'var(--color-text-subtle)',
              marginTop: '0.375rem',
            }}
          >
            Press Enter to send, Shift+Enter for new line
          </p>
        </div>
    </SlideOver>
  )
}

// ── Trigger Button ────────────────────────────────────────────────────────────

export function AiTaskWizardButton({ onClick }: { onClick: () => void }) {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.375rem',
        padding: '0.5rem 0.875rem',
        borderRadius: '0.5rem',
        border: '1px solid var(--color-border)',
        background: hovered ? 'var(--color-bg-tertiary)' : 'var(--color-bg)',
        color: 'var(--color-brand)',
        fontSize: '0.875rem',
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'background 150ms ease, border-color 150ms ease',
        minHeight: '2.5rem',
      }}
      aria-label="Open AI Task Wizard"
    >
      <Sparkles style={{ width: '1rem', height: '1rem' }} />
      AI Help
    </button>
  )
}

// ── Inline Markdown Renderer ─────────────────────────────────────────────────

function renderInlineFormatting(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  // Match **bold** and *italic* patterns
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*)/g
  let lastIndex = 0
  let match: RegExpExecArray | null = null

  while ((match = regex.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    if (match[2]) {
      // **bold**
      parts.push(<strong key={match.index}>{match[2]}</strong>)
    } else if (match[3]) {
      // *italic*
      parts.push(<em key={match.index}>{match[3]}</em>)
    }
    lastIndex = match.index + match[0].length
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts.length > 0 ? parts : [text]
}

function renderMessageContent(content: string): ReactNode {
  const lines = content.split('\n')
  const elements: ReactNode[] = []
  let listItems: ReactNode[] = []
  let listStart = 0

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ol
          key={`ol-${listStart}`}
          style={{
            margin: '0.375rem 0',
            paddingLeft: '1.25rem',
            listStyleType: 'decimal',
          }}
        >
          {listItems}
        </ol>
      )
      listItems = []
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const numberedMatch = line.match(/^(\d+)\.\s+(.+)$/)

    if (numberedMatch) {
      if (listItems.length === 0) {
        listStart = i
      }
      listItems.push(
        <li key={i} style={{ marginBottom: '0.125rem' }}>
          {renderInlineFormatting(numberedMatch[2])}
        </li>
      )
    } else {
      flushList()
      if (line.trim() === '') {
        elements.push(<br key={i} />)
      } else {
        elements.push(
          <span key={i}>
            {i > 0 && listItems.length === 0 && elements.length > 0 && lines[i - 1].trim() !== '' ? <br /> : null}
            {renderInlineFormatting(line)}
          </span>
        )
      }
    }
  }

  flushList()

  return <>{elements}</>
}

// ── Message Bubble ────────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'

  return (
    <div
      style={{
        display: 'flex',
        gap: '0.5rem',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        alignItems: 'flex-start',
      }}
    >
      {!isUser && (
        <div
          style={{
            width: '1.75rem',
            height: '1.75rem',
            borderRadius: '0 0.5rem 0 0.5rem',
            background: 'linear-gradient(135deg, var(--color-brand), var(--color-brand-dark))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            marginTop: '0.125rem',
          }}
        >
          <Sparkles style={{ width: '0.75rem', height: '0.75rem', color: '#ffffff' }} />
        </div>
      )}
      <div
        style={{
          maxWidth: '85%',
          padding: '0.625rem 0.875rem',
          borderRadius: isUser ? '0.75rem 0.75rem 0.125rem 0.75rem' : '0.75rem 0.75rem 0.75rem 0.125rem',
          background: isUser
            ? 'var(--color-brand)'
            : 'var(--color-bg-secondary)',
          color: isUser
            ? '#ffffff'
            : 'var(--color-text)',
          fontSize: '0.875rem',
          lineHeight: 1.6,
          whiteSpace: isUser ? 'pre-wrap' : 'normal',
          wordBreak: 'break-word' as const,
        }}
      >
        {isUser ? message.content : renderMessageContent(message.content)}
      </div>
    </div>
  )
}

// ── Task Card ─────────────────────────────────────────────────────────────────

interface TaskCardProps {
  task: TaskDraft
  editing: boolean
  editForm: TaskDraft | null
  onStartEdit: () => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onEditFormChange: (form: TaskDraft | null) => void
  hoveredButton: string | null
  onHoverButton: (id: string | null) => void
}

const labelStyle: React.CSSProperties = {
  fontSize: '0.6875rem',
  fontWeight: 600,
  color: 'var(--color-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  display: 'block',
}

const fieldInputStyle: React.CSSProperties = {
  width: '100%',
  marginTop: '0.25rem',
  padding: '0.5rem 0.625rem',
  borderRadius: '0.375rem',
  border: '1px solid var(--color-border)',
  fontSize: '0.875rem',
  color: 'var(--color-text)',
  background: 'var(--color-bg)',
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box' as const,
}

const selectWrapperStyle: React.CSSProperties = {
  position: 'relative' as const,
  marginTop: '0.25rem',
}

const selectChevronStyle: React.CSSProperties = {
  position: 'absolute' as const,
  right: '0.5rem',
  top: '50%',
  transform: 'translateY(-50%)',
  width: '0.875rem',
  height: '0.875rem',
  color: 'var(--color-text-subtle)',
  pointerEvents: 'none' as const,
}

function TaskCard({
  task,
  editing,
  editForm,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onEditFormChange,
  hoveredButton,
  onHoverButton,
}: TaskCardProps) {
  const catStyle = CATEGORY_STYLES[task.category] ?? CATEGORY_STYLES.design
  const priStyle = PRIORITY_STYLES[task.priority] ?? PRIORITY_STYLES.medium

  if (editing && editForm) {
    return (
      <div
        style={{
          background: 'var(--color-bg)',
          border: '2px solid var(--color-brand)',
          borderRadius: '0.75rem',
          padding: '1rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
        }}
      >
        {/* Title */}
        <div>
          <label style={labelStyle}>Title</label>
          <input
            type="text"
            value={editForm.title}
            onChange={e => onEditFormChange({ ...editForm, title: e.target.value })}
            style={fieldInputStyle}
          />
        </div>

        {/* Description */}
        <div>
          <label style={labelStyle}>Description</label>
          <textarea
            value={editForm.description}
            onChange={e => onEditFormChange({ ...editForm, description: e.target.value })}
            rows={3}
            style={{ ...fieldInputStyle, resize: 'vertical' as const }}
          />
        </div>

        {/* Category + Priority row */}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Category</label>
            <div style={selectWrapperStyle}>
              <select
                value={editForm.category}
                onChange={e => onEditFormChange({ ...editForm, category: e.target.value })}
                style={{
                  ...fieldInputStyle,
                  marginTop: 0,
                  paddingRight: '1.75rem',
                  appearance: 'none' as const,
                  cursor: 'pointer',
                }}
              >
                {CATEGORY_OPTIONS.map(c => (
                  <option key={c} value={c}>{CATEGORY_STYLES[c]?.label ?? c}</option>
                ))}
              </select>
              <ChevronDown style={selectChevronStyle} />
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Priority</label>
            <div style={selectWrapperStyle}>
              <select
                value={editForm.priority}
                onChange={e => onEditFormChange({ ...editForm, priority: e.target.value as TaskDraft['priority'] })}
                style={{
                  ...fieldInputStyle,
                  marginTop: 0,
                  paddingRight: '1.75rem',
                  appearance: 'none' as const,
                  cursor: 'pointer',
                }}
              >
                {PRIORITY_OPTIONS.map(p => (
                  <option key={p} value={p}>{PRIORITY_STYLES[p]?.label ?? p}</option>
                ))}
              </select>
              <ChevronDown style={selectChevronStyle} />
            </div>
          </div>
        </div>

        {/* Track type + Hours row */}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Track</label>
            <div style={selectWrapperStyle}>
              <select
                value={editForm.type}
                onChange={e => onEditFormChange({ ...editForm, type: e.target.value as 'small' | 'large' })}
                style={{
                  ...fieldInputStyle,
                  marginTop: 0,
                  paddingRight: '1.75rem',
                  appearance: 'none' as const,
                  cursor: 'pointer',
                }}
              >
                <option value="small">Small (up to 1 day)</option>
                <option value="large">Large (1+ weeks)</option>
              </select>
              <ChevronDown style={selectChevronStyle} />
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Est. Hours</label>
            <input
              type="number"
              value={editForm.estimatedHours}
              onChange={e => onEditFormChange({ ...editForm, estimatedHours: parseInt(e.target.value) || 0 })}
              min={0}
              style={fieldInputStyle}
            />
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button
            onClick={onCancelEdit}
            onMouseEnter={() => onHoverButton('cancel-edit')}
            onMouseLeave={() => onHoverButton(null)}
            style={{
              padding: '0.375rem 0.75rem',
              borderRadius: '0.375rem',
              border: '1px solid var(--color-border)',
              background: hoveredButton === 'cancel-edit' ? 'var(--color-bg-secondary)' : 'var(--color-bg)',
              color: 'var(--color-text)',
              fontSize: '0.8125rem',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'background 150ms ease',
              minHeight: '2.25rem',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onSaveEdit}
            onMouseEnter={() => onHoverButton('save-edit')}
            onMouseLeave={() => onHoverButton(null)}
            style={{
              padding: '0.375rem 0.75rem',
              borderRadius: '0.375rem',
              border: 'none',
              background: hoveredButton === 'save-edit' ? 'var(--color-brand-dark)' : 'var(--color-brand)',
              color: '#ffffff',
              fontSize: '0.8125rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
              transition: 'background 150ms ease',
              minHeight: '2.25rem',
            }}
          >
            <Check style={{ width: '0.875rem', height: '0.875rem' }} />
            Save
          </button>
        </div>
      </div>
    )
  }

  // Read-only card
  return (
    <div
      style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: '0.75rem',
        padding: '0.875rem 1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        position: 'relative',
      }}
    >
      {/* Title + edit button */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
        <h4
          style={{
            flex: 1,
            fontSize: '0.875rem',
            fontWeight: 600,
            color: 'var(--color-text)',
            margin: 0,
            lineHeight: 1.4,
          }}
        >
          {task.title}
        </h4>
        <button
          onClick={onStartEdit}
          onMouseEnter={() => onHoverButton(`edit-${task.id}`)}
          onMouseLeave={() => onHoverButton(null)}
          style={{
            padding: '0.25rem',
            borderRadius: '0.25rem',
            border: 'none',
            background: hoveredButton === `edit-${task.id}` ? 'var(--color-bg-tertiary)' : 'transparent',
            color: 'var(--color-text-subtle)',
            cursor: 'pointer',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            transition: 'background 150ms ease',
          }}
          aria-label="Edit task"
        >
          <Pencil style={{ width: '0.875rem', height: '0.875rem' }} />
        </button>
      </div>

      {/* Description */}
      <p
        style={{
          fontSize: '0.8125rem',
          color: 'var(--color-text-muted)',
          margin: 0,
          lineHeight: 1.5,
        }}
      >
        {task.description}
      </p>

      {/* Badges row */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginTop: '0.125rem' }}>
        <span
          style={{
            fontSize: '0.6875rem',
            fontWeight: 600,
            padding: '0.125rem 0.5rem',
            borderRadius: '1rem',
            background: catStyle.bg,
            color: catStyle.text,
          }}
        >
          {catStyle.label}
        </span>
        <span
          style={{
            fontSize: '0.6875rem',
            fontWeight: 600,
            padding: '0.125rem 0.5rem',
            borderRadius: '1rem',
            background: priStyle.bg,
            color: priStyle.text,
          }}
        >
          {priStyle.label}
        </span>
        <span
          style={{
            fontSize: '0.6875rem',
            fontWeight: 600,
            padding: '0.125rem 0.5rem',
            borderRadius: '1rem',
            background: task.type === 'large' ? 'var(--status-in-review-bg)' : 'var(--status-submitted-bg)',
            color: task.type === 'large' ? 'var(--status-in-review-text)' : 'var(--status-submitted-text)',
          }}
        >
          {task.type === 'large' ? 'Large Track' : 'Small Track'}
        </span>
        <span
          style={{
            fontSize: '0.6875rem',
            fontWeight: 500,
            padding: '0.125rem 0.5rem',
            borderRadius: '1rem',
            background: 'var(--color-bg-tertiary)',
            color: 'var(--color-text-muted)',
          }}
        >
          ~{task.estimatedHours}h
        </span>
      </div>
    </div>
  )
}
