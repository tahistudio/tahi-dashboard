'use client'

/**
 * <AiTaskWizard> and <AiTaskWizardPanel>. Drafting tasks by talking, or by
 * handing over a brief.
 *
 * Two entry points, the same body:
 *   - <AiTaskWizardPanel> is the progress line, the transcript and the
 *     composer with no shell of its own. The new task dialog renders it as
 *     its own AI view, so the interview and the form are one surface rather
 *     than a second container over the first.
 *   - <AiTaskWizard> keeps the standalone right-hand drawer for the two
 *     callers that open the wizard on its own (the tasks header and the
 *     request detail's "break into tasks"). Both reach it through a dynamic
 *     import by name, so the export name is load-bearing.
 *
 * Every prop added by the split is optional, so those two callers compile and
 * behave exactly as they did.
 *
 * The composer takes a brief as well as a sentence: a paperclip, a drop
 * zone over the transcript, and a chip that names the file. An unreadable file
 * is refused here as well as on the server, so a .docx costs no round trip.
 *
 * The invariant does not move: nothing is written until a human presses a
 * button. Where a form is waiting for the draft, handing it over is the
 * primary action and nothing is posted at all.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, FileText, Loader2, Paperclip, Pencil, Send, Sparkles, X } from 'lucide-react'
import { useSWRConfig } from 'swr'
import { apiPath } from '@/lib/api'
import { SlideOver } from '@/components/tahi/slide-over'
import { DEGRADED_PREFIX, aiWizardProgress } from '@/components/tahi/ai-request-wizard'
import { TASK_PRIORITIES, taskPriorityLabel } from '@/lib/task-priorities'
import { DOCUMENT_MAX_BYTES, classifyDocument } from '@/lib/ai-documents'
import {
  buildCreateTaskBody,
  draftToTaskFields,
  type DraftContext,
  type NamedOption,
  type TaskFields,
  type TaskWizardDraft,
} from '@/lib/task-wizard-drafts'
import type { TaskLevel } from '@/lib/tasks-views'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  tasks?: TaskWizardDraft[]
  /**
   * Renders as a warning strip rather than an assistant bubble. Used when the
   * model was never reached, so nobody mistakes a keyword draft or an error
   * for something Claude said.
   */
  notice?: boolean
  /** The file this turn carried, named on the bubble so the transcript still
   *  shows where a draft came from after the chip is gone. */
  attachment?: string
}

interface PickedDocument {
  filename: string
  mimeType: string
  sizeBytes: number
  dataBase64: string
}

export interface AiTaskWizardPanelProps {
  onTasksCreated?: () => void
  context?: {
    orgId?: string
    trackType?: string
    /**
     * Source request id. When set, every task created from this wizard is
     * linked back to the request (tasks.requestId) so the request detail
     * "Tasks" panel and the task "Linked Request" field resolve.
     */
    requestId?: string
    /** The level the caller has already chosen. Otherwise it is derived: a
     *  draft with a client becomes Internal, one without becomes Tahi. */
    level?: TaskLevel
  }
  /**
   * Optional pre-seed for the input box. When provided, the composer opens
   * with this text already typed so the operator can review / tweak it and
   * hit send themselves. We deliberately do NOT auto-send: the human still
   * initiates the AI call. Used by the request-detail "break into tasks"
   * action to hand the request's title/description/category to the wizard.
   */
  seed?: string
  /**
   * SWR keys to revalidate once the drafts have been created. Without this
   * the caller's list keeps showing the state before the wizard ran, which
   * is what made the request detail's Tasks panel look like the wizard had
   * done nothing.
   */
  mutateKeys?: string[]
  /** The lists the model chooses names from and the resolvers map back. */
  clients?: readonly NamedOption[]
  people?: readonly NamedOption[]
  requests?: readonly { id: string; requestNumber: number | null; title: string }[]
  /** Hand one draft back to a create form instead of filing it. When this is
   *  set it becomes the primary action, exactly as it is on the request side. */
  onDraftToForm?: (fields: TaskFields) => void
  /** The escape hatch beside it. */
  onWriteItMyself?: () => void
}

export interface AiTaskWizardProps extends AiTaskWizardPanelProps {
  open: boolean
  onClose: () => void
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORY_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  design:      { bg: 'var(--status-client-review-bg)', text: 'var(--status-client-review-text)', label: 'Design'      },
  development: { bg: 'var(--status-submitted-bg)',     text: 'var(--status-submitted-text)',     label: 'Development' },
  content:     { bg: 'var(--status-in-progress-bg)',   text: 'var(--status-in-progress-text)',   label: 'Content'     },
  seo:         { bg: 'var(--color-brand-50)',          text: 'var(--color-link)',                label: 'SEO'         },
  strategy:    { bg: 'var(--color-bg-tertiary)',       text: 'var(--color-text-muted)',          label: 'Strategy'    },
}

const PRIORITY_STYLES: Record<string, { bg: string; text: string }> = {
  standard: { bg: 'var(--color-bg-tertiary)',  text: 'var(--color-text-muted)'  },
  high:     { bg: 'var(--priority-high-bg)',   text: 'var(--priority-high-text)' },
  urgent:   { bg: 'var(--priority-urgent-bg)', text: 'var(--priority-urgent-text)' },
}

