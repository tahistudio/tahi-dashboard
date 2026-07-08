'use client'

import { useEffect, useState } from 'react'
import { SectionShell } from '@/components/tahi/settings/primitives'
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

/**
 * Pipeline defaults: the default deal owner assigned to new deals, and the
 * nudge signature appended to outbound nudges. Admin-only. There is no
 * dedicated backend table, so both persist to the settings key-value store
 * under pipeline.default_owner and pipeline.nudge_signature via
 * PATCH /api/admin/settings (one call per key). The owner list comes from
 * GET /api/admin/team. Save-only.
 */
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

  const [owner, setOwner] = useState('')
  const [signature, setSignature] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const team = teamData?.items ?? []

  // Seed the editable fields whenever settings load or refresh.
  useEffect(() => {
    if (settingsData?.settings) {
      setOwner(settingsData.settings['pipeline.default_owner'] ?? '')
      setSignature(settingsData.settings['pipeline.nudge_signature'] ?? '')
    }
  }, [settingsData])

  async function saveKey(key: string, value: string) {
    const res = await fetch(apiPath('/api/admin/settings'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    })
    if (!res.ok) throw new Error('Failed to save ' + key)
  }

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    try {
      await Promise.all([
        saveKey('pipeline.default_owner', owner.trim()),
        saveKey('pipeline.nudge_signature', signature),
      ])
      setSaved(true)
      await mutate()
      setTimeout(() => setSaved(false), 3000)
    } catch {
      // Save failed; leave the form intact so the user can retry.
    } finally {
      setSaving(false)
    }
  }

  const loading = admin && (settingsLoading || teamLoading)

  if (loading) {
    return (
      <SectionShell title="Pipeline defaults" lede="Defaults applied to new deals.">
        <div className="set-card">
          <div className="set-grid2">
            <div className="set-field">
              <div
                style={{
                  height: 14,
                  width: '40%',
                  borderRadius: 6,
                  marginBottom: 8,
                  background: 'var(--color-bg-tertiary)',
                }}
              />
              <div
                style={{ height: 40, borderRadius: 9, background: 'var(--color-bg-tertiary)' }}
              />
            </div>
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
              style={{
                height: 14,
                width: '30%',
                borderRadius: 6,
                marginBottom: 8,
                background: 'var(--color-bg-tertiary)',
              }}
            />
            <div
              style={{ height: 80, borderRadius: 9, background: 'var(--color-bg-tertiary)' }}
            />
          </div>
        </div>
      </SectionShell>
    )
  }

  // The saved owner may reference someone no longer in the team list; keep it
  // selectable so we never silently drop the persisted value.
  const ownerOptions = owner && !team.some((m) => m.name === owner) ? [owner] : []

  return (
    <SectionShell title="Pipeline defaults" lede="Defaults applied to new deals.">
      <div className="set-card">
        <div className="set-grid2">
          <div className="set-field">
            <label htmlFor="pipeline-default-owner">Default deal owner</label>
            <select
              id="pipeline-default-owner"
              className="set-input"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
            >
              <option value="">Unassigned</option>
              {ownerOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
              {team.map((m) => (
                <option key={m.id} value={m.name}>
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
            placeholder={'Cheers,\nLiam / Tahi Studio'}
          />
        </div>
        <div
          className="set-row"
          style={{
            justifyContent: 'flex-end',
            gap: 14,
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          {saved && (
            <span style={{ font: '500 12.5px Manrope,sans-serif', color: 'var(--brand-strong)' }}>
              Defaults saved
            </span>
          )}
          <button type="button" className="btn1" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save defaults'}
          </button>
        </div>
      </div>
    </SectionShell>
  )
}
