'use client'

/**
 * Organization (client portal). The client's own company identity: logo, name,
 * website, industry, brand colour. Shown under the client Organization group.
 *
 * Persistence: name / website / industry save to the caller's organisations row
 * via PATCH /api/portal/organisation (getPortalAuth-scoped; an impersonating
 * admin is read-only and the endpoint 403s their save).
 *
 * Brand colour: the organisations table has no brand-colour column, so the
 * picker below is presentational and not persisted. The client's brand colour
 * lives per sub-brand under the Brand tab (the `brands` table). The note makes
 * that explicit rather than silently discarding it.
 * TODO(org-brand-colour): persist once an org-level accent column exists.
 *
 * Logo: kept as a local preview. Wiring it needs the R2 upload flow
 * (presign -> proxy -> serve) to mint a durable URL to store in logoUrl; the
 * PATCH already accepts logoUrl, so only the client-side upload wiring remains.
 * TODO(org-logo-upload): run the presign/proxy/serve dance and PATCH logoUrl.
 */

import { useEffect, useState } from 'react'
import { Camera } from 'lucide-react'
import { SectionShell } from '@/components/tahi/settings/primitives'
import { useResource } from '@/lib/use-resource'
import { apiPath } from '@/lib/api'

interface PortalOrg {
  id: string
  name: string
  website: string | null
  industry: string | null
  logoUrl: string | null
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

export function OrgSettingsSection({ isClientAdmin }: { isClientAdmin?: boolean } = {}) {
  // Members get a read-only view; the PATCH endpoint enforces the same gate
  // server-side (contacts.portal_role === 'admin').
  const canManage = !!isClientAdmin
  const { data, isLoading, mutate } = useResource<{ organisation: PortalOrg }>(
    '/api/portal/organisation',
  )
  const org = data?.organisation ?? null

  const [name, setName] = useState('')
  const [website, setWebsite] = useState('')
  const [industry, setIndustry] = useState('')
  const [colour, setColour] = useState('#5A824E')
  const [logo, setLogo] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState('')

  // Seed the form from the loaded org record.
  useEffect(() => {
    if (!org) return
    setName(org.name ?? '')
    setWebsite(org.website ?? '')
    setIndustry(org.industry ?? '')
    setLogo(org.logoUrl ?? '')
  }, [org])

  async function save() {
    if (!name.trim()) {
      setNote('Organization name cannot be empty.')
      window.setTimeout(() => setNote(''), 4200)
      return
    }
    setSaving(true)
    setNote('')
    try {
      const res = await fetch(apiPath('/api/portal/organisation'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          website: website.trim(),
          industry: industry.trim(),
        }),
      })
      if (res.ok) {
        setNote('Organization details saved.')
        await mutate()
      } else if (res.status === 403) {
        setNote('You are viewing this workspace as read-only, so changes were not saved.')
      } else {
        setNote('Could not save your changes. Please try again shortly.')
      }
    } catch {
      setNote('Could not save your changes. Please try again shortly.')
    } finally {
      setSaving(false)
      window.setTimeout(() => setNote(''), 5200)
    }
  }

  function pickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setLogo(typeof reader.result === 'string' ? reader.result : '')
    reader.readAsDataURL(file)
  }

  const disabled = (isLoading && !org) || !canManage

  return (
    <SectionShell title="Organization" lede="Your company details and identity across the workspace.">
      <div className="set-card">
        <div className="av-row">
          <div className="av-up">
            <label className="av-up-frame rounded" aria-label="Upload organization logo">
              {logo ? <img src={logo} alt="" /> : <span className="av-up-initials">{initialsOf(name || 'Your company')}</span>}
              <span className="av-up-cam"><Camera size={14} aria-hidden="true" /></span>
              <input type="file" accept="image/*" onChange={pickLogo} style={{ display: 'none' }} />
            </label>
          </div>
          <div className="av-row-t">
            <b>Organization logo</b>
            <small>Square PNG or SVG. Appears in your portal header, invoices and shared documents.</small>
          </div>
        </div>
        <div className="set-grid2 av-fields">
          <div className="set-field"><label>Organization name</label><input className="set-input" value={name} onChange={(e) => setName(e.target.value)} disabled={disabled} /></div>
          <div className="set-field"><label>Website</label><input className="set-input" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" disabled={disabled} /></div>
          <div className="set-field"><label>Industry</label><input className="set-input" value={industry} onChange={(e) => setIndustry(e.target.value)} disabled={disabled} /></div>
          <div className="set-field">
            <label>Brand colour</label>
            <div style={{ display: 'flex', gap: '0.625rem', alignItems: 'center' }}>
              <input type="color" value={colour} onChange={(e) => setColour(e.target.value)} aria-label="Brand colour" style={{ width: 44, height: 40, border: '1px solid var(--border)', borderRadius: 9, padding: 2, background: 'var(--bg)', cursor: 'pointer', flexShrink: 0 }} />
              <input className="set-input" value={colour} onChange={(e) => setColour(e.target.value)} />
            </div>
          </div>
        </div>
        {canManage && (
          <div className="set-row" style={{ justifyContent: 'flex-end', borderTop: '1px solid var(--border-subtle)' }}>
            <button className="btn1" type="button" onClick={save} disabled={saving || disabled}>
              {saving ? 'Saving...' : 'Save organization'}
            </button>
          </div>
        )}
      </div>
      <p className="set-lede" style={{ marginTop: 12, marginBottom: 0 }}>
        {canManage
          ? 'Your logo preview and brand colour are not saved yet. Manage brand colours per brand under the Brand tab.'
          : 'Only workspace admins can update the organization details.'}
      </p>
      {note && <div className="plan-note">{note}</div>}
    </SectionShell>
  )
}