const ACCEPTED_FILES =
  '.txt,.md,.markdown,.csv,.json,.log,.pdf,text/plain,text/markdown,text/csv,application/json,application/pdf'

const INITIAL_MESSAGE: ChatMessage = {
  role: 'assistant',
  content: 'What needs doing? Describe it, or drop in a brief and I will read it.',
}

/** Sent as the turn's text when someone attaches a file and says nothing. The
 *  route rejects an empty message, and silence is an instruction anyway. */
const DOCUMENT_ONLY_INSTRUCTION = 'Draft the tasks this brief asks for.'

const WIZARD_CSS = `
.tahi-ai-typing{ display: inline-flex; align-items: center; gap: 0.1875rem; padding: 0.1875rem 0; }
.tahi-ai-typing i{
  width: 0.375rem;
  height: 0.375rem;
  border-radius: var(--radius-full);
  background: var(--color-text-subtle);
  animation: tahi-ai-typing 1.1s infinite ease-in-out;
}
.tahi-ai-typing i:nth-child(2){ animation-delay: 0.18s; }
.tahi-ai-typing i:nth-child(3){ animation-delay: 0.36s; }
@keyframes tahi-ai-typing{
  0%, 60%, 100%{ transform: none; opacity: 0.4; }
  30%{ transform: translateY(-0.25rem); opacity: 1; }
}
.tahi-ai-progress-fill{ transition: width var(--motion-medium, 300ms) var(--ease-out, ease); }
.tskw-field{
  width: 100%;
  box-sizing: border-box;
  padding: 0.4375rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-input);
  background: var(--color-bg);
  color: var(--color-text);
  font-family: inherit;
  font-size: 0.8125rem;
  outline: none;
  transition: border-color var(--motion-quick, 150ms) var(--ease-out, ease);
}
.tskw-field:hover{ border-color: var(--color-brand-light); }
.tskw-field:focus{ border-color: var(--focus-ring-color); box-shadow: var(--focus-ring); }
@media (prefers-reduced-motion: reduce){
  .tahi-ai-typing i{ animation: none; opacity: 0.55; }
  .tahi-ai-progress-fill{ transition: none; }
  .tskw-field{ transition: none; }
}
`

// ── Small helpers ─────────────────────────────────────────────────────────────

