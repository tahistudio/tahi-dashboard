'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { RotateCcw, Users } from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { apiPath } from '@/lib/api'
import type { MeetingRecordingDetail, RecordingSpeaker } from '@/lib/meeting-recordings-types'
import { speakerDraftKey, speakerDraftProblem } from '@/lib/recording-speaker-drafts'

type ChoiceKind = 'team' | 'attendee' | 'contact'
interface Choice { name: string; kind: ChoiceKind }

const KIND_LABEL: Record<ChoiceKind, string> = { team: 'Team', attendee: 'Attendee', contact: 'Client contact' }

const INPUT_STYLE = {
  minHeight: '2.75rem', minWidth: 0, width: '100%', maxWidth: '100%', padding: '0.625rem 0.75rem',
  borderWidth: '0.0625rem', borderStyle: 'solid', borderRadius: 'var(--radius-md)',
  background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.875rem',
} as const
const INPUT_CLASS = 'tahi-focus-ring border-[var(--color-border-strong)] enabled:hover:border-[var(--color-brand-ink)] disabled:opacity-60'
const BUTTON_STYLE = {
  minHeight: '2.75rem', minWidth: '2.75rem', maxWidth: '100%', whiteSpace: 'normal',
  overflowWrap: 'anywhere', lineHeight: 1.35,
} as const

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiPath(path), { ...init, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `Request failed (${response.status}). Retry when the connection is restored.`)
  }
  return response.json() as Promise<T>
}

interface Props {
  recordingId: string
  speakers: RecordingSpeaker[]
  /** True while the page is recording, uploading or transcribing something else. */
  disabled?: boolean
  onUpdated: (detail: MeetingRecordingDetail) => void
}

