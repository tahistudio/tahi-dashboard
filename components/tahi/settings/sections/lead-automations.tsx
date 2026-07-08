'use client'

import { useEffect, useState } from 'react'
import { apiPath } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import { SectionShell, Toggle } from '@/components/tahi/settings/primitives'

interface SettingsPayload {
  settings: Record<string, string | null>
}

/**
 * Lead automations settings section.
 *
 * AI lead scoring + enrichment toggles persist to /api/admin/settings under
 * the keys leads.scoring and leads.enrichment. Admin-only surface. Defaults
 * mirror the design: both run unless explicitly switched off, so each is on
 * unless the stored value is exactly 'false'.
 */
export function LeadAutomationsSection({ isAdmin }: { isAdmin?: boolean } = {}) {
  // Only admins can read /api/admin/settings; non-admins skip the fetch and
  // fall back to defaults so they never sit on a spinner.
  const { data, isLoading, mutate } = useResource<SettingsPayload>(
    isAdmin ? '/api/admin/settings' : null,
  )

  const [score, setScore] = useState(true)
  const [enrich, setEnrich] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    const s = data?.settings
    if (!s) return
    setScore(s['leads.scoring'] !== 'false')
    setEnrich(s['leads.enrichment'] !== 'false')
  }, [data])

  async function save(key: string, next: boolean, revert: (v: boolean) => void) {
    setSaving(key)
    try {
      const res = await fetch(apiPath('/api/admin/settings'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: next ? 'true' : 'false' }),
      })
      if (!res.ok) {
        revert(!next)
      } else {
        void mutate()
      }
    } catch {
      revert(!next)
    } finally {
      setSaving(null)
    }
  }

  function toggleScore() {
    const next = !score
    setScore(next)
    void save('leads.scoring', next, setScore)
  }

  function toggleEnrich() {
    const next = !enrich
    setEnrich(next)
    void save('leads.enrichment', next, setEnrich)
  }

  const loading = isAdmin ? isLoading : false

  return (
    <SectionShell title="Lead automations" lede="AI scoring and enrichment on new leads.">
      <div className="set-card">
        <div className="set-row">
          <div className="sr-t">
            <b>AI lead scoring</b>
            <small>Score new leads on fit and intent.</small>
          </div>
          <Toggle on={score} onClick={toggleScore} ariaLabel="Toggle AI lead scoring" />
        </div>
        <div className="set-row">
          <div className="sr-t">
            <b>Enrichment</b>
            <small>Pull public company data on new leads.</small>
          </div>
          <Toggle on={enrich} onClick={toggleEnrich} ariaLabel="Toggle lead enrichment" />
        </div>
      </div>
      {loading && (
        <p className="set-lede" style={{ marginTop: 12, marginBottom: 0 }}>
          Loading your preferences...
        </p>
      )}
      {saving && (
        <p className="set-lede" style={{ marginTop: 12, marginBottom: 0 }}>
          Saving...
        </p>
      )}
    </SectionShell>
  )
}