/** The repo's reference for a request, everywhere: #042, never TR-0042. */
function requestRefLabel(requestNumber: number | null): string {
  return requestNumber != null ? `#${String(requestNumber).padStart(3, '0')}` : 'Request'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** FileReader rather than File.arrayBuffer plus a manual encoder: readAsDataURL
 *  gives base64 straight back, and the prefix is a known fixed shape. */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('read failed'))
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const comma = result.indexOf(',')
      resolve(comma === -1 ? '' : result.slice(comma + 1))
    }
    reader.readAsDataURL(file)
  })
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function AiTaskWizardPanel({
  onTasksCreated,
  context = {},
  seed,
  mutateKeys,
  clients,
  people,
  requests,
  onDraftToForm,
  onWriteItMyself,
}: AiTaskWizardPanelProps) {
  const { mutate } = useSWRConfig()
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MESSAGE])
  const [input, setInput] = useState(seed ?? '')
  const [sending, setSending] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<TaskWizardDraft | null>(null)
  const [brief, setBrief] = useState<PickedDocument | null>(null)
  const [briefError, setBriefError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const clientList = useMemo(() => clients ?? [], [clients])
  const peopleListed = useMemo(() => people ?? [], [people])
  const requestList = useMemo(() => requests ?? [], [requests])

  /** What the resolvers map the model's names against. */
  const draftContext = useMemo<DraftContext>(() => ({
    clients: clientList,
    people: peopleListed,
    requests: requestList.map(r => ({ id: r.id, requestNumber: r.requestNumber })),
    orgId: context.orgId ?? null,
    requestId: context.requestId ?? null,
    level: context.level ?? null,
  }), [clientList, peopleListed, requestList, context.orgId, context.requestId, context.level])

  /** What the model is allowed to name. Names only: an id it invented would
   *  file a task against the wrong client without a word. */
  const wizardContext = useMemo(() => ({
    ...context,
    ...(clientList.length > 0 ? { clientNames: clientList.map(c => c.name) } : {}),
    ...(peopleListed.length > 0 ? { peopleNames: peopleListed.map(p => p.name) } : {}),
    ...(requestList.length > 0
      ? { requestRefs: requestList.map(r => `${requestRefLabel(r.requestNumber)} ${r.title}`) }
      : {}),
  }), [context, clientList, peopleListed, requestList])

  // The most recent batch of drafts. Older cards are transcript.
  const latestTasks = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.tasks && m.tasks.length > 0) return { tasks: m.tasks, index: i }
    }
    return null
  }, [messages])

  const answered = messages.filter(m => m.role === 'user').length
  const progress = aiWizardProgress(answered, !!latestTasks)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus(), 100)
    return () => window.clearTimeout(t)
  }, [])

  // ── Document handling ──────────────────────────────────────────────────────

  const acceptFile = useCallback(async (file: File) => {
    setBriefError(null)
    if (file.size > DOCUMENT_MAX_BYTES) {
      setBriefError('That file is larger than 5 MB. Send a smaller export, or paste the text.')
      return
    }
    // The same judgement the route makes, made here first, so an unreadable
    // file costs nothing and gets the same sentence either way.
    const classified = classifyDocument(file.name, file.type)
    if (classified.kind === 'unsupported') {
      setBriefError(classified.reason ?? 'That file cannot be read here.')
      return
    }
    try {
      const dataBase64 = await readFileAsBase64(file)
      if (!dataBase64) {
        setBriefError('That file could not be read. Try saving it again, or paste the text.')
        return
      }
      setBrief({
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        dataBase64,
      })
    } catch {
      setBriefError('That file could not be read. Try saving it again, or paste the text.')
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    const file = e.dataTransfer?.files?.[0]
    if (file) void acceptFile(file)
  }, [acceptFile])

  // ── Send ───────────────────────────────────────────────────────────────────

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim()
    if (sending || creating) return
    if (!trimmed && !brief) return

    // The chip on the bubble names the file, so the sentence does not have to.
    const spoken = trimmed || DOCUMENT_ONLY_INSTRUCTION
    const userMessage: ChatMessage = {
      role: 'user',
      content: spoken,
      ...(brief ? { attachment: brief.filename } : {}),
    }
    const updated = [...messages, userMessage]
    const sentBrief = brief
    setMessages(updated)
    setInput('')
    setBrief(null)
    setBriefError(null)
    setSending(true)

    try {
      const res = await fetch(apiPath('/api/admin/ai/task-wizard'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: updated.map(m => ({ role: m.role, content: m.content })),
          context: wizardContext,
          ...(sentBrief
            ? {
                document: {
                  filename: sentBrief.filename,
                  mimeType: sentBrief.mimeType,
                  dataBase64: sentBrief.dataBase64,
                },
              }
            : {}),
        }),
      })

      const data = await res.json().catch(() => ({})) as {
        reply?: string
        tasks?: TaskWizardDraft[]
        done?: boolean
        degraded?: boolean
        error?: string
        notice?: string
      }

      // The route now says out loud when the model was not reached, so the
      // panel repeats it instead of printing a generic apology, or worse,
      // rendering a keyword draft as if Claude wrote it.
      if (!res.ok) {
        // Hand the file back with the error. A busy minute should not cost
        // somebody the upload they just made.
        if (sentBrief) setBrief(sentBrief)
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            notice: true,
            content: data.error ?? 'Something went wrong drafting that. Could you try again?',
          },
        ])
        return
      }

      const reply = data.reply ?? 'Could you tell me a bit more about what you need?'
      const next: ChatMessage[] = [{
        role: 'assistant',
        content: data.degraded ? `${DEGRADED_PREFIX}\n\n${reply}` : reply,
        ...(data.degraded ? { notice: true } : {}),
        ...(data.tasks && data.tasks.length > 0 ? { tasks: data.tasks } : {}),
      }]
      if (data.notice) {
        next.push({ role: 'assistant', notice: true, content: data.notice })
      }
      setMessages(prev => [...prev, ...next])
    } catch {
      if (sentBrief) setBrief(sentBrief)
      setMessages(prev => [
        ...prev,
        { role: 'assistant', notice: true, content: 'Something went wrong drafting that. Could you try again?' },
      ])
    } finally {
      setSending(false)
    }
  }, [input, sending, creating, messages, brief, wizardContext])

  // ── Editing a draft ────────────────────────────────────────────────────────

  const startEdit = useCallback((task: TaskWizardDraft) => {
    setEditingTaskId(task.id)
    setEditForm({ ...task, checklist: [...task.checklist] })
  }, [])

  const saveEdit = useCallback(() => {
    if (!editForm || !latestTasks) return
    const updatedTasks = latestTasks.tasks.map(t => (t.id === editForm.id ? editForm : t))
    setMessages(prev => prev.map((m, i) => (i === latestTasks.index ? { ...m, tasks: updatedTasks } : m)))
    setEditingTaskId(null)
    setEditForm(null)
  }, [editForm, latestTasks])

  const cancelEdit = useCallback(() => {
    setEditingTaskId(null)
    setEditForm(null)
  }, [])

  // ── The two exits ──────────────────────────────────────────────────────────

  const handOverDraft = useCallback((draft: TaskWizardDraft) => {
    const fields = draftToTaskFields(draft, draftContext)
    if (!fields) {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', notice: true, content: 'That draft needs a title before the form can take it.' },
      ])
      return
    }
    onDraftToForm?.(fields)
  }, [draftContext, onDraftToForm])

  const handleCreateTasks = useCallback(async () => {
    if (!latestTasks || creating) return
    setCreating(true)
    try {
      const results: boolean[] = []
      for (const task of latestTasks.tasks) {
        const body = buildCreateTaskBody(task, draftContext)
        if (!body) {
          results.push(false)
          continue
        }
        const res = await fetch(apiPath('/api/admin/tasks'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        results.push(res.ok)
      }

      for (const key of mutateKeys ?? []) {
        await mutate(key)
      }

      const allOk = results.every(Boolean)
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          ...(allOk ? {} : { notice: true }),
          content: allOk
            ? `Done. ${latestTasks.tasks.length === 1 ? 'The task has' : `All ${latestTasks.tasks.length} tasks have`} been created.`
            : 'Some tasks could not be created. Try again, or fall back to the form.',
        },
      ])
      if (allOk) onTasksCreated?.()
    } catch {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', notice: true, content: 'Failed to create the tasks. Please try again.' },
      ])
    } finally {
      setCreating(false)
    }
  }, [latestTasks, creating, draftContext, mutateKeys, mutate, onTasksCreated])

  const canSend = (input.trim().length > 0 || !!brief) && !sending && !creating

  return (
    <>
      <style>{WIZARD_CSS}</style>

      {/* Progress line */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.75rem 1.25rem 0',
        flexShrink: 0,
      }}>
        <span style={{
          fontSize: '0.625rem',
          fontWeight: 700,
          letterSpacing: '0.07em',
          textTransform: 'uppercase',
          color: 'var(--color-text-subtle)',
          whiteSpace: 'nowrap',
        }}>
          AI assist
        </span>
        <span
          role="progressbar"
          aria-label="Interview progress"
          aria-valuenow={progress.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          style={{
            flex: 1,
            height: '0.25rem',
            minWidth: '2rem',
            borderRadius: 'var(--radius-full)',
            background: 'var(--color-bg-tertiary)',
            overflow: 'hidden',
          }}
        >
          <span
            className="tahi-ai-progress-fill"
            style={{
              display: 'block',
              height: '100%',
              width: `${progress.percent}%`,
              borderRadius: 'var(--radius-full)',
              background: 'var(--color-brand)',
            }}
          />
        </span>
        <span style={{
          fontSize: '0.625rem',
          fontWeight: 700,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          color: 'var(--color-text-subtle)',
          whiteSpace: 'nowrap',
        }}>
          {progress.label}
        </span>
        {onWriteItMyself && (
          <button
            type="button"
            onClick={onWriteItMyself}
            className="tahi-focus-ring min-h-11 md:min-h-8"
            style={{
              padding: '0 0.625rem',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-button)',
              background: 'var(--color-bg)',
              color: 'var(--color-text-muted)',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'border-color 150ms ease, color 150ms ease',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'var(--color-brand)'
              e.currentTarget.style.color = 'var(--color-text)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--color-border)'
              e.currentTarget.style.color = 'var(--color-text-muted)'
            }}
          >
            I will write it myself
          </button>
        )}
      </div>

      {/* Transcript, and the drop target that covers it. The overlay is a
          sibling of the scroll region rather than a child of it, so it stays
          put over a transcript that has been scrolled. */}
      <div
        onDragEnter={e => {
          if (!e.dataTransfer?.types?.includes('Files')) return
          dragDepth.current += 1
          setDragging(true)
        }}
        onDragOver={e => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault() }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (dragDepth.current === 0) setDragging(false)
        }}
        onDrop={handleDrop}
        style={{
          position: 'relative',
          flex: 1,
          display: 'flex',
          minHeight: '12rem',
        }}
      >
        {dragging && (
          <div
            style={{
              position: 'absolute',
              inset: '0.5rem',
              zIndex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              padding: '1rem',
              border: '1px dashed var(--color-brand)',
              borderRadius: 'var(--radius-lg)',
              background: 'color-mix(in srgb, var(--color-brand-100) 45%, var(--color-bg))',
              color: 'var(--color-link)',
              fontSize: '0.8125rem',
              fontWeight: 600,
            }}
          >
            Drop a brief here. Text, Markdown, CSV or PDF.
          </div>
        )}

        <div style={{
          flex: 1,
          minWidth: 0,
          overflowY: 'auto',
          padding: 'var(--space-4) var(--space-5)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.875rem',
        }}>
          {messages.map((msg, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
              <div
                role={msg.notice ? 'status' : undefined}
                data-private
                style={{
                  alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  display: msg.notice ? 'flex' : 'block',
                  gap: '0.5rem',
                  maxWidth: '85%',
                  padding: '0.625rem 0.875rem',
                  borderRadius: 'var(--radius-lg)',
                  border: msg.notice ? '1px solid var(--badge-warning-border)' : 'none',
                  background: msg.notice
                    ? 'var(--badge-warning-bg)'
                    : msg.role === 'user' ? 'var(--color-brand)' : 'var(--color-bg-secondary)',
                  color: msg.notice
                    ? 'var(--badge-warning-text)'
                    : msg.role === 'user' ? 'var(--color-text-on-dark)' : 'var(--color-text)',
                  fontSize: '0.875rem',
                  lineHeight: 1.55,
                  whiteSpace: msg.role === 'user' || msg.notice ? 'pre-wrap' : 'normal',
                  wordBreak: 'break-word',
                }}
              >
                {msg.notice && (
                  <AlertTriangle size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: '0.1875rem' }} />
                )}
                <span>
                  {msg.attachment && (
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                      marginRight: '0.375rem',
                      fontWeight: 600,
                    }}>
                      <FileText size={12} aria-hidden="true" />
                      {msg.attachment}
                    </span>
                  )}
                  {msg.role === 'user' || msg.notice ? msg.content : renderMessageContent(msg.content)}
                </span>
              </div>

              {msg.tasks && msg.tasks.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.125rem' }}>
                  {msg.tasks.map(task => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      clients={clientList}
                      people={peopleListed}
                      editing={editingTaskId === task.id}
                      editForm={editingTaskId === task.id ? editForm : null}
                      onStartEdit={() => startEdit(task)}
                      onSaveEdit={saveEdit}
                      onCancelEdit={cancelEdit}
                      onEditFormChange={setEditForm}
                      // One draft per card, so the person hands back the one they
                      // are reading rather than whichever came first. Only the
                      // latest batch is offered; older cards are transcript.
                      onUse={
                        onDraftToForm && msg.tasks!.length > 1 && latestTasks?.tasks === msg.tasks
                          ? () => handOverDraft(task)
                          : undefined
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          ))}

          {sending && (
            <div style={{
              alignSelf: 'flex-start',
              padding: '0.625rem 0.875rem',
              borderRadius: 'var(--radius-lg)',
              background: 'var(--color-bg-secondary)',
            }}>
              <span className="tahi-ai-typing" aria-hidden="true"><i /><i /><i /></span>
            </div>
          )}

          {/* Mounted in every state on purpose: a live region only announces a
              change to text inside a region that already existed, so creating
              one alongside its own content says nothing at all. */}
          <div aria-live="polite" className="sr-only">
            {sending ? 'Drafting a reply' : ''}
          </div>
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Footer: actions, the file chip, the composer */}
      <div style={{
        borderTop: '1px solid var(--color-border-subtle)',
        padding: '0.75rem 1.25rem 1rem',
        paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.625rem',
        flexShrink: 0,
        background: 'var(--color-bg)',
      }}>
        {latestTasks && latestTasks.tasks.length > 0 && (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {/* Hand-back is the primary action wherever a form is waiting: the
                person reads the draft in the field they will submit from. */}
            {onDraftToForm && (
              <button
                type="button"
                onClick={() => handOverDraft(latestTasks.tasks[0])}
                disabled={creating}
                className="tahi-focus-ring"
                style={{
                  flex: 1,
                  minWidth: '10rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.375rem',
                  minHeight: '2.75rem',
                  padding: '0.625rem 0.875rem',
                  background: creating ? 'var(--color-brand-200)' : 'var(--color-brand)',
                  color: 'var(--color-text-on-dark)',
                  border: 'none',
                  borderRadius: 'var(--radius-button)',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  cursor: creating ? 'not-allowed' : 'pointer',
                }}
              >
                <Sparkles size={14} aria-hidden="true" />
                {latestTasks.tasks.length > 1 ? 'Use the first draft' : 'Use this draft'}
              </button>
            )}
            {/* Filing belongs to whoever owns the list. Inside a dialog that
                is the dialog: it has the Create button, it tells the page, and
                the page reloads. A second Create here would write a task the
                list behind could not see, next to a button that would happily
                write it again. So the panel only files where its own button is
                the way out. */}
            {!onDraftToForm && (
              <button
                type="button"
                onClick={() => void handleCreateTasks()}
                disabled={creating}
                className="tahi-focus-ring"
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.375rem',
                  minHeight: '2.75rem',
                  padding: '0.625rem 0.875rem',
                  background: creating ? 'var(--color-brand-200)' : 'var(--color-brand)',
                  color: 'var(--color-text-on-dark)',
                  border: 'none',
                  borderRadius: 'var(--radius-button)',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  cursor: creating ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {creating && <Loader2 size={14} aria-hidden="true" className="animate-spin" />}
                {creating
                  ? 'Creating...'
                  : latestTasks.tasks.length === 1 ? 'Create task' : `Create ${latestTasks.tasks.length} tasks`}
              </button>
            )}
          </div>
        )}

        {briefError && (
          <p role="alert" style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.375rem',
            margin: 0,
            padding: '0.5rem 0.625rem',
            border: '1px solid var(--badge-warning-border)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--badge-warning-bg)',
            color: 'var(--badge-warning-text)',
            fontSize: '0.75rem',
            lineHeight: 1.45,
          }}>
            <AlertTriangle size={13} aria-hidden="true" style={{ flexShrink: 0, marginTop: '0.125rem' }} />
            {briefError}
          </p>
        )}

        {brief && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.375rem 0.5rem 0.375rem 0.625rem',
            border: '1px solid var(--color-brand-100)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-brand-50)',
          }}>
            <FileText size={14} aria-hidden="true" style={{ color: 'var(--color-brand)', flexShrink: 0 }} />
            <span data-private className="truncate" style={{
              flex: 1,
              minWidth: 0,
              fontSize: '0.8125rem',
              fontWeight: 600,
              color: 'var(--color-link)',
            }}>
              {brief.filename}
            </span>
            <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
              {formatBytes(brief.sizeBytes)}
            </span>
            <button
              type="button"
              onClick={() => { setBrief(null); setBriefError(null) }}
              aria-label={`Remove ${brief.filename}`}
              className="tahi-focus-ring inline-flex items-center justify-center flex-shrink-0 h-11 w-11 md:h-8 md:w-8"
              style={{
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                background: 'transparent',
                color: 'var(--color-text-muted)',
                cursor: 'pointer',
              }}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        )}

        <div style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: '0.375rem',
          padding: '0.5rem',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--color-bg)',
        }}>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_FILES}
            // Not sr-only: an unlabelled file input in the tab order is a
            // control nobody can name. The paperclip is the labelled way in.
            style={{ display: 'none' }}
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) void acceptFile(file)
              // Same file twice in a row still fires a change event.
              e.target.value = ''
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach a brief"
            title="Attach a brief"
            disabled={sending || creating}
            className="tahi-focus-ring inline-flex items-center justify-center flex-shrink-0 h-11 w-11 md:h-9 md:w-9"
            style={{
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-button)',
              background: 'var(--color-bg)',
              color: sending || creating ? 'var(--color-text-subtle)' : 'var(--color-text-muted)',
              cursor: sending || creating ? 'not-allowed' : 'pointer',
            }}
          >
            <Paperclip size={15} aria-hidden="true" />
          </button>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void sendMessage()
              }
            }}
            aria-label="Your answer"
            placeholder={brief
              ? 'Anything to add? For example: only the design work.'
              : 'Describe what you need...'}
            rows={1}
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: '1.5rem',
              maxHeight: '8rem',
              resize: 'none',
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: '0.875rem',
              color: 'var(--color-text)',
              fontFamily: 'inherit',
              padding: '0.25rem',
            }}
            disabled={sending || creating}
          />
          <button
            type="button"
            onClick={() => void sendMessage()}
            disabled={!canSend}
            aria-label={brief ? 'Draft tasks from this' : 'Send message'}
            className="tahi-focus-ring"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.375rem',
              minHeight: '2.75rem',
              minWidth: '2.75rem',
              padding: brief ? '0 0.75rem' : 0,
              background: canSend ? 'var(--color-brand)' : 'var(--color-bg-tertiary)',
              color: canSend ? 'var(--color-text-on-dark)' : 'var(--color-text-subtle)',
              border: 'none',
              borderRadius: 'var(--radius-button)',
              fontSize: '0.8125rem',
              fontWeight: 600,
              cursor: canSend ? 'pointer' : 'not-allowed',
              flexShrink: 0,
              transition: 'background-color 150ms ease',
            }}
          >
            {sending
              ? <Loader2 size={14} aria-hidden="true" className="animate-spin" />
              : <Send size={13} aria-hidden="true" />}
            {brief && <span>Draft tasks from this</span>}
          </button>
        </div>
        <p style={{ margin: 0, fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>
          Enter sends, Shift and Enter makes a new line. Nothing is created until you press a button.
        </p>
      </div>
    </>
  )
}

