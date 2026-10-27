'use client'

import { useEffect, useId, useMemo, useState } from 'react'
import { apiPath } from '@/lib/api'
import { SlideOver } from '@/components/tahi/slide-over'
import { Input } from '@/components/tahi/input'
import { SegmentedControl } from '@/components/tahi/segmented-control'
import { TahiButton } from '@/components/tahi/tahi-button'
import { QA_BROWSERS, QA_DEFAULT_BROWSER, type QaBrowserKey, type QaTarget } from '@/lib/qa/types'

export interface StartRoundDialogProps {
  open: boolean
  onClose: () => void
  siteId: string
  stagingUrl: string | null
  liveUrl: string | null
  /** Called with the new round id so the page can open it. */
  onStarted: (roundId: string) => void
}

/** Default round name: "Pre-launch 26 Oct" for staging, "Live check 26 Oct" for live. */
export function defaultRoundName(target: QaTarget, now: Date = new Date()): string {
  const day = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return `${target === 'live' ? 'Live check' : 'Pre-launch'} ${day}`
}

async function errorText(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null
  return typeof body?.error === 'string' ? body.error : `Request failed (${res.status})`
}

export function StartRoundDialog({ open, onClose, siteId, stagingUrl, liveUrl, onStarted }: StartRoundDialogProps) {
  const nameId = useId()
  const browsersId = useId()
  const targets = useMemo<QaTarget[]>(() => {
    const out: QaTarget[] = []
    if (stagingUrl) out.push('staging')
    if (liveUrl) out.push('live')
    return out
  }, [stagingUrl, liveUrl])
  const [target, setTarget] = useState<QaTarget>('staging')
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [browsers, setBrowsers] = useState<QaBrowserKey[]>([QA_DEFAULT_BROWSER])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const first = targets[0] ?? 'staging'
    setTarget(first)
    setNameTouched(false)
    setBrowsers([QA_DEFAULT_BROWSER])
    setError(null)
    setSaving(false)
  }, [open, targets])

  useEffect(() => {
    if (!nameTouched) setName(defaultRoundName(target))
  }, [target, nameTouched])

  function toggleBrowser(key: QaBrowserKey, checked: boolean) {
    setBrowsers(current => (checked ? QA_BROWSERS.map(b => b.key).filter(k => k === key || current.includes(k)) : current.filter(k => k !== key)))
  }

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Name the round.')
      return
    }
    if (browsers.length === 0) {
      setError('Pick at least one browser.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(apiPath(`/api/admin/qa/sites/${siteId}/rounds`), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: trimmed, target, browsers }),
      })
      if (!res.ok) throw new Error(await errorText(res))
      const json = (await res.json()) as { item?: { id?: string } }
      if (!json.item?.id) throw new Error('The round was created but no id came back.')
      onStarted(json.item.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the round.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SlideOver open={open} onClose={onClose} title="Start round" variant="center" maxWidth="32rem">
      <div className="flex flex-col" style={{ gap: '1rem' }}>
        <p className="text-[var(--color-text-muted)]" style={{ fontSize: '0.8125rem' }}>
          A round snapshots the current page list. Ticks and notes are saved against that round.
        </p>
        {targets.length === 0 ? (
          <p role="alert" className="text-[var(--color-danger)]" style={{ fontSize: '0.8125rem' }}>
            Add a staging or live URL to this site before starting a round.
          </p>
        ) : (
          <>
            <div className="flex flex-col" style={{ gap: '0.375rem' }}>
              <span className="text-[var(--color-text)]" style={{ fontSize: '0.8125rem', fontWeight: 600 }}>Target</span>
              <SegmentedControl<QaTarget>
                value={target}
                onChange={setTarget}
                ariaLabel="Round target"
                fill
                options={targets.map(t => ({ value: t, label: t === 'live' ? 'Live' : 'Staging' }))}
              />
            </div>
            <div className="flex flex-col" style={{ gap: '0.375rem' }}>
              <label htmlFor={nameId} className="text-[var(--color-text)]" style={{ fontSize: '0.8125rem', fontWeight: 600 }}>
                Round name
              </label>
              <Input
                id={nameId}
                value={name}
                maxLength={120}
                onChange={e => {
                  setNameTouched(true)
                  setName(e.target.value)
                }}
              />
            </div>
            <fieldset className="flex flex-col" style={{ gap: '0.25rem', margin: 0, padding: 0, border: 0, minWidth: 0 }}>
              <legend className="text-[var(--color-text)]" style={{ fontSize: '0.8125rem', fontWeight: 600, padding: 0, marginBottom: '0.25rem' }}>
                Browsers
              </legend>
              <div className="flex flex-wrap" style={{ gap: '0 1rem' }}>
                {QA_BROWSERS.map(b => {
                  const id = `${browsersId}-${b.key}`
                  return (
                    <label
                      key={b.key}
                      htmlFor={id}
                      className="flex min-h-[2.75rem] cursor-pointer items-center text-[var(--color-text)]"
                      style={{ gap: '0.5rem', fontSize: '0.875rem' }}
                    >
                      <input
                        id={id}
                        type="checkbox"
                        checked={browsers.includes(b.key)}
                        onChange={e => toggleBrowser(b.key, e.target.checked)}
                        className="size-4 accent-[var(--color-brand)]"
                      />
                      {b.label}
                    </label>
                  )
                })}
              </div>
              <p className="text-[var(--color-text-muted)]" style={{ margin: 0, fontSize: '0.75rem' }}>
                Open this round in each browser to tick it there.
              </p>
            </fieldset>
          </>
        )}
        {error ? <p role="alert" className="text-[var(--color-danger)]" style={{ fontSize: '0.8125rem' }}>{error}</p> : null}
        <div className="flex justify-end" style={{ gap: '0.5rem' }}>
          <TahiButton variant="secondary" onClick={onClose} disabled={saving}>Cancel</TahiButton>
          <TahiButton
            variant="primary"
            onClick={() => void submit()}
            loading={saving}
            disabled={saving || targets.length === 0}
          >
            Start round
          </TahiButton>
        </div>
      </div>
    </SlideOver>
  )
}