/** Rename the voices of a transcribed recording. Names are saved on the recording and re-render its transcript. */
export function RecordingSpeakersPanel({ recordingId, speakers, disabled = false, onUpdated }: Props) {
  const listId = useId()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [choices, setChoices] = useState<Choice[]>([])
  const [choicesState, setChoicesState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // The recording this panel currently shows. A slow save for an earlier recording is ignored.
  const currentRecording = useRef(recordingId)
  const draftKey = speakerDraftKey(recordingId, speakers)
  useEffect(() => {
    currentRecording.current = recordingId
    setDrafts(Object.fromEntries(speakers.map(speaker => [speaker.key, speaker.label])))
    setError(null)
    setSaved(false)
    // Reset drafts when the recording or its saved labels change, not on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey])

  useEffect(() => {
    let cancelled = false
    setChoicesState('loading')
    request<{ options: Choice[] }>(`/api/admin/recordings/${recordingId}/speakers`)
      .then(result => { if (!cancelled) { setChoices(result.options); setChoicesState('ready') } })
      .catch(() => { if (!cancelled) setChoicesState('error') })
    return () => { cancelled = true }
  }, [recordingId])

  const changes = useMemo(() => {
    const result: Record<string, string | null> = {}
    for (const speaker of speakers) {
      const draft = (drafts[speaker.key] ?? speaker.label).trim()
      if (draft === speaker.label) continue
      result[speaker.key] = draft && draft !== speaker.defaultLabel ? draft : null
    }
    return result
  }, [drafts, speakers])
  const dirty = Object.keys(changes).length > 0
  const problem = useMemo(() => Object.values(changes).map(name => (name ? speakerDraftProblem(name) : null)).find(Boolean) ?? null, [changes])

  const save = useCallback(async (speakerNames: Record<string, string | null>) => {
    const savingFor = recordingId
    setSaving(true); setError(null); setSaved(false)
    try {
      const detail = await request<MeetingRecordingDetail>(`/api/admin/recordings/${recordingId}/speakers`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ speakerNames }),
      })
      if (currentRecording.current !== savingFor) return
      onUpdated(detail)
      setSaved(true)
    } catch (caught) {
      if (currentRecording.current === savingFor) setError(caught instanceof Error ? caught.message : 'Could not save speaker names. Retry.')
    } finally { if (currentRecording.current === savingFor) setSaving(false) }
  }, [onUpdated, recordingId])

  return (
    <section aria-labelledby={`${listId}-heading`} className="space-y-3 rounded-lg p-4"
      style={{ background: 'var(--color-bg)', border: '0.0625rem solid var(--color-border)' }}>
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex shrink-0 items-center justify-center"
          style={{ width: '2.75rem', height: '2.75rem', borderRadius: 'var(--radius-leaf-sm)', color: 'var(--color-brand-on-tint)', background: 'var(--color-brand-50)' }}>
          <Users className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h3 id={`${listId}-heading`} className="font-semibold">Speakers</h3>
          <p className="text-sm text-[var(--color-text-muted)]">Rename a voice and the transcript, including any copy on the linked call, is updated.</p>
        </div>
      </div>

      {speakers.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">No speakers yet. They appear here once the audio is transcribed.</p>
      ) : (
        <form className="space-y-3" onSubmit={event => { event.preventDefault(); if (dirty && !problem) void save(changes) }}>
          <ul className="space-y-3">
            {speakers.map(speaker => (
              <li key={speaker.key} className="flex flex-wrap items-end gap-2">
                <label className="block min-w-0 flex-1 basis-full space-y-1 text-sm font-medium sm:basis-0">
                  <span className="block break-words">
                    {speaker.track === 'mic' ? 'Microphone' : 'System audio'}
                    <span className="font-normal text-[var(--color-text-muted)]">{` (${speaker.defaultLabel})`}</span>
                  </span>
                  <input className={INPUT_CLASS} style={INPUT_STYLE} list={listId} value={drafts[speaker.key] ?? speaker.label}
                    maxLength={80} disabled={disabled || saving} autoComplete="off" data-private
                    onChange={event => { setSaved(false); setDrafts(current => ({ ...current, [speaker.key]: event.target.value })) }} />
                </label>
                {speaker.custom && (
                  <TahiButton type="button" variant="ghost" style={BUTTON_STYLE} disabled={disabled || saving}
                    iconLeft={<RotateCcw className="h-4 w-4 shrink-0" />} aria-label={`Reset ${speaker.defaultLabel} to its default name`}
                    onClick={() => void save({ [speaker.key]: null })}>Reset</TahiButton>
                )}
              </li>
            ))}
          </ul>
          <datalist id={listId}>
            {choices.map(choice => <option key={`${choice.kind}:${choice.name}`} value={choice.name} label={KIND_LABEL[choice.kind]} />)}
          </datalist>
          <p role="status" className="text-sm text-[var(--color-text-muted)]">
            {choicesState === 'loading' ? 'Loading name suggestions.'
              : choicesState === 'error' ? 'Name suggestions are unavailable. You can still type a name.'
              : choices.length ? 'Start typing to pick a team member, attendee or client contact.' : 'No name suggestions for this recording. Type a name.'}
          </p>
          {problem && <p role="alert" className="break-words text-sm text-[var(--color-danger-ink)]">{problem}</p>}
          {error && <p role="alert" className="break-words text-sm text-[var(--color-danger-ink)]">{error}</p>}
          {saved && !error && <p role="status" className="text-sm text-[var(--color-text-muted)]">Names saved. The transcript above is updated.</p>}
          <div className="flex flex-wrap gap-2">
            <TahiButton type="submit" style={BUTTON_STYLE} loading={saving} disabled={disabled || !dirty || !!problem}>Save names</TahiButton>
            {dirty && !saving && (
              <TahiButton type="button" variant="ghost" style={BUTTON_STYLE}
                onClick={() => setDrafts(Object.fromEntries(speakers.map(speaker => [speaker.key, speaker.label])))}>Discard changes</TahiButton>
            )}
          </div>
        </form>
      )}
    </section>
  )
}
