'use client'

/*
 * Pipeline defaults settings section.
 *
 * The starting point for every new deal: default owner, currency, follow-up
 * cadence, close window, the auto-nudge switch and the nudge signature.
 * Admin-only. Everything persists to the settings key-value store via
 * PATCH /api/admin/settings, one call per key, saved on change (selects,
 * toggle) or on blur (signature textarea).
 *
 * Keys match the backend consumers exactly:
 *   pipeline.defaultDealOwnerId    read by POST /api/admin/deals (team member id)
 *   pipeline.defaultCurrency       read by POST /api/admin/deals
 *   pipeline.defaultCloseWindowDays read by POST /api/admin/deals
 *   pipeline.followUpCadenceDays   reserved for the stale-deal nudge engine
 *   pipeline.autoNudgeStale        reserved for the stale-deal nudge engine
 *   pipeline.nudgeSignatureHtml    read by POST /api/admin/deals/[id]/nudges
 *
 * The signature is stored as HTML (newlines as <br>) because the nudge send
 * path appends it to an HTML email body; the textarea edits it as plain text.
 */

import { useEffect, useRef, useState } from 'react'
import { SectionShell, Toggle, Toasts, useToasts } from '@/components/tahi/settings/primitives'
import { useResource } from '@/lib/use-resource'
import { apiPath } from '@/lib/api'

type SettingsMap = Record<string, string | null>

interface TeamMember {
  id: string
  name: string
}

interface TeamPayload {
  items: TeamMember[]
}

const CURRENCIES = ['NZD', 'USD', 'AUD', 'GBP', 'EUR']

const CADENCE_OPTS: Array<[string, string]> = [
  ['2', 'Every 2 days'],
  ['3', 'Every 3 days'],
  ['5', 'Every 5 days'],
  ['7', 'Weekly'],
]

const CLOSE_WINDOW_OPTS: Array<[string, string]> = [
  ['14', '14 days'],
  ['30', '30 days'],
  ['60', '60 days'],
  ['90', '90 days'],
]

function htmlToText(v: string): string {
  return v.replace(/<br\s*\/?>/gi, '\n')
}

function textToHtml(v: string): string {
  return v.replace(/\r\n/g, '\n').replace(/\n/g, '<br>')
}

