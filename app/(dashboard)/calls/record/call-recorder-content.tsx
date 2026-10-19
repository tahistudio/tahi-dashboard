'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, FileText, Mic, Monitor, RefreshCw, Square, Trash2 } from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { PageHeader } from '@/components/tahi/page-header'
import { Card } from '@/components/tahi/card'
import { Badge } from '@/components/tahi/badge'
import { EmptyState } from '@/components/tahi/empty-state'
import { apiPath } from '@/lib/api'
import { acquireCallStreams, BrowserCallRecorder, convertRecordingGroupAudioBlob, releaseCallStreams, type CallAudioStreams } from '@/lib/browser-call-recorder'
import { listRecordingChunks, removeRecordingChunk, storeRecordingChunk, type RecordingOutboxChunk } from '@/lib/recording-outbox'
import type { MeetingRecording, MeetingRecordingDetail, RecordingTrack } from '@/lib/meeting-recordings-types'
import { readRecordingPrefill } from '@/lib/call-recording-reminders'
import { RECORDING_PCM_HEADER_BYTES, RECORDING_PCM_SAMPLE_RATE } from '@/lib/recording-group-audio'
import { RecordingSpeakersPanel } from './recording-speakers-panel'
import { applySavedDetail } from '@/lib/recording-speaker-drafts'

interface PickerCall { kind: 'discovery' | 'scheduled'; id: string; title: string; scheduledAt: string; orgId: string | null; orgName: string | null }
interface PickerClient { id: string; name: string }
interface UploadReservation { uploadUrl: string; duplicate?: boolean; uploaded?: boolean }

const INPUT_STYLE = {
  minHeight: '2.75rem', minWidth: 0, width: '100%', maxWidth: '100%', padding: '0.625rem 0.75rem',
  borderWidth: '0.0625rem', borderStyle: 'solid', borderRadius: 'var(--radius-md)',
  background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.875rem',
} as const

const INPUT_CLASS = 'tahi-focus-ring border-[var(--color-border-strong)] enabled:hover:border-[var(--color-brand-ink)] disabled:opacity-60'
const BUTTON_STYLE = {
  minHeight: '2.75rem', minWidth: 0, maxWidth: '100%', whiteSpace: 'normal',
  overflowWrap: 'anywhere', lineHeight: 1.35,
} as const

async function readJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiPath(path), { ...init, signal: AbortSignal.timeout(path.endsWith('/transcribe') ? 900_000 : 30_000) })
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `Request failed (${response.status}). Retry when the connection is restored.`)
  }
  return response.json() as Promise<T>
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000)
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}

function InputMeter({ label, level, enabled }: { label: string; level: number; enabled: boolean }) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between gap-2 text-sm text-[var(--color-text-muted)]">
        <span>{label}</span><span>{enabled ? 'Live input' : 'Not recording'}</span>
      </div>
      <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}
        style={{ height: '0.625rem', overflow: 'hidden', borderRadius: 'var(--radius-full)', background: 'var(--color-bg-tertiary)' }}>
        <div style={{ width: `${Math.round(level * 100)}%`, height: '100%', background: 'var(--color-brand-ink)', transition: 'width 0.1s linear' }} />
      </div>
    </div>
  )
}

