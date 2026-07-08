'use client'

import { useEffect, useState } from 'react'
import { SectionShell } from '@/components/tahi/settings/primitives'
import { useResource } from '@/lib/use-resource'
import { apiPath } from '@/lib/api'

type SettingsMap = Record<string, string | null>

/**
 * Studio details: the studio's legal name, GST number, and address as they
 * appear on invoices. Admin-only. There is no dedicated backend table yet, so
 * these persist to the settings key-value store under studio_legal_name,
 * studio_gst_number, and studio_address via PATCH /api/admin/settings (one
 * call per key). Save-only.
 */
export function StudioDetailsSection(_props: { isAdmin?: boolean } = {}) {
  const { data, isLoading, mutate } = useResource<{ settings: SettingsMap }>(
    '/api/admin/settings',
  )

  const [legalName, setLegalName] = useState('')
  const [gstNumber, setGstNumber] = useState('')
  const [address, setAddress] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Seed the editable fields whenever settings load or refresh.
  useEffect(() => {
    if (data?.settings) {
      setLegalName(data.settings.studio_legal_name ?? '')
      setGstNumber(data.settings.studio_gst_number ?? '')
      setAddress(data.settings.studio_address ?? '')
    }
  }, [data])

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
        saveKey('studio_legal_name', legalName.trim()),
        saveKey('studio_gst_number', gstNumber.trim()),
        saveKey('studio_address', address.trim()),
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

  if (isLoading) {
    return (
      <SectionShell title="Studio details" lede="Legal name, address, and tax details on invoices.">
        <div className="set-card">
          <div className="set-grid2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="set-field"
                style={i === 2 ? { gridColumn: '1 / -1' } : undefined}
              >
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
                  style={{
                    height: 40,
                    borderRadius: 9,
                    background: 'var(--color-bg-tertiary)',
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      </SectionShell>
    )
  }

  return (
    <SectionShell title="Studio details" lede="Legal name, address, and tax details on invoices.">
      <div className="set-card">
        <div className="set-grid2">
          <div className="set-field">
            <label htmlFor="studio-legal-name">Legal name</label>
            <input
              id="studio-legal-name"
              className="set-input"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              placeholder="Tahi Studio Ltd"
            />
          </div>
          <div className="set-field">
            <label htmlFor="studio-gst-number">GST number</label>
            <input
              id="studio-gst-number"
              className="set-input"
              value={gstNumber}
              onChange={(e) => setGstNumber(e.target.value)}
              placeholder="123-456-789"
            />
          </div>
          <div className="set-field" style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="studio-address">Address</label>
            <input
              id="studio-address"
              className="set-input"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="12 Vulcan Lane, Auckland 1010, New Zealand"
            />
          </div>
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
              Details saved
            </span>
          )}
          <button type="button" className="btn1" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save details'}
          </button>
        </div>
      </div>
    </SectionShell>
  )
}