// ── Standalone drawer ─────────────────────────────────────────────────────────

export function AiTaskWizard({ open, onClose, ...panel }: AiTaskWizardProps) {
  // A fresh conversation each time the drawer opens. The key remounts the
  // panel, and it leaves the transcript on screen while the drawer slides out.
  const [session, setSession] = useState(0)
  useEffect(() => {
    if (open) setSession(s => s + 1)
  }, [open])

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      icon={<Sparkles size={15} />}
      title="Draft tasks with AI"
      subtitle="Describe the work, or drop in a brief."
      maxWidth="34rem"
    >
      <AiTaskWizardPanel key={session} {...panel} />
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
      className="tahi-focus-ring"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.375rem',
        padding: '0.5rem 0.875rem',
        borderRadius: 'var(--radius-button)',
        border: '1px solid var(--color-border)',
        background: hovered ? 'var(--color-bg-tertiary)' : 'var(--color-bg)',
        color: 'var(--color-link)',
        fontSize: '0.875rem',
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'background 150ms ease, border-color 150ms ease',
        minHeight: '2.75rem',
      }}
      aria-label="Draft tasks with AI"
    >
      <Sparkles size={15} aria-hidden="true" />
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
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    if (match[2]) {
      parts.push(<strong key={match.index}>{match[2]}</strong>)
    } else if (match[3]) {
      parts.push(<em key={match.index}>{match[3]}</em>)
    }
    lastIndex = match.index + match[0].length
  }

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
        </ol>,
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
        </li>,
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
          </span>,
        )
      }
    }
  }

  flushList()

  return <>{elements}</>
}

