'use client'

/**
 * <MessagesContent>. The /messages page, for both audiences.
 *
 * ONE component, two audiences, because it is one surface: the studio inbox
 * and the client's line to the studio have the same anatomy (a filtered list
 * of rooms on the left, a thread on the right, one composer) and differ in
 * exactly three ways, all of them props:
 *
 *   - the endpoint prefix (/api/admin/messages vs /api/portal/messages);
 *   - the client switcher and the client-name pill, studio only;
 *   - the internal-note tab, which the SERVER decides per thread
 *     (`thread.canInternal`) rather than this component inferring it.
 *
 * Nothing about who may see what is decided here. The page renders what the
 * route returned, and the route is the gate: a client's payload cannot contain
 * an internal note, another brand's request or a deleted message, whatever
 * this file does with it.
 *
 * 375 first: the list IS the page and selecting a room replaces it, with a
 * Back button in the thread head. At 64rem the two stand side by side.
 */

import * as React from 'react'
import { Eye, Users } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { useToast } from '@/components/tahi/toast'
import {
  filterInboxThreads,
  totalUnread,
  type InboxLens,
  type InboxThread,
} from '@/lib/messages-inbox'
import { ConversationRail } from './conversation-rail'
import { ThreadPane } from './thread-pane'
import type { InboxPayload, StagedAttachment, ThreadMessageView, ThreadPayload } from './types'

const NARROW_QUERY = '(max-width: 63.9375rem)'

export interface MessagesContentProps {
  audience: 'client' | 'studio'
  /** True when a Tahi admin is previewing a client's portal. Reads only. */
  readOnly: boolean
}