export function CallRecorderContent({ ownerId, canDeleteAudio }: { ownerId: string; canDeleteAudio: boolean }) {
  const searchParams = useSearchParams()
  const [items, setItems] = useState<MeetingRecording[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [detail, setDetail] = useState<MeetingRecordingDetail | null>(null)
  const [title, setTitle] = useState('')
  const [clientId, setClientId] = useState('')
  const [callKey, setCallKey] = useState('')
  const [clients, setClients] = useState<PickerClient[]>([])
  const [calls, setCalls] = useState<PickerCall[]>([])
  const [callSearch, setCallSearch] = useState('')
  const [clientSearch, setClientSearch] = useState('')
  const [pickerError, setPickerError] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [systemWarning, setSystemWarning] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [separateSpeakers, setSeparateSpeakers] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [levels, setLevels] = useState({ mic: 0, system: 0 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [outboxCount, setOutboxCount] = useState(0)
  const [recoveries, setRecoveries] = useState<string[]>([])
  const streams = useRef<CallAudioStreams | null>(null)
  const recorder = useRef<BrowserCallRecorder | null>(null)
  const activeRecording = useRef<MeetingRecording | null>(null)
  const uploadQueue = useRef<Promise<void>>(Promise.resolve())
  const uploading = useRef(false)
  const queuedUploads = useRef(0)
  const stopPromise = useRef<Promise<void> | null>(null)
  const mounted = useRef(true)
  const stopAction = useRef<() => Promise<void>>(async () => {})
  const startedAt = useRef(0)
  const volatileChunks = useRef(new Map<string, RecordingOutboxChunk>())
  const captureAttempt = useRef(0)
  const appliedPrefill = useRef('')

  useEffect(() => {
    const queryKey = searchParams.toString()
    if (appliedPrefill.current === queryKey || recording || preparing || busy || detail) return
    appliedPrefill.current = queryKey
    const prefill = readRecordingPrefill(searchParams)
    if (!prefill) return
    setTitle(prefill.title)
    setCallKey(prefill.callKey)
    setCallSearch(prefill.title)
    // The scoped call picker resolves the client. Query parameters do not.
    setClientId('')
  }, [searchParams, recording, preparing, busy, detail])

  const loadItems = useCallback(async () => {
    try {
      const result = await readJson<{ items: MeetingRecording[] }>('/api/admin/recordings')
      if (mounted.current) { setItems(result.items); setListError(null) }
    } catch (caught) {
      if (mounted.current) setListError(caught instanceof Error ? caught.message : 'Recordings could not be loaded.')
    } finally { if (mounted.current) setLoading(false) }
  }, [])

  const refreshOutbox = useCallback(async () => {
    const entries = await listRecordingChunks(ownerId)
    const uniqueEntries = new Map(entries.map(entry => [entry.key, entry]))
    for (const [key, entry] of volatileChunks.current) uniqueEntries.set(key, entry)
    if (mounted.current) {
      setOutboxCount(uniqueEntries.size)
      setRecoveries([...new Set([...uniqueEntries.values()].map(entry => entry.recordingId))])
    }
    return entries
  }, [ownerId])

  useEffect(() => {
    mounted.current = true
    void loadItems()
    void refreshOutbox().catch(caught => setError(caught instanceof Error ? caught.message : 'Audio recovery is unavailable.'))
    return () => {
      mounted.current = false
      captureAttempt.current += 1
      if (recorder.current) void recorder.current.stop().catch(() => {})
      if (streams.current) releaseCallStreams(streams.current)
    }
  }, [loadItems, refreshOutbox])

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      void Promise.all([
        readJson<{ organisations: PickerClient[] }>(`/api/admin/clients?search=${encodeURIComponent(clientSearch)}`),
        readJson<{ items: PickerCall[] }>(`/api/admin/call-transcripts/calls?q=${encodeURIComponent(callSearch)}&limit=25`),
      ]).then(([clientResult, callResult]) => {
        if (!cancelled) { setClients(clientResult.organisations); setCalls(callResult.items); setPickerError(null) }
      }).catch(caught => { if (!cancelled) setPickerError(caught instanceof Error ? caught.message : 'Link choices could not be loaded.') })
    }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [callSearch, clientSearch])

  useEffect(() => {
    if (!recording) return
    const timer = setInterval(() => setElapsed(performance.now() - startedAt.current), 500)
    return () => clearInterval(timer)
  }, [recording])

  const shouldWarn = recording || preparing || !!systemWarning || outboxCount > 0 || busy
  useEffect(() => {
    if (!shouldWarn) return
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    const click = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
      if (!target || target.target === '_blank' || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
      if (target.href === location.href || target.hash && target.pathname === location.pathname && target.search === location.search) return
      event.preventDefault()
      event.stopPropagation()
      if (!window.confirm('A recording or audio upload is in progress. Stop and save before leaving this page?')) return
      void stopAction.current().then(() => {
        if (!uploading.current && volatileChunks.current.size === 0) location.assign(target.href)
      }).catch(caught => setError(caught instanceof Error ? caught.message : 'Save the audio before leaving.'))
    }
    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('click', click, true)
    return () => { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', click, true) }
  }, [shouldWarn])

  async function upload(original: RecordingOutboxChunk): Promise<void> {
    let entry = original
    if (entry.track === 'system' && entry.mimeType !== 'audio/wav') {
      const known = activeRecording.current?.id === entry.recordingId ? activeRecording.current
        : detail?.recording.id === entry.recordingId ? detail.recording : items.find(item => item.id === entry.recordingId)
      const saved = known ?? (await readJson<MeetingRecordingDetail>(`/api/admin/recordings/${entry.recordingId}`)).recording
      if (saved.separateSpeakers) {
        // Conversion failures retain the original WebM in the outbox for another retry.
        const blob = await convertRecordingGroupAudioBlob(entry.blob)
        const converted = { ...entry, blob, mimeType: 'audio/wav', size: blob.size,
          durationMs: Math.max(1, Math.round((blob.size - RECORDING_PCM_HEADER_BYTES) / 2 / RECORDING_PCM_SAMPLE_RATE * 1000)) }
        entry = await storeRecordingChunk(ownerId, entry.recordingId, converted)
        volatileChunks.current.set(entry.key, entry)
      }
    }
    const { track, sequence, startMs, durationMs, mimeType, size } = entry
    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const reservation = await readJson<UploadReservation>(`/api/admin/recordings/${entry.recordingId}/chunks`, json('POST', { track, sequence, startMs, durationMs, mimeType, size }))
        if (!reservation.uploaded) {
          const response = await fetch(apiPath(reservation.uploadUrl), { method: 'PUT', headers: { 'Content-Type': mimeType }, body: entry.blob, signal: AbortSignal.timeout(30_000) })
          if (!response.ok) {
            const body = await response.json().catch(() => ({})) as { duplicate?: boolean; uploaded?: boolean; error?: string }
            if (!(response.status === 409 && body.duplicate && body.uploaded)) throw new Error(body.error ?? 'Audio upload failed. The chunk is saved locally for retry.')
          }
        }
        await removeRecordingChunk(entry.key)
        volatileChunks.current.delete(entry.key)
        await refreshOutbox()
        return
      } catch (caught) {
        lastError = caught
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt))
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Audio upload failed. Retry saved audio.')
  }

  function queueUpload(entry: RecordingOutboxChunk) {
    queuedUploads.current += 1
    uploading.current = true
    uploadQueue.current = uploadQueue.current.then(() => upload(entry)).catch(caught => {
      if (mounted.current) setError(caught instanceof Error ? caught.message : 'Audio upload failed. Retry saved audio.')
    }).finally(() => { queuedUploads.current -= 1; uploading.current = queuedUploads.current > 0 })
  }

  async function loadDetail(id: string): Promise<MeetingRecordingDetail> {
    const result = await readJson<MeetingRecordingDetail>(`/api/admin/recordings/${id}`)
    if (mounted.current) setDetail(result)
    return result
  }

  async function transcribe(id: string, options?: { separateSpeakers: false }): Promise<void> {
    setBusy(true)
    setError(null)
    setDetail(current => current?.recording.id === id ? { ...current, recording: { ...current.recording, state: 'transcribing' } } : current)
    try {
      let result: MeetingRecordingDetail
      let requestOptions = options
      do {
        result = await readJson<MeetingRecordingDetail>(`/api/admin/recordings/${id}/transcribe`, json('POST', requestOptions ?? {}))
        requestOptions = undefined
        if (mounted.current) setDetail(result)
        if (result.recording.state === 'failed' || !mounted.current) break
        if (result.pending) await new Promise(resolve => setTimeout(resolve, 300))
      } while (result.pending)
      await loadItems()
    } catch (caught) { if (mounted.current) setError(caught instanceof Error ? caught.message : 'Transcription failed. Retry the saved chunks.') }
    finally { if (mounted.current) setBusy(false) }
  }

  async function beginCapture(prepared: CallAudioStreams, attempt = captureAttempt.current) {
    let created: MeetingRecording | null = null
    try {
      if (!mounted.current || attempt !== captureAttempt.current) { releaseCallStreams(prepared); return }
      const selectedCall = calls.find(call => `${call.kind}:${call.id}` === callKey)
      if (callKey && !selectedCall) throw new Error('Search and select the call again before starting its recording.')
      const tracks: RecordingTrack[] = prepared.system ? ['mic', 'system'] : ['mic']
      const groupEnabled = separateSpeakers && !!prepared.system
      const result = await readJson<{ recording: MeetingRecording }>('/api/admin/recordings', json('POST', {
        title: title.trim() || `Call ${new Date().toLocaleString()}`,
        ...(selectedCall ? { callKind: selectedCall.kind, callId: selectedCall.id } : { orgId: clientId || null }), tracks,
        separateSpeakers: groupEnabled,
      }))
      created = result.recording
      if (!mounted.current || attempt !== captureAttempt.current) {
        releaseCallStreams(prepared)
        await readJson(`/api/admin/recordings/${created.id}`, { method: 'DELETE' })
        return
      }
      stopPromise.current = null
      activeRecording.current = created
      setDetail({ recording: created, chunks: [], transcript: { id: null, text: '' } })
      setSystemWarning(null)
      if (separateSpeakers && !prepared.system) setNotice('Speaker separation was turned off because system audio was not shared. This recording includes your microphone only.')
      const id = created.id
      const session = new BrowserCallRecorder(prepared, {
        onLevels: values => { if (mounted.current) setLevels(values) },
        onEnded: message => { if (mounted.current) setNotice(message); void stopAction.current() },
        onChunk: async chunk => {
          const key = `${ownerId}:${id}:${chunk.track}:${chunk.sequence}`
          volatileChunks.current.set(key, { ...chunk, key, ownerId, recordingId: id })
          if (mounted.current) {
            setOutboxCount(count => count + 1)
            setRecoveries(current => current.includes(id) ? current : [...current, id])
          }
          const entry = await storeRecordingChunk(ownerId, id, chunk)
          volatileChunks.current.delete(key)
          await refreshOutbox()
          queueUpload(entry)
        },
      }, { separateSpeakers: groupEnabled })
      recorder.current = session
      await session.start()
      if (!mounted.current || attempt !== captureAttempt.current) { await session.stop(); return }
      startedAt.current = performance.now()
      setElapsed(0)
      setRecording(true)
      streams.current = null
      await loadItems()
    } catch (caught) {
      if (recorder.current) await recorder.current.stop().catch(() => {})
      recorder.current = null
      releaseCallStreams(prepared)
      streams.current = null
      if (mounted.current) setError(caught instanceof Error ? caught.message : 'Recording could not start. Check browser permissions and retry.')
      if (created) await loadDetail(created.id).catch(() => {})
    } finally { if (mounted.current) setPreparing(false) }
  }

  async function prepare() {
    const attempt = ++captureAttempt.current
    setPreparing(true)
    setError(null)
    setNotice(null)
    setSystemWarning(null)
    if (streams.current) releaseCallStreams(streams.current)
    streams.current = null
    try {
      // Probe durable storage before creating a recording, then retain the live streams.
      const prepared = await acquireCallStreams(() => mounted.current && attempt === captureAttempt.current)
      if (!mounted.current || attempt !== captureAttempt.current) { releaseCallStreams(prepared); return }
      streams.current = prepared
      await listRecordingChunks(ownerId)
      if (!mounted.current || attempt !== captureAttempt.current) { releaseCallStreams(prepared); return }
      if (!prepared.system) {
        setSystemWarning(prepared.systemError ?? 'System audio was not shared.')
        setPreparing(false)
        return
      }
      await beginCapture(prepared, attempt)
    } catch (caught) {
      if (streams.current) releaseCallStreams(streams.current)
      streams.current = null
      setError(caught instanceof Error ? caught.message : 'Microphone access failed. Check browser permissions.')
      setPreparing(false)
    }
  }

  async function recover(id: string, finalize = false): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const entries = [...await listRecordingChunks(ownerId, id), ...[...volatileChunks.current.values()].filter(entry => entry.recordingId === id)]
      for (const entry of entries) {
        if (volatileChunks.current.has(entry.key)) await storeRecordingChunk(ownerId, id, entry)
        await upload(entry)
      }
      let result = await loadDetail(id)
      if (finalize && result.recording.state === 'recording') {
        const expectedChunks = { mic: 0, system: 0 }
        let durationMs = 0
        for (const chunk of result.chunks) {
          expectedChunks[chunk.track] = Math.max(expectedChunks[chunk.track], chunk.sequence + 1)
          durationMs = Math.max(durationMs, chunk.startMs + chunk.durationMs)
        }
        await readJson(`/api/admin/recordings/${id}/stop`, json('POST', { expectedChunks, durationMs }))
        result = await loadDetail(id)
      }
      if (result.recording.state !== 'recording') await transcribe(id)
      await refreshOutbox()
      await loadItems()
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Recovery failed. Your saved audio remains available.') }
    finally { setBusy(false) }
  }

  const finishCapture = async (): Promise<void> => {
    captureAttempt.current += 1
    if (streams.current) { releaseCallStreams(streams.current); streams.current = null; setSystemWarning(null) }
    const session = recorder.current
    const current = activeRecording.current
    if (!session || !current) { await uploadQueue.current; return }
    setBusy(true)
    setRecording(false)
    setDetail(currentDetail => currentDetail?.recording.id === current.id ? { ...currentDetail, recording: { ...currentDetail.recording, state: 'uploading' } } : currentDetail)
    try {
      const stopped = await session.stop()
      recorder.current = null
      setLevels({ mic: 0, system: 0 })
      setElapsed(stopped.durationMs)
      await readJson(`/api/admin/recordings/${current.id}/stop`, json('POST', stopped))
      await uploadQueue.current
      const pending = await listRecordingChunks(ownerId, current.id)
      await loadDetail(current.id)
      if (pending.length === 0 && volatileChunks.current.size === 0) await transcribe(current.id)
      else setError('Some audio is still saved in this browser. Retry saved audio to finish the transcript.')
      await loadItems()
    } catch (caught) {
      recorder.current = null
      setError(caught instanceof Error ? caught.message : 'The recording could not finish. Recover its saved audio below.')
      await loadDetail(current.id).catch(() => {})
    } finally { setBusy(false); activeRecording.current = null }
  }
  const stopCapture = (): Promise<void> => {
    if (stopPromise.current) return stopPromise.current
    const pending = finishCapture()
    stopPromise.current = pending
    void pending.finally(() => { stopPromise.current = null })
    return pending
  }
  stopAction.current = stopCapture

  async function chooseRecording(id: string) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await loadDetail(id)
      setClientId(result.recording.orgId ?? '')
      setCallKey(result.recording.callId ? `${result.recording.callKind}:${result.recording.callId}` : '')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'This recording could not be loaded.') }
    finally { setBusy(false) }
  }

  async function linkRecording() {
    if (!detail) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const call = calls.find(item => `${item.kind}:${item.id}` === callKey)
      if (callKey && !call) throw new Error('Search and select the call again before saving its link.')
      await readJson(`/api/admin/recordings/${detail.recording.id}/link`, json('PATCH', {
        ...(call ? { callKind: call.kind, callId: call.id } : { orgId: clientId || null, callKind: null, callId: null }),
      }))
      await loadDetail(detail.recording.id)
      setNotice(call ? 'Transcript linked to the selected call.' : clientId ? 'Transcript linked to the selected client.' : 'Transcript left unlinked.')
      await loadItems()
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The link could not be saved.') }
    finally { setBusy(false) }
  }

  async function deleteRecording(id: string, hasTranscript: boolean) {
    if (!window.confirm(hasTranscript ? 'Delete this recording audio? The saved transcript and recording details will remain.' : 'Delete this recording audio? There is no saved transcript yet, so only the recording details will remain.')) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await readJson(`/api/admin/recordings/${id}`, { method: 'DELETE' })
      for (const entry of await listRecordingChunks(ownerId, id)) await removeRecordingChunk(entry.key)
      for (const [key, entry] of volatileChunks.current) if (entry.recordingId === id) volatileChunks.current.delete(key)
      if (detail?.recording.id === id) setDetail(null)
      await refreshOutbox()
      await loadItems()
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Recording could not be deleted.') }
    finally { setBusy(false) }
  }

  const disabled = recording || preparing || busy
  const failedChunks = detail?.chunks.filter(chunk => chunk.state === 'failed') ?? []
  const assignedClientId = detail?.recording.state === 'ready' ? detail.recording.orgId : null
  const clientLinkLocked = !!assignedClientId
  const callLinkLocked = detail?.recording.state === 'ready' && !!detail.recording.callId
  const availableCalls = assignedClientId ? calls.filter(call => call.orgId === assignedClientId) : calls

  function newRecording() {
    setDetail(null)
    setTitle('')
    setClientId('')
    setCallKey('')
    setClientSearch('')
    setCallSearch('')
    setSeparateSpeakers(false)
    setError(null)
    setNotice(null)
  }

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader title="Record call" subtitle="Capture your microphone and the audio from your Windows PC.">
        <Link href="/calls" className="tahi-focus-ring flex items-center gap-2 rounded-md px-3 text-sm hover:bg-[var(--color-bg-secondary)]"
          style={{ minHeight: '2.75rem', color: 'var(--color-text-muted)' }}><ArrowLeft className="h-4 w-4" /> Calls</Link>
      </PageHeader>

      {(error || notice) && <Card padding="md" role={error ? 'alert' : 'status'}>
        <p className="break-words text-sm" style={{ color: error ? 'var(--color-danger-ink)' : 'var(--color-text-muted)' }}>{error ?? notice}</p>
      </Card>}

      <Card padding="md">
        {recording ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span aria-hidden="true" className="animate-pulse rounded-full" style={{ width: '0.75rem', height: '0.75rem', background: 'var(--color-danger)' }} />
                <div><h2 role="status" className="font-semibold">Recording</h2><p role="timer" aria-live="off" className="text-2xl tabular-nums" aria-label="Elapsed time">{formatElapsed(elapsed)}</p></div>
              </div>
              <TahiButton variant="danger" style={BUTTON_STYLE} iconLeft={<Square className="h-4 w-4 shrink-0" />} onClick={() => void stopCapture()}>Stop recording</TahiButton>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <InputMeter label="Me, microphone" level={levels.mic} enabled />
              <InputMeter label="Them, system audio" level={levels.system} enabled={activeRecording.current?.tracks.includes('system') ?? false} />
            </div>
            <p className="text-sm text-[var(--color-text-muted)]">Keep this page open. Audio is saved during the call. {outboxCount > 0 ? `${outboxCount} chunks waiting to upload.` : 'Saved chunks are uploaded.'}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 flex-1 basis-full items-start gap-3 sm:basis-0">
                <span aria-hidden="true" className="flex shrink-0 items-center justify-center" style={{ width: '2.75rem', height: '2.75rem', borderRadius: 'var(--radius-leaf-sm)', color: 'var(--color-brand-on-tint)', background: 'var(--color-brand-50)' }}><Mic className="h-5 w-5" /></span>
                <div className="min-w-0"><h2 className="font-semibold">Manual call recording</h2><p className="text-sm text-[var(--color-text-muted)]">Choose Entire screen and tick Share system audio in the browser prompt. Only audio is saved. Your microphone is recorded separately.</p></div>
              </div>
              {detail && <TahiButton variant="secondary" style={BUTTON_STYLE} disabled={disabled || !!systemWarning} onClick={newRecording}>New recording</TahiButton>}
            </div>
            <label className="block space-y-2 text-sm font-medium">Recording title<input className={INPUT_CLASS} style={INPUT_STYLE} value={title} onChange={event => setTitle(event.target.value)} placeholder="Client check-in" maxLength={200} disabled={disabled} /></label>
            <label className="tahi-focus-ring flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-[var(--color-border)] p-3 hover:bg-[var(--color-bg-secondary)]">
              <input type="checkbox" className="mt-1 shrink-0 accent-[var(--color-brand-ink)]" checked={detail?.recording.separateSpeakers ?? separateSpeakers}
                disabled={disabled || !!detail} onChange={event => setSeparateSpeakers(event.target.checked)} aria-describedby="group-speakers-help" />
              <span className="min-w-0 space-y-1">
                <span className="block text-sm font-medium">Separate speakers (group call)</span>
                <span id="group-speakers-help" className="block text-sm text-[var(--color-text-muted)]">Labels the people on system audio as Them 1, Them 2 and so on. Estimated US$0.34 per recorded hour including your microphone, before retries and storage. Limited to two hours of system audio; longer recordings use Whisper without speaker separation. Off by default.</span>
              </span>
            </label>
            {systemWarning ? <div role="alert" className="space-y-3 rounded-lg p-4" style={{ background: 'var(--color-bg-secondary)', border: '0.0625rem solid var(--color-border)' }}>
              <p className="text-sm font-medium">{systemWarning}</p>
              <p className="text-sm text-[var(--color-text-muted)]">Mic only records your voice. The people you hear on the call will be missing.</p>
              <div className="flex flex-wrap gap-2">
                <TahiButton style={BUTTON_STYLE} disabled={disabled} onClick={() => void prepare()}>Retry system audio</TahiButton>
                <TahiButton variant="secondary" style={BUTTON_STYLE} disabled={disabled} onClick={() => { if (streams.current) { setPreparing(true); void beginCapture(streams.current) } }}>Record mic only</TahiButton>
                <TahiButton variant="ghost" style={BUTTON_STYLE} onClick={() => { captureAttempt.current += 1; if (streams.current) releaseCallStreams(streams.current); streams.current = null; setSystemWarning(null) }}>Cancel</TahiButton>
              </div>
            </div> : <TahiButton style={BUTTON_STYLE} loading={preparing} disabled={busy} iconLeft={<Monitor className="h-4 w-4 shrink-0" />} onClick={() => void prepare()}>Record call</TahiButton>}
          </div>
        )}
      </Card>

      <Card padding="md">
        <div className="space-y-4">
          <div><h2 className="font-semibold">Link to a client or call</h2><p className="text-sm text-[var(--color-text-muted)]">Choose deliberately, or leave it unlinked. Task suggestions still need human approval.</p></div>
          {clientLinkLocked && <p className="text-sm text-[var(--color-text-muted)]">This transcript is assigned to a client. Choose a call for that client to add a call link, or select New recording to start a separate recording.</p>}
          {pickerError && <p role="alert" className="break-words text-sm text-[var(--color-danger-ink)]">{pickerError}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block min-w-0 space-y-2 text-sm font-medium">Search clients<input className={INPUT_CLASS} style={INPUT_STYLE} value={clientSearch} disabled={disabled || !!callKey || clientLinkLocked} onChange={event => setClientSearch(event.target.value)} placeholder="Client name" /></label>
            <label className="block min-w-0 space-y-2 text-sm font-medium">Search calls<input className={INPUT_CLASS} style={INPUT_STYLE} value={callSearch} disabled={disabled} onChange={event => setCallSearch(event.target.value)} placeholder="Title or client" /></label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block min-w-0 space-y-2 text-sm font-medium">Client<select className={INPUT_CLASS} style={INPUT_STYLE} value={clientId} disabled={disabled || !!callKey || clientLinkLocked} onChange={event => setClientId(event.target.value)}>
              {clientId && !clients.some(client => client.id === clientId) && <option value={clientId}>Existing client selection</option>}
              <option value="">Leave unlinked</option>{clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select></label>
            <label className="block min-w-0 space-y-2 text-sm font-medium">Call<select className={INPUT_CLASS} style={INPUT_STYLE} value={callKey} disabled={disabled} onChange={event => {
              const nextKey = event.target.value
              setCallKey(nextKey)
              const selectedCall = availableCalls.find(call => `${call.kind}:${call.id}` === nextKey)
              if (selectedCall) setClientId(selectedCall.orgId ?? '')
            }}>
            {callKey && !availableCalls.some(call => `${call.kind}:${call.id}` === callKey) && <option value={callKey}>Search to confirm selected call</option>}
            <option value="" disabled={callLinkLocked}>No call selected</option>{availableCalls.map(call => <option key={`${call.kind}:${call.id}`} value={`${call.kind}:${call.id}`}>{call.title} ({new Date(call.scheduledAt).toLocaleDateString()}){call.orgName ? `, ${call.orgName}` : ''}</option>)}
            </select></label>
          </div>
          {detail && <TahiButton variant="secondary" style={BUTTON_STYLE} disabled={disabled} onClick={() => void linkRecording()}>Save link</TahiButton>}
        </div>
      </Card>

      {recoveries.length > 0 && !recording && <Card padding="md">
        <h2 className="font-semibold">Saved audio waiting to upload</h2>
        <p className="my-2 text-sm text-[var(--color-text-muted)]">This browser has {outboxCount} saved chunks. Recover them before closing or clearing browser data.</p>
        <div className="flex flex-wrap gap-2">{recoveries.map(id => <TahiButton key={id} variant="secondary" style={BUTTON_STYLE} disabled={disabled} onClick={() => void recover(id)}>{items.find(item => item.id === id)?.title ?? 'Recover recording'}</TahiButton>)}</div>
      </Card>}

      {detail && !recording && <Card padding="md">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="min-w-0 break-words font-semibold">{detail.recording.title}</h2><Badge className={detail.recording.deletedAt ? undefined : 'capitalize'} tone={detail.recording.deletedAt ? 'neutral' : detail.recording.state === 'failed' ? 'danger' : detail.recording.state === 'ready' ? 'positive' : 'info'}>{detail.recording.deletedAt ? 'Audio deleted' : detail.recording.state}</Badge></div>
          {busy && <p role="status" className="text-sm text-[var(--color-text-muted)]">Saving audio or transcribing a chunk. Keep this page open.</p>}
          {detail.recording.error && <p role="alert" className="break-words text-sm text-[var(--color-danger-ink)]">{detail.recording.error}</p>}
          {detail.transcript.text ? <pre data-private className="whitespace-pre-wrap break-words rounded-lg p-4 text-sm leading-relaxed" style={{ fontFamily: 'inherit', background: 'var(--color-bg-secondary)', color: 'var(--color-text)' }}>{detail.transcript.text}</pre> : <p className="text-sm text-[var(--color-text-muted)]">The transcript will appear here after the audio is processed.</p>}
          {detail.recording.state === 'ready' && <RecordingSpeakersPanel key={detail.recording.id} recordingId={detail.recording.id} speakers={detail.speakers ?? []} disabled={disabled} onUpdated={saved => setDetail(current => applySavedDetail(current, saved))} />}
          {failedChunks.length > 0 && <ul className="space-y-2 break-words text-sm text-[var(--color-danger-ink)]" aria-label="Failed audio chunks">{failedChunks.map(chunk => <li key={chunk.id}>{chunk.track === 'mic' ? 'Me' : 'Them'}, {formatElapsed(chunk.startMs)}: {chunk.error ?? 'Transcription failed.'}</li>)}</ul>}
          <div className="flex flex-wrap gap-2">
            {!detail.recording.deletedAt && detail.recording.state === 'recording' && <TahiButton variant="secondary" style={BUTTON_STYLE} disabled={disabled} onClick={() => { if (window.confirm('Finish this interrupted recording using its saved chunks? Audio since the last saved chunk may be missing.')) void recover(detail.recording.id, true) }}>Finish interrupted recording</TahiButton>}
            {!detail.recording.deletedAt && detail.recording.state !== 'ready' && detail.recording.state !== 'recording' && <TahiButton variant="secondary" style={BUTTON_STYLE} disabled={disabled} iconLeft={<RefreshCw className="h-4 w-4 shrink-0" />} onClick={() => void recover(detail.recording.id)}>Retry saved audio and failed chunks</TahiButton>}
            {canDeleteAudio && !detail.recording.deletedAt && detail.recording.separateSpeakers && detail.recording.state !== 'recording' && detail.recording.state !== 'ready' && <TahiButton variant="secondary" style={BUTTON_STYLE} disabled={disabled} onClick={() => void transcribe(detail.recording.id, { separateSpeakers: false })}>Transcribe without speaker separation</TahiButton>}
            {detail.recording.state === 'ready' && <TahiButton variant="secondary" style={BUTTON_STYLE} disabled={disabled} iconLeft={<RefreshCw className="h-4 w-4 shrink-0" />} onClick={() => void transcribe(detail.recording.id)}>Refresh transcript</TahiButton>}
            {detail.recording.state === 'ready' && <Link href="/calls" className="tahi-focus-ring flex max-w-full items-center rounded-md px-3 py-2 text-sm hover:bg-[var(--color-bg-secondary)]" style={{ minHeight: '2.75rem', color: 'var(--color-link)' }}>Open calls and task suggestions</Link>}
            {canDeleteAudio && !detail.recording.deletedAt && <TahiButton variant="ghost" style={BUTTON_STYLE} disabled={disabled} iconLeft={<Trash2 className="h-4 w-4 shrink-0" />} onClick={() => void deleteRecording(detail.recording.id, Boolean(detail.recording.transcriptId))}>Delete recording audio</TahiButton>}
          </div>
        </div>
      </Card>}

      <Card padding="md">
        <div className="mb-4 flex items-center justify-between gap-3"><h2 className="font-semibold">Recordings</h2><TahiButton variant="ghost" style={BUTTON_STYLE} disabled={disabled} onClick={() => void loadItems()} iconLeft={<RefreshCw className="h-4 w-4 shrink-0" />}>Refresh</TahiButton></div>
        {loading ? <div role="status" aria-label="Loading recordings" className="space-y-3 animate-pulse">{[0, 1, 2].map(index => <div key={index} className="h-12 rounded-md" style={{ background: 'var(--color-bg-secondary)' }} />)}</div>
          : listError ? <div role="alert" className="space-y-3"><p className="break-words text-sm text-[var(--color-danger-ink)]">{listError}</p><TahiButton variant="secondary" style={BUTTON_STYLE} onClick={() => void loadItems()}>Retry loading</TahiButton></div>
          : items.length === 0 ? <EmptyState icon={<FileText className="h-6 w-6" />} title="No recordings yet" description="Start a manual recording to save both sides of a call." />
          : <ul className="space-y-2">{items.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md p-3" style={{ background: 'var(--color-bg-secondary)', border: '0.0625rem solid var(--color-border-subtle)' }}>
            <div className="min-w-0 flex-1"><p data-private className="break-words text-sm font-semibold">{item.title}</p><p className="text-xs text-[var(--color-text-muted)]">{new Date(item.startedAt).toLocaleString()} · {formatElapsed(item.durationMs)}{!item.deletedAt && ` · ${item.state}`}</p>{(item.source === 'tray' || item.deletedAt) && <div className="mt-1 flex flex-wrap gap-2">{item.source === 'tray' && <Badge tone="neutral">Tray</Badge>}{item.deletedAt && <Badge tone="neutral">Audio deleted</Badge>}</div>}</div>
            <TahiButton variant="secondary" style={BUTTON_STYLE} disabled={disabled} onClick={() => void chooseRecording(item.id)}>Open</TahiButton>
          </li>)}</ul>}
      </Card>
    </div>
  )
}