// ── Draft card ────────────────────────────────────────────────────────────────

interface TaskCardProps {
  task: TaskWizardDraft
  clients: readonly NamedOption[]
  people: readonly NamedOption[]
  editing: boolean
  editForm: TaskWizardDraft | null
  onStartEdit: () => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onEditFormChange: (form: TaskWizardDraft | null) => void
  onUse?: () => void
}

const labelStyle: React.CSSProperties = {
  fontSize: '0.6875rem',
  fontWeight: 700,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: 'var(--color-text-subtle)',
  display: 'block',
  marginBottom: '0.25rem',
}

function TaskCard({
  task,
  clients,
  people,
  editing,
  editForm,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onEditFormChange,
  onUse,
}: TaskCardProps) {
  const [checklistDraft, setChecklistDraft] = useState('')

  if (editing && editForm) {
    const addChecklistItem = () => {
      const next = checklistDraft.trim()
      if (!next) return
      onEditFormChange({ ...editForm, checklist: [...editForm.checklist, next] })
      setChecklistDraft('')
    }

    return (
      <div style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-brand)',
        borderRadius: 'var(--radius-md)',
        padding: '0.875rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.625rem',
      }}>
        <div>
          <label style={labelStyle} htmlFor={`draft-title-${task.id}`}>Title</label>
          <input
            id={`draft-title-${task.id}`}
            type="text"
            className="tskw-field"
            value={editForm.title}
            onChange={e => onEditFormChange({ ...editForm, title: e.target.value })}
          />
        </div>

        <div>
          <label style={labelStyle} htmlFor={`draft-note-${task.id}`}>Note</label>
          <textarea
            id={`draft-note-${task.id}`}
            className="tskw-field"
            rows={3}
            style={{ resize: 'vertical' }}
            value={editForm.description}
            onChange={e => onEditFormChange({ ...editForm, description: e.target.value })}
          />
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 8rem', minWidth: 0 }}>
            <label style={labelStyle} htmlFor={`draft-priority-${task.id}`}>Priority</label>
            <select
              id={`draft-priority-${task.id}`}
              className="tskw-field"
              style={{ cursor: 'pointer' }}
              value={editForm.priority}
              onChange={e => onEditFormChange({ ...editForm, priority: e.target.value })}
            >
              {TASK_PRIORITIES.map(p => (
                <option key={p} value={p}>{taskPriorityLabel(p)}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: '1 1 6rem', minWidth: 0 }}>
            <label style={labelStyle} htmlFor={`draft-estimate-${task.id}`}>Estimate</label>
            <input
              id={`draft-estimate-${task.id}`}
              type="number"
              inputMode="decimal"
              min={0}
              step={0.25}
              className="tskw-field"
              placeholder="Hours"
              value={editForm.estimatedHours ?? ''}
              onChange={e => {
                const parsed = Number.parseFloat(e.target.value)
                onEditFormChange({
                  ...editForm,
                  estimatedHours: Number.isFinite(parsed) && parsed > 0 ? parsed : null,
                })
              }}
            />
          </div>
          <div style={{ flex: '1 1 9rem', minWidth: 0 }}>
            <label style={labelStyle} htmlFor={`draft-due-${task.id}`}>Due</label>
            <input
              id={`draft-due-${task.id}`}
              type="date"
              className="tskw-field"
              value={editForm.dueDate ?? ''}
              onChange={e => onEditFormChange({ ...editForm, dueDate: e.target.value || null })}
            />
          </div>
        </div>

        {(clients.length > 0 || people.length > 0) && (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {clients.length > 0 && (
              <div style={{ flex: '1 1 10rem', minWidth: 0 }}>
                <label style={labelStyle} htmlFor={`draft-client-${task.id}`}>Client</label>
                <select
                  id={`draft-client-${task.id}`}
                  className="tskw-field"
                  style={{ cursor: 'pointer' }}
                  value={editForm.clientName ?? ''}
                  onChange={e => onEditFormChange({ ...editForm, clientName: e.target.value || null })}
                >
                  <option value="">No client</option>
                  {clients.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              </div>
            )}
            {people.length > 0 && (
              <div style={{ flex: '1 1 10rem', minWidth: 0 }}>
                <label style={labelStyle} htmlFor={`draft-assignee-${task.id}`}>Assignee</label>
                <select
                  id={`draft-assignee-${task.id}`}
                  className="tskw-field"
                  style={{ cursor: 'pointer' }}
                  value={editForm.assigneeName ?? ''}
                  onChange={e => onEditFormChange({ ...editForm, assigneeName: e.target.value || null })}
                >
                  <option value="">Unassigned</option>
                  {people.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                </select>
              </div>
            )}
          </div>
        )}

        <div>
          <label style={labelStyle} htmlFor={`draft-category-${task.id}`}>Category</label>
          <input
            id={`draft-category-${task.id}`}
            type="text"
            className="tskw-field"
            placeholder="Design, development, content..."
            value={editForm.category ?? ''}
            onChange={e => onEditFormChange({ ...editForm, category: e.target.value || null })}
          />
        </div>

        <div>
          <span style={labelStyle}>Checklist</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            {editForm.checklist.map((item, index) => (
              <div key={`${index}-${item}`} className="flex items-center" style={{ gap: '0.375rem' }}>
                <span className="truncate" style={{
                  flex: 1,
                  minWidth: 0,
                  padding: '0.375rem 0.5rem',
                  border: '1px solid var(--color-border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--color-bg-secondary)',
                  fontSize: '0.8125rem',
                  color: 'var(--color-text)',
                }}>
                  {item}
                </span>
                <button
                  type="button"
                  aria-label={`Remove checklist item ${item}`}
                  className="tahi-focus-ring inline-flex items-center justify-center flex-shrink-0 h-11 w-11 md:h-8 md:w-8"
                  onClick={() => onEditFormChange({
                    ...editForm,
                    checklist: editForm.checklist.filter((_, i) => i !== index),
                  })}
                  style={{
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    background: 'transparent',
                    color: 'var(--color-text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  <X size={13} aria-hidden="true" />
                </button>
              </div>
            ))}
            <div className="flex items-center" style={{ gap: '0.375rem' }}>
              <input
                type="text"
                className="tskw-field"
                aria-label="Add a checklist item"
                placeholder="Name a checklist item, press Enter"
                value={checklistDraft}
                onChange={e => setChecklistDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); addChecklistItem() }
                }}
              />
              <button
                type="button"
                aria-label="Add checklist item"
                className="tahi-focus-ring inline-flex items-center justify-center flex-shrink-0 h-11 w-11 md:h-8 md:w-8"
                onClick={addChecklistItem}
                style={{
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--color-bg)',
                  color: 'var(--color-text-muted)',
                  cursor: 'pointer',
                }}
              >
                <Check size={14} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onCancelEdit}
            className="tahi-focus-ring"
            style={{
              minHeight: '2.75rem',
              padding: '0 0.75rem',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-button)',
              background: 'var(--color-bg)',
              color: 'var(--color-text)',
              fontSize: '0.8125rem',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSaveEdit}
            className="tahi-focus-ring"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
              minHeight: '2.75rem',
              padding: '0 0.75rem',
              border: 'none',
              borderRadius: 'var(--radius-button)',
              background: 'var(--color-brand)',
              color: 'var(--color-text-on-dark)',
              fontSize: '0.8125rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Check size={14} aria-hidden="true" />
            Save
          </button>
        </div>
      </div>
    )
  }

  const cat = task.category ? CATEGORY_STYLES[task.category] : undefined
  const pri = PRIORITY_STYLES[task.priority] ?? PRIORITY_STYLES.standard

  return (
    <div style={{
      padding: '0.75rem 0.875rem',
      background: 'var(--color-bg)',
      border: '1px solid var(--color-border-subtle)',
      borderRadius: 'var(--radius-md)',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.5rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
        <h4 data-private style={{
          flex: 1,
          margin: 0,
          fontSize: '0.9375rem',
          fontWeight: 600,
          lineHeight: 1.4,
          color: 'var(--color-text)',
        }}>
          {task.title}
        </h4>
        <button
          type="button"
          onClick={onStartEdit}
          aria-label={`Edit ${task.title}`}
          title="Edit this draft"
          className="tahi-focus-ring inline-flex items-center justify-center flex-shrink-0 h-11 w-11 md:h-8 md:w-8"
          style={{
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            background: 'transparent',
            color: 'var(--color-text-subtle)',
            cursor: 'pointer',
          }}
        >
          <Pencil size={14} aria-hidden="true" />
        </button>
      </div>

      {task.description && (
        <p data-private style={{
          margin: 0,
          fontSize: '0.8125rem',
          lineHeight: 1.5,
          color: 'var(--color-text-muted)',
          whiteSpace: 'pre-wrap',
        }}>
          {task.description}
        </p>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
        {cat && <Chip bg={cat.bg} text={cat.text}>{cat.label}</Chip>}
        {!cat && task.category && (
          <Chip bg="var(--color-bg-tertiary)" text="var(--color-text-muted)">{task.category}</Chip>
        )}
        <Chip bg={pri.bg} text={pri.text}>{taskPriorityLabel(task.priority)} priority</Chip>
        {task.estimatedHours != null && (
          <Chip bg="var(--color-bg-tertiary)" text="var(--color-text-muted)">{task.estimatedHours}h</Chip>
        )}
        {task.dueDate && (
          <Chip bg="var(--color-bg-tertiary)" text="var(--color-text-muted)">Due {task.dueDate}</Chip>
        )}
        {task.clientName && (
          <Chip bg="var(--color-brand-50)" text="var(--color-link)">{task.clientName}</Chip>
        )}
        {task.assigneeName && (
          <Chip bg="var(--color-bg-tertiary)" text="var(--color-text-muted)">{task.assigneeName}</Chip>
        )}
        {task.requestRef && (
          <Chip bg="var(--color-bg-tertiary)" text="var(--color-text-muted)">{task.requestRef}</Chip>
        )}
      </div>

      {task.checklist.length > 0 && (
        <ul style={{
          margin: 0,
          paddingLeft: '1.125rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.125rem',
          fontSize: '0.8125rem',
          color: 'var(--color-text-muted)',
        }}>
          {task.checklist.map((item, i) => <li key={`${i}-${item}`}>{item}</li>)}
        </ul>
      )}

      {onUse && (
        <button
          type="button"
          onClick={onUse}
          className="tahi-focus-ring min-h-11 md:min-h-8"
          style={{
            alignSelf: 'flex-start',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.375rem',
            padding: '0 0.75rem',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-button)',
            background: 'var(--color-bg)',
            color: 'var(--color-link)',
            fontSize: '0.75rem',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'border-color 150ms ease, background-color 150ms ease',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = 'var(--color-brand)'
            e.currentTarget.style.background = 'var(--color-brand-50)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = 'var(--color-border)'
            e.currentTarget.style.background = 'var(--color-bg)'
          }}
        >
          <Sparkles size={13} aria-hidden="true" />
          Use
        </button>
      )}
    </div>
  )
}

function Chip({ children, bg, text }: { children: ReactNode; bg: string; text: string }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '0.125rem 0.5rem',
      borderRadius: 'var(--radius-full)',
      fontSize: '0.6875rem',
      fontWeight: 500,
      background: bg,
      color: text,
    }}>
      {children}
    </span>
  )
}
