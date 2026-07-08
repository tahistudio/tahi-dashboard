'use client'

/**
 * Organization (client portal). The client's own company identity: logo, name,
 * website, industry, brand colour. Shown under the client Organization group.
 *
 * Persistence: name / website / industry / accentColour save to the caller's
 * organisations row via PATCH /api/portal/organisation (getPortalAuth-scoped;
 * an impersonating admin is read-only and the endpoint 403s their save). The
 * logo runs the real R2 flow: presign -> PUT to the proxy URL -> confirm
 * metadata -> PATCH logoUrl with the authenticated serve URL, so it survives
 * reloads and renders anywhere the org logo is shown.
 *
 * Members get disabled fields; the PATCH endpoint enforces the same gate
 * server-side (contacts.portal_role === 'admin').
 */

import { useEffect, useState } from 'react'
import {
  SectionShell,
  AvatarUpload,
  Toasts,
  useToasts,
} from '@/components/tahi/settings/primitives'
import { useResource } from '@/lib/use-resource'
import { apiPath } from '@/lib/api'

interface PortalOrg {
  id: string
  name: string
  website: string | null
  industry: string | null
  logoUrl: string | null
  accentColour: string | null
}

interface PresignResponse {
  uploadUrl: string
  storageKey: string
  fileId: string
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

/** Returns '#rrggbb', '' for cleared, or null when the value is not valid hex. */
function normalizeHex(v: string): string | null {
  const raw = v.trim()
  if (!raw) return ''
  const hex = raw.startsWith('#') ? raw : '#' + raw
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : null
}

export function OrgSettingsSection({ isClientAdmin }: { isAdmin?: boolean; isClientAdmin?: boolean } = {}) {
  // Members get a read-only view; the PATCH endpoint enforces the same gate
  // server-side (contacts.portal_role === 'admin').
  const canManage = !!isClientAdmin
  const { data, isLoading, mutate } = useResource<{ organisation: PortalOrg }>(
    '/api/portal/organisation',
  )
  const org = data?.organisation ?? null
  const { toasts, toast } = useToasts()

  const [name, setName] = useState('')
  const [website, setWebsite] = useState('')
  const [industry, setIndustry] = useState('')
  const [colour, setColour] = useState('#5A824E')
  const [saving, setSaving] = useState(false)
  const [logoBusy, setLogoBusy] = useState(false)

  // Seed the form from the loaded org record.
  useEffect(() => {
    if (!org) return
    setName(org.name ?? '')
    setWebsite(org.website ?? '')
    setIndustry(org.industry ?? '')
    setColour(org.accentColour ?? '#5A824E')
  }, [org])

  async function patchOrg(body: Record<string, string>): Promise<Response> {
    return fetch(apiPath('/api/portal/organisation'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  async function save() {
    if (!name.trim()) {
      toast('Organization name cannot be empty.', 'err')
      return
    }
    const hex = normalizeHex(colour)
    if (hex === null) {
      toast('Brand colour must be a hex value like #5A824E.', 'err')
      return
    }
    setSaving(true)
    try {
      const res = await patchOrg({
        name: name.trim(),
        website: website.trim(),
        industry: industry.trim(),
        accentColour: hex,
      })
      if (res.ok) {
        toast('Organization details saved')
        await mutate()
      } else if (res.status === 403) {
        toast('Only workspace admins can update the organization.', 'err')
      } else {
        toast('Could not save your changes. Please try again shortly.', 'err')
      }
    } catch {
      toast('Could not save your changes. Please try again shortly.', 'err')
    } finally {
      setSaving(false)
    }
  }

  // Real upload: presign -> PUT the bytes to the R2 proxy -> confirm metadata
  // -> store the authenticated serve URL in organisations.logo_url.
  async function uploadLogo(file: File) {
    if (!canManage) {
      toast('Only workspace admins can update the logo.', 'err')
      return
    }
    setLogoBusy(true)
    try {
      const mime = file.type || 'application/octet-stream'
      const presignRes = await fetch(apiPath('/api/uploads/presign'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, mimeType: mime, requestId: 'org-logo' }),
      })
      if (!presignRes.ok) throw new Error('presign failed')
      const { uploadUrl, storageKey, fileId } = (await presignRes.json()) as PresignResponse

      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': mime },
        body: file,
      })
      if (!putRes.ok) throw new Error('upload failed')

      const confirmRes = await fetch(apiPath('/api/uploads/confirm'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId,
          storageKey,
          filename: file.name,
          mimeType: mime,
          sizeBytes: file.size,
        }),
      })
      if (!confirmRes.ok) throw new Error('confirm failed')

      const servedUrl = apiPath('/api/uploads/serve?key=' + encodeURIComponent(storageKey))
      const patchRes = await patchOrg({ logoUrl: servedUrl })
      if (!patchRes.ok) throw new Error('patch failed')
      await mutate()
      toast('Organization logo updated')
    } catch {
      toast('Could not upload the logo. Please try again shortly.', 'err')
    } finally {
      setLogoBusy(false)
    }
  }

  async function removeLogo() {
    if (!canManage) {
      toast('Only workspace admins can update the logo.', 'err')
      return
    }
    setLogoBusy(true)
    try {
      const res = await patchOrg({ logoUrl: '' })
      if (!res.ok) throw new Error('patch failed')
      await mutate()
      toast('Organization logo removed')
    } catch {
      toast('Could not remove the logo. Please try again shortly.', 'err')
    } finally {
      setLogoBusy(false)
    }
  }

  const disabled = (isLoading && !org) || !canManage
  const swatch = normalizeHex(colour) || '#5A824E'

  return (
    <SectionShell title="Organization" lede="Your company details and identity across the workspace.">
      <div className="set-card">
        <div className="av-row">
          <AvatarUpload
            value={org?.logoUrl ?? ''}
            initials={initialsOf(name || org?.name || 'Your company')}
            onFile={uploadLogo}
            onRemove={org?.logoUrl ? removeLogo : undefined}
            size={78}
            shape="rounded"
            busy={logoBusy}
            ariaLabel="Upload organization logo"
          />
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
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input
                type="color"
                className="set-colorpick"
                value={swatch}
                onChange={(e) => setColour(e.target.value)}
                disabled={disabled}
                aria-label="Brand colour"
                style={{ width: 44, height: 40, border: '1px solid var(--border)', borderRadius: 9, padding: 2, background: 'var(--bg)', cursor: 'pointer', flexShrink: 0 }}
              />
              <input
                className="set-input"
                value={colour}
                onChange={(e) => setColour(e.target.value)}
                disabled={disabled}
                aria-label="Brand colour hex"
              />
            </div>
          </div>
        </div>
        <div className="set-row" style={{ justifyContent: 'flex-end', borderTop: '1px solid var(--border-subtle)' }}>
          <button className="btn1" type="button" onClick={save} disabled={saving || disabled}>
            {saving ? 'Saving...' : 'Save organization'}
          </button>
        </div>
      </div>
      <Toasts toasts={toasts} />
    </SectionShell>
  )
}
