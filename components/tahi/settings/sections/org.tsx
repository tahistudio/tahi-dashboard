'use client'

/**
 * Organization (client portal). The client's own company identity: logo, name,
 * website, industry, brand colour. Shown under the client Organization group.
 *
 * Scaffold: fields are local state and the logo preview is a client-side data
 * URL. Persisting these needs a portal org endpoint (name/website/industry/
 * brandColour) plus R2 for the logo. Flagged, not wired.
 */

import { useState } from 'react'
import { Camera } from 'lucide-react'
import { SectionShell } from '@/components/tahi/settings/primitives'

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

export function OrgSettingsSection() {
  const [name, setName] = useState('Your company')
  const [website, setWebsite] = useState('')
  const [industry, setIndustry] = useState('')
  const [colour, setColour] = useState('#5A824E')
  const [logo, setLogo] = useState<string>('')

  function pickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setLogo(typeof reader.result === 'string' ? reader.result : '')
    reader.readAsDataURL(file)
  }

  return (
    <SectionShell title="Organization" lede="Your company details and identity across the workspace.">
      <div className="set-card">
        <div className="av-row">
          <div className="av-up">
            <label className="av-up-frame rounded" aria-label="Upload organization logo">
              {logo ? <img src={logo} alt="" /> : <span className="av-up-initials">{initialsOf(name)}</span>}
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
          <div className="set-field"><label>Organization name</label><input className="set-input" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="set-field"><label>Website</label><input className="set-input" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" /></div>
          <div className="set-field"><label>Industry</label><input className="set-input" value={industry} onChange={(e) => setIndustry(e.target.value)} /></div>
          <div className="set-field">
            <label>Brand colour</label>
            <div style={{ display: 'flex', gap: '0.625rem', alignItems: 'center' }}>
              <input type="color" value={colour} onChange={(e) => setColour(e.target.value)} aria-label="Brand colour" style={{ width: 44, height: 40, border: '1px solid var(--border)', borderRadius: 9, padding: 2, background: 'var(--bg)', cursor: 'pointer', flexShrink: 0 }} />
              <input className="set-input" value={colour} onChange={(e) => setColour(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="set-row" style={{ justifyContent: 'flex-end', borderTop: '1px solid var(--border-subtle)' }}>
          <button className="btn1" type="button">Save organization</button>
        </div>
      </div>
    </SectionShell>
  )
}
