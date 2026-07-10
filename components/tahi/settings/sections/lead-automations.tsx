'use client'

/*
 * Lead automations settings section.
 *
 * How new leads are scored, enriched and routed. Five controls, each saved
 * on change to the settings key-value store (PATCH /api/admin/settings)
 * under the exact keys the lead AI cron consumes
 * (app/api/admin/cron/leads-ai/route.ts readLeadSettings):
 *
 *   AI lead scoring      leads.cronEnabled       (master gate, default on)
 *   Scoring model        leads.scoringModel      (balanced | growth | retainer)
 *   Enrichment           leads.enrichmentEnabled (auto-enrich gate, default on)
 *   Auto-assign hot      leads.autoAssignHot     (default off)
 *   Alert on a hot lead  leads.notifyOnHighIntent (default on)
 *
 * The Scoring model row only renders while scoring is on, per the design.
 */

import { useEffect, useRef, useState } from 'react'
import { apiPath } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import { SectionShell, Toggle, Toasts, useToasts } from '@/components/tahi/settings/primitives'

interface SettingsPayload {
  settings: Record<string, string | null>
}

const MODEL_OPTS: Array<[string, string]> = [
  ['balanced', 'Balanced'],
  ['growth', 'Growth-focused'],
  ['retainer', 'Retainer-fit'],
]

function toBool(v: string | null | undefined, fallback: boolean): boolean {
  if (v == null) return fallback
  return v === 'true' || v === '1'
}

export function LeadAutomationsSection({ isAdmin }: { isAdmin?: boolean } = {}) {
  // Only admins can read /api/admin/settings; non-admins skip the fetch and
  // fall back to defaults so they never sit on a spinner.
  const { data, isLoading, mutate } = useResource<SettingsPayload>(
    isAdmin ? '/api/admin/settings' : null,
  )
  const { toasts, toast } = useToasts()

  const [score, setScore] = useState(true)
  const [model, setModel] = useState('balanced')
  const [enrich, setEnrich] = useState(true)
  const [autoAssign, setAutoAssign] = useState(false)
  const [alertHot, setAlertHot] = useState(true)

  // Seed once when settings first arrive; later mutate() refreshes must not
  // clobber optimistic toggles mid-flight.
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || !data?.settings) return
    seeded.current = true
    const s = data.settings
    setScore(toBool(s['leads.cronEnabled'], true))
    const m = s['leads.scoringModel']
    setModel(m === 'growth' || m === 'retainer' ? m : 'balanced')
    setEnrich(toBool(s['leads.enrichmentEnabled'], true))
    setAutoAssign(toBool(s['leads.autoAssignHot'], false))
    setAlertHot(toBool(s['leads.notifyOnHighIntent'], true))
  }, [data])

  async function saveKey(key: string, value: string): Promise<boolean> {
    try {
      const res = await fetch(apiPath('/api/admin/settings'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      })
      if (!res.ok) throw new Error('save failed')
      void mutate()
      return true
    } catch {
      toast('Could not save. Try again.', 'err')
      return false
    }
  }

  function saveToggle(key: string, next: boolean, revert: (v: boolean) => void) {
    void saveKey(key, next ? 'true' : 'false').then((ok) => {
      if (!ok) revert(!next)
    })
  }

  function toggleScore() {
    const next = !score
    setScore(next)
    saveToggle('leads.cronEnabled', next, setScore)
  }

  function changeModel(next: string) {
    const prev = model
    setModel(next)
    void saveKey('leads.scoringModel', next).then((ok) => {
      if (!ok) setModel(prev)
    })
  }

  function toggleEnrich() {
    const next = !enrich
    setEnrich(next)
    saveToggle('leads.enrichmentEnabled', next, setEnrich)
  }

  function toggleAutoAssign() {
    const next = !autoAssign
    setAutoAssign(next)
    saveToggle('leads.autoAssignHot', next, setAutoAssign)
  }

  function toggleAlertHot() {
    const next = !alertHot
    setAlertHot(next)
    saveToggle('leads.notifyOnHighIntent', next, setAlertHot)
  }

  const loading = isAdmin ? isLoading && !data : false

  if (loading) {
    return (
      <SectionShell
        title="Lead automations"
        lede="How new leads are scored, enriched and routed before they ever reach your pipeline."
      >
        <div className="set-card animate-pulse">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="set-row">
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    height: 14,
                    width: '32%',
                    borderRadius: 6,
                    marginBottom: 6,
                    background: 'var(--color-bg-tertiary)',
                  }}
                />
                <div
                  style={{ height: 12, width: '55%', borderRadius: 6, background: 'var(--color-bg-tertiary)' }}
                />
              </div>
              <div style={{ width: 46, height: 26, borderRadius: 13, background: 'var(--color-bg-tertiary)' }} />
            </div>
          ))}
        </div>
      </SectionShell>
    )
  }

  return (
    <SectionShell
      title="Lead automations"
      lede="How new leads are scored, enriched and routed before they ever reach your pipeline."
    >
      <div className="set-card">
        <div className="set-row">
          <div className="sr-t">
            <b>AI lead scoring</b>
            <small>Score every new lead on fit and intent as it arrives.</small>
          </div>
          <Toggle on={score} onClick={toggleScore} ariaLabel="Toggle AI lead scoring" />
        </div>
        {score && (
          <div className="set-row" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <div className="sr-t">
              <b>Scoring model</b>
              <small>What a high score should reward.</small>
            </div>
            <select
              className="set-input"
              style={{ maxWidth: 220 }}
              value={model}
              onChange={(e) => changeModel(e.target.value)}
              aria-label="Scoring model"
            >
              {MODEL_OPTS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="set-row" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <div className="sr-t">
            <b>Enrichment</b>
            <small>Pull public company data on new leads automatically.</small>
          </div>
          <Toggle on={enrich} onClick={toggleEnrich} ariaLabel="Toggle lead enrichment" />
        </div>
        <div className="set-row">
          <div className="sr-t">
            <b>Auto-assign hot leads</b>
            <small>Route leads scoring 80+ straight to an owner.</small>
          </div>
          <Toggle on={autoAssign} onClick={toggleAutoAssign} ariaLabel="Toggle auto-assign hot leads" />
        </div>
        <div className="set-row">
          <div className="sr-t">
            <b>Alert on a hot lead</b>
            <small>Ping the owner the moment a high-fit lead lands.</small>
          </div>
          <Toggle on={alertHot} onClick={toggleAlertHot} ariaLabel="Toggle alert on a hot lead" />
        </div>
      </div>
      <Toasts toasts={toasts} />
    </SectionShell>
  )
}