export function PipelineDefaultsSection({ isAdmin }: { isAdmin?: boolean } = {}) {
  const admin = isAdmin !== false

  const {
    data: settingsData,
    isLoading: settingsLoading,
    mutate,
  } = useResource<{ settings: SettingsMap }>(admin ? '/api/admin/settings' : null)

  const { data: teamData, isLoading: teamLoading } = useResource<TeamPayload>(
    admin ? '/api/admin/team' : null,
  )

  const { toasts, toast } = useToasts()

  const [owner, setOwner] = useState('')
  const [currency, setCurrency] = useState('NZD')
  const [cadence, setCadence] = useState('3')
  const [closeWindow, setCloseWindow] = useState('30')
  const [nudge, setNudge] = useState(true)
  const [signature, setSignature] = useState('')
  const savedSignature = useRef('')

  const team = teamData?.items ?? []

  // Seed the editable fields once when settings first arrive. Later mutate()
  // refreshes must not clobber in-flight edits (e.g. typing the signature
  // while a select save round-trips).
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || !settingsData?.settings) return
    seeded.current = true
    const s = settingsData.settings
    setOwner(s['pipeline.defaultDealOwnerId'] ?? '')
    setCurrency(s['pipeline.defaultCurrency'] ?? 'NZD')
    setCadence(s['pipeline.followUpCadenceDays'] ?? '3')
    setCloseWindow(s['pipeline.defaultCloseWindowDays'] ?? '30')
    setNudge(s['pipeline.autoNudgeStale'] !== 'false')
    // Fall back to the legacy plain-text key so a signature saved before the
    // key rename is not silently lost. The next edit writes the new key.
    const sig = htmlToText(s['pipeline.nudgeSignatureHtml'] ?? s['pipeline.nudge_signature'] ?? '')
    setSignature(sig)
    savedSignature.current = sig
  }, [settingsData])

  async function saveKey(key: string, value: string): Promise<boolean> {
    try {
      const res = await fetch(apiPath('/api/admin/settings'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      })
      if (!res.ok) throw new Error('Failed to save ' + key)
      void mutate()
      return true
    } catch {
      toast('Could not save. Try again.', 'err')
      return false
    }
  }

  function saveSelect(key: string, next: string, prev: string, revert: (v: string) => void) {
    void saveKey(key, next).then((ok) => {
      if (!ok) revert(prev)
    })
  }

  function toggleNudge() {
    const next = !nudge
    setNudge(next)
    void saveKey('pipeline.autoNudgeStale', next ? 'true' : 'false').then((ok) => {
      if (!ok) setNudge(!next)
    })
  }

  function saveSignature() {
    if (signature === savedSignature.current) return
    const prev = savedSignature.current
    savedSignature.current = signature
    void saveKey('pipeline.nudgeSignatureHtml', textToHtml(signature)).then((ok) => {
      if (!ok) savedSignature.current = prev
    })
  }

  // Hold the skeleton while either fetch is still in flight without data, so
  // the owner select never renders a value with no matching option.
  const loading = admin && ((settingsLoading && !settingsData) || (teamLoading && !teamData))

  if (loading) {
    return (
      <SectionShell
        title="Pipeline defaults"
        lede="The starting point for every new deal, so your pipeline stays consistent."
      >
        <div className="set-card animate-pulse">
          <div className="set-grid2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="set-field">
                <div
                  style={{
                    height: 12,
                    width: '45%',
                    borderRadius: 6,
                    background: 'var(--color-bg-tertiary)',
                  }}
                />
                <div style={{ height: 40, borderRadius: 9, background: 'var(--color-bg-tertiary)' }} />
              </div>
            ))}
          </div>
          <div className="set-row" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  height: 14,
                  width: '35%',
                  borderRadius: 6,
                  marginBottom: 6,
                  background: 'var(--color-bg-tertiary)',
                }}
              />
              <div
                style={{ height: 12, width: '60%', borderRadius: 6, background: 'var(--color-bg-tertiary)' }}
              />
            </div>
            <div style={{ width: 46, height: 26, borderRadius: 13, background: 'var(--color-bg-tertiary)' }} />
          </div>
          <div
            className="set-row"
            style={{
              flexDirection: 'column',
              alignItems: 'stretch',
              gap: 6,
              borderTop: '1px solid var(--border-subtle)',
            }}
          >
            <div
              style={{ height: 12, width: '25%', borderRadius: 6, background: 'var(--color-bg-tertiary)' }}
            />
            <div style={{ height: 80, borderRadius: 9, background: 'var(--color-bg-tertiary)' }} />
          </div>
        </div>
      </SectionShell>
    )
  }

  // The saved owner may reference someone no longer on the team; keep the id
  // selectable so we never silently drop the persisted value.
  const ownerMissing = owner !== '' && !team.some((m) => m.id === owner)

  return (
    <SectionShell
      title="Pipeline defaults"
      lede="The starting point for every new deal, so your pipeline stays consistent."
    >
      <div className="set-card">
        <div className="set-grid2">
          <div className="set-field">
            <label htmlFor="pipeline-default-owner">Default deal owner</label>
            <select
              id="pipeline-default-owner"
              className="set-input"
              value={owner}
              onChange={(e) => {
                const prev = owner
                setOwner(e.target.value)
                saveSelect('pipeline.defaultDealOwnerId', e.target.value, prev, setOwner)
              }}
            >
              <option value="">Unassigned</option>
              {ownerMissing && <option value={owner}>Removed team member</option>}
              {team.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            {!team.length && (
              <small
                style={{
                  display: 'block',
                  marginTop: 5,
                  color: 'var(--text-faint)',
                  font: '500 12px Manrope',
                }}
              >
                Add team members to assign a default owner.
              </small>
            )}
          </div>
          <div className="set-field">
            <label htmlFor="pipeline-default-currency">Default currency</label>
            <select
              id="pipeline-default-currency"
              className="set-input"
              value={currency}
              onChange={(e) => {
                const prev = currency
                setCurrency(e.target.value)
                saveSelect('pipeline.defaultCurrency', e.target.value, prev, setCurrency)
              }}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="set-field">
            <label htmlFor="pipeline-followup-cadence">Follow-up cadence</label>
            <select
              id="pipeline-followup-cadence"
              className="set-input"
              value={cadence}
              onChange={(e) => {
                const prev = cadence
                setCadence(e.target.value)
                saveSelect('pipeline.followUpCadenceDays', e.target.value, prev, setCadence)
              }}
            >
              {CADENCE_OPTS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="set-field">
            <label htmlFor="pipeline-close-window">Default close window</label>
            <select
              id="pipeline-close-window"
              className="set-input"
              value={closeWindow}
              onChange={(e) => {
                const prev = closeWindow
                setCloseWindow(e.target.value)
                saveSelect('pipeline.defaultCloseWindowDays', e.target.value, prev, setCloseWindow)
              }}
            >
              {CLOSE_WINDOW_OPTS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="set-row" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <div className="sr-t">
            <b>Auto-nudge stale deals</b>
            <small>Remind the owner when a deal sits past its follow-up cadence.</small>
          </div>
          <Toggle on={nudge} onClick={toggleNudge} ariaLabel="Toggle auto-nudge stale deals" />
        </div>
        <div
          className="set-row"
          style={{
            flexDirection: 'column',
            alignItems: 'stretch',
            gap: 6,
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          <label className="led" htmlFor="pipeline-nudge-signature">
            Nudge signature
          </label>
          <textarea
            id="pipeline-nudge-signature"
            className="set-input"
            style={{ height: 80, padding: '10px 12px', resize: 'vertical', lineHeight: 1.5 }}
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            onBlur={saveSignature}
            placeholder={'Cheers,\nLiam · Tahi Studio'}
          />
        </div>
      </div>
      <Toasts toasts={toasts} />
    </SectionShell>
  )
}