export function MessagesContent({ audience, readOnly }: MessagesContentProps) {
  const isClient = audience === 'client'
  const base = isClient ? '/api/portal/messages' : '/api/admin/messages'
  const { showToast } = useToast()

  const [listState, setListState] = React.useState<'loading' | 'error' | 'ready'>('loading')
  const [inbox, setInbox] = React.useState<InboxPayload | null>(null)
  const [lens, setLens] = React.useState<InboxLens>('all')
  const [query, setQuery] = React.useState('')
  const [orgFilter, setOrgFilter] = React.useState<string>('')

  const [selected, setSelected] = React.useState<InboxThread | null>(null)
  const [threadState, setThreadState] = React.useState<'idle' | 'loading' | 'error' | 'ready'>('idle')
  const [thread, setThread] = React.useState<ThreadPayload | null>(null)
  /** The cursor as it stood when the room was opened, so the New line survives the read. */
  const [seenCursor, setSeenCursor] = React.useState<string | null>(null)

  const [attachments, setAttachments] = React.useState<StagedAttachment[]>([])
  const [narrow, setNarrow] = React.useState(false)

  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(NARROW_QUERY)
    const sync = () => setNarrow(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  // ── the list ───────────────────────────────────────────────────────────────

  const loadInbox = React.useCallback(async () => {
    setListState(s => (s === 'ready' ? s : 'loading'))
    try {
      const url = orgFilter ? `${base}?orgId=${encodeURIComponent(orgFilter)}` : base
      const res = await fetch(apiPath(url))
      if (!res.ok) throw new Error(String(res.status))
      const json = (await res.json()) as InboxPayload
      setInbox(json)
      setListState('ready')
    } catch {
      setInbox(null)
      setListState('error')
    }
  }, [base, orgFilter])

  React.useEffect(() => { void loadInbox() }, [loadInbox])

  const threads = React.useMemo(() => inbox?.threads ?? [], [inbox])
  const visible = React.useMemo(
    () => filterInboxThreads(threads, { lens, query }),
    [threads, lens, query],
  )
  const unread = totalUnread(threads)

  // Desktop opens the first room by itself; a phone does not, because there
  // the list is the page and taking it over unasked is a page nobody chose.
  React.useEffect(() => {
    if (narrow || selected || listState !== 'ready') return
    const first = visible[0]
    if (first) setSelected(first)
  }, [narrow, selected, listState, visible])

  // ── one thread ─────────────────────────────────────────────────────────────

  const threadPath = React.useCallback(
    (t: InboxThread, suffix = '') => {
      // A client's channel is addressed as `channel/new` before it has a row:
      // the route resolves it from their authenticated org either way.
      const id = t.source === 'channel' && !t.id ? 'new' : t.id
      const qs = !isClient && orgFilter ? `?orgId=${encodeURIComponent(orgFilter)}` : ''
      return `${base}/${t.source}/${encodeURIComponent(id)}${suffix}${qs}`
    },
    [base, isClient, orgFilter],
  )

  const loadThread = React.useCallback(async (t: InboxThread) => {
    setThreadState('loading')
    try {
      const res = await fetch(apiPath(threadPath(t)))
      if (!res.ok) throw new Error(String(res.status))
      const json = (await res.json()) as ThreadPayload
      setThread(json)
      setThreadState('ready')
      return json
    } catch {
      setThread(null)
      setThreadState('error')
      return null
    }
  }, [threadPath])

  const openThread = React.useCallback(async (t: InboxThread) => {
    setSelected(t)
    setAttachments([])
    const json = await loadThread(t)
    if (!json) return
    // Capture the cursor BEFORE moving it, so the New line is drawn from what
    // the reader had actually seen rather than from the moment they looked.
    setSeenCursor(json.lastReadAt)
    if (t.unreadCount === 0 || readOnly) return
    try {
      await fetch(apiPath(threadPath(t, '/read')), { method: 'POST' })
      setInbox(prev => prev
        ? { ...prev, threads: prev.threads.map(x => (x.key === t.key ? { ...x, unreadCount: 0 } : x)) }
        : prev)
    } catch {
      // The badge stays lit. That is the honest state: the cursor did not move.
    }
  }, [loadThread, threadPath, readOnly])

  // ── attachments, through the existing R2 flow ──────────────────────────────

  /**
   * Who OWNS the upload. A client never chooses (lib/upload-access.ts ignores
   * any org they name and resolves their own). The STUDIO has to say it out
   * loud on an org channel: with neither a requestId nor an orgId, an admin
   * upload is resolved as Tahi-internal and lands under the Tahi org, and
   * `attachFilesToMessage` scopes the stamp to the thread's org, so the file
   * would silently never join the message. Naming the org also puts the
   * upload back through `requireAccessToOrg`, which is the right gate for it.
   */
  const uploadOrgId = React.useCallback(
    () => (isClient ? undefined : selected?.orgId),
    [isClient, selected],
  )

  const pickFiles = React.useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return
    const picked = Array.from(files)
    const seeds: StagedAttachment[] = picked.map(f => ({
      key: `${Date.now()}-${f.name}-${Math.random().toString(36).slice(2, 8)}`,
      filename: f.name,
      sizeBytes: f.size,
      fileId: null,
      busy: 'Uploading',
      error: null,
    }))
    setAttachments(prev => [...prev, ...seeds])

    void (async () => {
      for (let i = 0; i < picked.length; i += 1) {
        const file = picked[i]
        const seed = seeds[i]
        try {
          const requestId = selected?.source === 'request' ? selected.id : undefined
          const presignRes = await fetch(apiPath('/api/uploads/presign'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: file.name, mimeType: file.type, requestId, orgId: uploadOrgId() }),
          })
          if (!presignRes.ok) throw new Error('presign')
          const presign = (await presignRes.json()) as { uploadUrl: string; storageKey: string; fileId: string }

          const put = await fetch(presign.uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': file.type || 'application/octet-stream' },
            body: file,
          })
          if (!put.ok) throw new Error('upload')

          const confirm = await fetch(apiPath('/api/uploads/confirm'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileId: presign.fileId,
              storageKey: presign.storageKey,
              filename: file.name,
              mimeType: file.type,
              sizeBytes: file.size,
              requestId,
              orgId: uploadOrgId(),
            }),
          })
          if (!confirm.ok) throw new Error('confirm')

          setAttachments(prev => prev.map(a =>
            a.key === seed.key ? { ...a, fileId: presign.fileId, busy: null, error: null } : a))
        } catch {
          setAttachments(prev => prev.map(a =>
            a.key === seed.key ? { ...a, busy: null, error: 'Did not upload' } : a))
        }
      }
    })()
  }, [selected, uploadOrgId])

  const removeAttachment = React.useCallback((key: string) => {
    setAttachments(prev => prev.filter(a => a.key !== key))
  }, [])

  // ── voice notes ────────────────────────────────────────────────────────────
  //
  // Recorded in the browser, uploaded through the SAME presign / proxy /
  // confirm flow every other attachment uses, then handed to the send as a
  // storage key. The route writes the voiceNotes row; nothing here writes to
  // the database.

  const [recording, setRecording] = React.useState(false)
  const recorder = React.useRef<MediaRecorder | null>(null)
  const chunks = React.useRef<Blob[]>([])

  const sendRef = React.useRef<((input: { body: string; isInternal: boolean; attachments: StagedAttachment[]; voice?: { storageKey: string; durationSeconds: number; mimeType: string } }) => Promise<boolean>) | null>(null)

  const uploadVoice = React.useCallback(async (blob: Blob, seconds: number, mimeType: string) => {
    try {
      const filename = `voice-note-${Date.now()}.webm`
      const requestId = selected?.source === 'request' ? selected.id : undefined
      const presignRes = await fetch(apiPath('/api/uploads/presign'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, mimeType, requestId, orgId: uploadOrgId() }),
      })
      if (!presignRes.ok) throw new Error('presign')
      const presign = (await presignRes.json()) as { uploadUrl: string; storageKey: string; fileId: string }
      const put = await fetch(presign.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': mimeType },
        body: blob,
      })
      if (!put.ok) throw new Error('upload')
      const ok = await sendRef.current?.({
        body: '',
        isInternal: false,
        attachments: [],
        voice: { storageKey: presign.storageKey, durationSeconds: seconds, mimeType },
      })
      if (ok) showToast('Voice note sent', 'success')
    } catch {
      showToast('That voice note did not send', 'error')
    }
  }, [selected, showToast, uploadOrgId])

  const toggleVoice = React.useCallback(async () => {
    if (recording) {
      recorder.current?.stop()
      setRecording(false)
      return
    }
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      showToast('This browser cannot record audio', 'error')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      chunks.current = []
      const startedAt = Date.now()
      rec.ondataavailable = e => { if (e.data.size > 0) chunks.current.push(e.data) }
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' })
        const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000))
        void uploadVoice(blob, seconds, rec.mimeType || 'audio/webm')
      }
      rec.start()
      recorder.current = rec
      setRecording(true)
    } catch {
      showToast('We could not reach your microphone', 'error')
    }
  }, [recording, showToast, uploadVoice])

  // ── sending ────────────────────────────────────────────────────────────────

  const send = React.useCallback(async (input: {
    body: string
    isInternal: boolean
    attachments: StagedAttachment[]
    voice?: { storageKey: string; durationSeconds: number; mimeType: string }
  }): Promise<boolean> => {
    const t = selected
    if (!t) return false
    try {
      const res = await fetch(apiPath(threadPath(t)), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: input.body,
          isInternal: input.isInternal,
          attachmentFileIds: input.attachments.map(a => a.fileId).filter(Boolean),
          voiceNote: input.voice,
        }),
      })
      if (!res.ok) {
        showToast(res.status === 403 ? 'You cannot post in this conversation' : 'That did not send', 'error')
        return false
      }
      setAttachments([])
      // Re-read rather than patching two lists by hand: the server owns the
      // ordering, the preview and the unread arithmetic.
      const fresh = await loadThread(t)
      if (fresh) setSeenCursor(fresh.lastReadAt)
      void loadInbox()
      return true
    } catch {
      showToast('That did not send. Check your connection and try again.', 'error')
      return false
    }
  }, [selected, threadPath, showToast, loadThread, loadInbox])

  sendRef.current = send

  const retryMessage = React.useCallback((m: ThreadMessageView) => {
    if (!selected) return
    void send({ body: m.body, isInternal: m.isInternal, attachments: [] })
  }, [selected, send])

  // ── frame ──────────────────────────────────────────────────────────────────

  const clientName = isClient ? 'Tahi Studio' : (thread?.thread.orgName ?? inbox?.orgName ?? null)
  const showThread = !narrow || !!selected

  return (
    <div className="pfm pfm-pad">
      <header className="pfm-head">
        <div className="pfm-head-copy">
          <h1 className="pfm-h1">Messages</h1>
          <p className="pfm-sub">
            {isClient
              ? 'One line to the studio, plus a thread for every request.'
              : 'Every client line and every request thread, in one inbox.'}
          </p>
        </div>
        {!isClient && (inbox?.clients?.length ?? 0) > 0 && (
          <div className="pfm-head-acts">
            <label className="pfm-search" htmlFor="pfm-client-switch">
              <Users size={15} aria-hidden="true" />
              <span className="sr-only">Filter by client</span>
              <select
                id="pfm-client-switch"
                value={orgFilter}
                onChange={e => { setOrgFilter(e.target.value); setSelected(null); setThread(null); setThreadState('idle') }}
                style={{
                  border: 'none', background: 'none', outline: 'none',
                  font: '600 0.8125rem/1 inherit', color: 'var(--color-text)', minWidth: '9rem',
                }}
              >
                <option value="">Every client</option>
                {inbox?.clients?.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.unread > 0 ? `${c.name} (${c.unread})` : c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </header>

      {readOnly && (
        <div className="pfm-ro">
          <span className="pfm-ro-ic"><Eye size={15} aria-hidden="true" /></span>
          You are reading this as the client. Replies are read-only in client view.
        </div>
      )}

      <div className="pfm-body">
        <ConversationRail
          audience={audience}
          threads={visible}
          selectedKey={selected?.key ?? null}
          onSelect={t => void openThread(t)}
          lens={lens}
          onLensChange={setLens}
          query={query}
          onQueryChange={setQuery}
          unreadTotal={unread}
          showClientName={!isClient && !orgFilter}
          state={listState}
          onRetry={() => void loadInbox()}
          hidden={narrow && !!selected}
        />
        <span className="pfm-vhair" />
        {showThread && (
          <ThreadPane
            payload={thread}
            state={selected ? threadState : 'idle'}
            seenCursor={seenCursor}
            audience={audience}
            narrow={narrow}
            onBack={() => { setSelected(null); setThread(null); setThreadState('idle') }}
            onRetryLoad={() => { if (selected) void loadThread(selected) }}
            onSend={send}
            onRetryMessage={retryMessage}
            attachments={attachments}
            onPickFiles={pickFiles}
            onRemoveAttachment={removeAttachment}
            onVoice={() => void toggleVoice()}
            recording={recording}
            clientName={clientName}
          />
        )}
      </div>
    </div>
  )
}
