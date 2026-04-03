'use client'

import { useState, useRef, useEffect } from 'react'
import { X, Sparkles, Send, Loader2, Check, Pencil } from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { apiPath } from '@/lib/api'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface TaskDraft {
  title: string
  description: string
  category: string
  type: string
  priority: string
  estimatedHours?: number
}

interface WizardProps {
  open: boolean
  onClose: () => void
  orgId?: string
  onTasksCreated?: () => void
}

const CATEGORY_COLORS: Record<string, string> = {
  design: '#7c3aed',
  development: '#2563eb',
  content: '#ea580c',
  seo: '#0891b2',
  strategy: '#059669',
}

export function AiTaskWizard({ open, onClose, orgId, onTasksCreated }: WizardProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: "What do you need help with? I can create tasks for design, development, content, SEO, or strategy work. Describe what you need and I'll figure out the rest.",
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [tasks, setTasks] = useState<TaskDraft[]>([])
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, tasks])

  async function handleSend() {
    if (!input.trim() || loading) return
    const userMessage: Message = { role: 'user', content: input.trim() }
    const newMessages = [...messages, userMessage]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    try {
      const res = await fetch(apiPath('/api/admin/ai/task-wizard'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages,
          context: { orgId },
        }),
      })
      if (!res.ok) throw new Error('Failed')
      const data = await res.json() as { reply: string; tasks?: TaskDraft[]; done: boolean }
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }])
      if (data.tasks?.length) {
        setTasks(data.tasks)
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' }])
    } finally {
      setLoading(false)
    }
  }

  async function handleCreateTasks() {
    if (!tasks.length) return
    setCreating(true)
    try {
      for (const task of tasks) {
        await fetch(apiPath('/api/admin/tasks'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: task.title,
            description: task.description,
            type: 'client_task',
            priority: task.priority,
            orgId,
          }),
        })
      }
      setMessages(prev => [...prev, { role: 'assistant', content: `Created ${tasks.length} task${tasks.length > 1 ? 's' : ''} successfully!` }])
      setTasks([])
      onTasksCreated?.()
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Failed to create some tasks. Please try again.' }])
    } finally {
      setCreating(false)
    }
  }

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-40"
        onClick={onClose}
      />

      {/* Slide-over panel */}
      <div
        className="fixed right-0 top-0 bottom-0 z-50 flex flex-col bg-[var(--color-bg)] border-l border-[var(--color-border)] shadow-2xl"
        style={{
          width: 'min(28rem, 100vw)',
          animation: 'slideInFromRight 200ms ease-out',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2">
            <div
              className="flex items-center justify-center brand-gradient"
              style={{ width: '1.75rem', height: '1.75rem', borderRadius: 'var(--radius-leaf-sm)' }}
            >
              <Sparkles className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-sm font-semibold text-[var(--color-text)]">AI Task Creator</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className="rounded-xl text-sm leading-relaxed"
                style={{
                  maxWidth: '85%',
                  padding: '0.625rem 0.875rem',
                  background: msg.role === 'user' ? 'var(--color-brand)' : 'var(--color-bg-tertiary)',
                  color: msg.role === 'user' ? 'white' : 'var(--color-text)',
                  borderRadius: msg.role === 'user'
                    ? '1rem 1rem 0.25rem 1rem'
                    : '1rem 1rem 1rem 0.25rem',
                }}
              >
                {msg.content}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div
                className="rounded-xl text-sm flex items-center gap-2"
                style={{
                  padding: '0.625rem 0.875rem',
                  background: 'var(--color-bg-tertiary)',
                  color: 'var(--color-text-muted)',
                }}
              >
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Thinking...
              </div>
            </div>
          )}

          {/* Task preview cards */}
          {tasks.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-[var(--color-text-subtle)] uppercase tracking-wider">
                Generated Tasks
              </p>
              {tasks.map((task, i) => (
                <div
                  key={i}
                  className="border rounded-xl bg-[var(--color-bg)] overflow-hidden"
                  style={{ borderColor: 'var(--color-border)' }}
                >
                  {editingIdx === i ? (
                    <div className="p-3 space-y-2">
                      <input
                        type="text"
                        value={task.title}
                        onChange={e => {
                          const updated = [...tasks]
                          updated[i] = { ...task, title: e.target.value }
                          setTasks(updated)
                        }}
                        className="w-full text-sm font-medium rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2.5 py-1.5 text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
                      />
                      <textarea
                        value={task.description}
                        onChange={e => {
                          const updated = [...tasks]
                          updated[i] = { ...task, description: e.target.value }
                          setTasks(updated)
                        }}
                        rows={2}
                        className="w-full text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2.5 py-1.5 text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
                      />
                      <button
                        onClick={() => setEditingIdx(null)}
                        className="text-xs text-[var(--color-brand)] font-medium cursor-pointer hover:underline"
                      >
                        Done editing
                      </button>
                    </div>
                  ) : (
                    <div className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[var(--color-text)] truncate">{task.title}</p>
                          <p className="text-xs text-[var(--color-text-muted)] mt-0.5 line-clamp-2">{task.description}</p>
                        </div>
                        <button
                          onClick={() => setEditingIdx(i)}
                          className="p-1 rounded hover:bg-[var(--color-bg-tertiary)] text-[var(--color-text-subtle)] cursor-pointer flex-shrink-0"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <span
                          className="text-xs font-medium rounded-full"
                          style={{
                            padding: '0.0625rem 0.5rem',
                            background: `${CATEGORY_COLORS[task.category] ?? 'var(--color-text-subtle)'}15`,
                            color: CATEGORY_COLORS[task.category] ?? 'var(--color-text-subtle)',
                          }}
                        >
                          {task.category}
                        </span>
                        <span className="text-xs text-[var(--color-text-subtle)]">
                          {task.type === 'large' ? 'Large Track' : 'Small Track'}
                        </span>
                        <span className="text-xs text-[var(--color-text-subtle)] capitalize">
                          {task.priority}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <TahiButton
                size="sm"
                onClick={handleCreateTasks}
                loading={creating}
                iconLeft={<Check className="w-3.5 h-3.5" />}
                className="w-full"
              >
                Create {tasks.length} Task{tasks.length > 1 ? 's' : ''}
              </TahiButton>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-[var(--color-border)] px-4 py-3">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
              placeholder="Describe what you need..."
              className="flex-1 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
              disabled={loading}
            />
            <button
              onClick={handleSend}
              disabled={loading || !input.trim()}
              className="p-2 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: 'var(--color-brand)',
                color: 'white',
              }}
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes slideInFromRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </>
  )
}
