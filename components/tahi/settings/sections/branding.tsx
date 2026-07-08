'use client'

/*
 * Branding settings section.
 *
 * Portal name, primary colour (presets + custom hex + live preview), logo URL
 * and light/dark favicons. Self-contained: reads /api/admin/settings and saves
 * each key back with PATCH. Admin-only surface.
 *
 * Save keys: portal_name, portal_primary_color, portal_logo_url,
 * favicon_light_url, favicon_dark_url.
 */

import { useEffect, useState, type ChangeEvent } from 'react'
import { useUser } from '@clerk/nextjs'
import { apiPath } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import { SectionShell, Seg } from '@/components/tahi/settings/primitives'

type SettingsMap = Record<string, string | null>

const DEFAULT_COLOR = '#5A824E'
const DEFAULT_FAVICON = '/favicon.png'

// Favicon is a platform-level (Tahi) asset, so only super admins may change it.
const SUPER_ADMIN_EMAILS = new Set(['business@tahi.studio', 'staci@tahi.studio'])

// One favicon upload row: a file picker (no URL box) that stores the chosen
// icon inline as a data URL via the settings key.
function FaviconRow({ label, hint, value, saving, onPick }: {
  label: string
  hint: string
  value: string
  saving: boolean
  onPick: (e: ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <div className="set-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8, borderTop: '1px solid var(--border-subtle)' }}>
      <div className="sr-t"><b>{label}</b><small>{hint}</small></div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <label className="btn2" style={{ cursor: 'pointer' }}>
          {saving ? 'Uploading...' : 'Upload icon'}
          <input type="file" accept="image/png,image/x-icon,image/svg+xml,image/jpeg,.ico" onChange={onPick} style={{ display: 'none' }} />
        </label>
        {value && (
          <>
            <span className="led">Preview</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={value}
              alt={`${label} preview`}
              style={{ width: 24, height: 24, objectFit: 'contain' }}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
            />
          </>
        )}
      </div>
    </div>
  )
}

const SWATCHES = ['#5A824E', '#2A6FDB', '#1F8A5B', '#B4531F', '#6D4FA3', '#0E7C86']

const HEX_RE = /^#[0-9a-fA-F]{6}$/

export function BrandingSection(_props: { isAdmin?: boolean } = {}) {
  const { data, isLoading, mutate } = useResource<{ settings: SettingsMap }>(
    '/api/admin/settings',
  )
  const settings = data?.settings

  const [portalName, setPortalName] = useState('')
  const [color, setColor] = useState(DEFAULT_COLOR)
  const [hexMode, setHexMode] = useState(false)
  const [hex, setHex] = useState(DEFAULT_COLOR)
  const [logoUrl, setLogoUrl] = useState('')
  const [faviconLight, setFaviconLight] = useState(DEFAULT_FAVICON)
  const [faviconDark, setFaviconDark] = useState(DEFAULT_FAVICON)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  const { user } = useUser()
  const email = user?.primaryEmailAddress?.emailAddress?.toLowerCase() ?? null
  const isSuperAdmin = email ? SUPER_ADMIN_EMAILS.has(email) : false

  // Sync local editors from the loaded settings.
  useEffect(() => {
    if (!settings) return
    const c = settings['portal_primary_color'] ?? DEFAULT_COLOR
    setPortalName(settings['portal_name'] ?? '')
    setColor(c)
    setHex(c)
    setLogoUrl(settings['portal_logo_url'] ?? '')
    setFaviconLight(settings['favicon_light_url'] ?? DEFAULT_FAVICON)
    setFaviconDark(settings['favicon_dark_url'] ?? DEFAULT_FAVICON)
  }, [settings])

  async function save(key: string, value: string) {
    setSavingKey(key)
    try {
      await fetch(apiPath('/api/admin/settings'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      })
      await mutate()
    } finally {
      setSavingKey(null)
    }
  }

  // Upload an icon file: read it to a data URL, preview it, and save inline.
  function pickFavicon(e: ChangeEvent<HTMLInputElement>, key: string, setter: (v: string) => void) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : ''
      if (!url) return
      setter(url)
      void save(key, url)
    }
    reader.readAsDataURL(file)
  }

  if (isLoading && !settings) {
    return (
      <SectionShell title="Branding" lede="How your portal looks to clients.">
        <div className="set-card">
          <div className="lrow" style={{ color: 'var(--text-faint)', font: '500 13px Manrope' }}>
            Loading branding...
          </div>
        </div>
      </SectionShell>
    )
  }

  return (
    <SectionShell title="Branding" lede="How your portal looks to clients.">
      <div className="set-card">
        {/* Portal name */}
        <div className="set-grid2" style={{ gridTemplateColumns: '1fr' }}>
          <div className="set-field">
            <label>Portal name</label>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input
                className="set-input"
                value={portalName}
                onChange={(e) => setPortalName(e.target.value)}
                placeholder="Tahi Studio"
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn1"
                onClick={() => void save('portal_name', portalName)}
                disabled={savingKey === 'portal_name'}
              >
                {savingKey === 'portal_name' ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>

        {/* Primary colour */}
        <div
          className="set-row"
          style={{
            flexDirection: 'column',
            alignItems: 'stretch',
            gap: 12,
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div className="sr-t">
              <b>Primary colour</b>
              <small>Buttons and accents in the client portal.</small>
            </div>
            <Seg
              aria="Colour source"
              value={hexMode ? 'hex' : 'preset'}
              onChange={(v) => setHexMode(v === 'hex')}
              opts={[
                ['preset', 'Presets'],
                ['hex', 'Custom hex'],
              ]}
            />
          </div>

          {!hexMode ? (
            <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    setColor(c)
                    setHex(c)
                    void save('portal_primary_color', c)
                  }}
                  aria-label={c}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 9,
                    background: c,
                    border: color === c ? '2px solid var(--text)' : '2px solid transparent',
                    boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.1)',
                    cursor: 'pointer',
                  }}
                />
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <input
                type="color"
                value={color}
                onChange={(e) => {
                  setHex(e.target.value)
                  setColor(e.target.value)
                }}
                onBlur={() => void save('portal_primary_color', color)}
                aria-label="Pick colour"
                style={{
                  width: 44,
                  height: 40,
                  border: '1px solid var(--border)',
                  borderRadius: 9,
                  background: 'var(--bg)',
                  padding: 2,
                  cursor: 'pointer',
                }}
              />
              <input
                className="set-input"
                style={{ maxWidth: 140, textTransform: 'uppercase' }}
                value={hex}
                onChange={(e) => {
                  let v = e.target.value
                  if (!v.startsWith('#')) v = '#' + v
                  setHex(v)
                  if (HEX_RE.test(v)) setColor(v)
                }}
                onBlur={() => {
                  if (HEX_RE.test(hex)) void save('portal_primary_color', hex)
                }}
                aria-label="Hex value"
                placeholder={DEFAULT_COLOR}
              />
              <span
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 9,
                  background: color,
                  boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.1)',
                }}
              />
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 2 }}>
            <span className="led">Preview</span>
            <button type="button" className="btn1" style={{ background: color, cursor: 'default' }}>
              Primary button
            </button>
          </div>
        </div>

        {/* Logo URL */}
        <div
          className="set-row"
          style={{
            flexDirection: 'column',
            alignItems: 'stretch',
            gap: 8,
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          <div className="sr-t">
            <b>Logo URL</b>
            <small>Shown in the client portal header.</small>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input
              className="set-input"
              type="url"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://example.com/logo.png"
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="btn1"
              onClick={() => void save('portal_logo_url', logoUrl)}
              disabled={savingKey === 'portal_logo_url'}
            >
              {savingKey === 'portal_logo_url' ? 'Saving...' : 'Save'}
            </button>
          </div>
          {logoUrl && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 2 }}>
              <span className="led">Preview</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={logoUrl}
                alt="Logo preview"
                style={{ height: 32, objectFit: 'contain' }}
                onError={(e) => {
                  ;(e.currentTarget as HTMLImageElement).style.display = 'none'
                }}
              />
            </div>
          )}
        </div>

        {/* Favicon - platform-level Tahi asset: super admins only, upload not URL. */}
        {isSuperAdmin && (
          <>
            <FaviconRow
              label="Favicon (light mode)"
              hint="Tab icon shown in light mode. Platform asset - only super admins can change it."
              value={faviconLight}
              saving={savingKey === 'favicon_light_url'}
              onPick={(e) => pickFavicon(e, 'favicon_light_url', setFaviconLight)}
            />
            <FaviconRow
              label="Favicon (dark mode)"
              hint="Tab icon shown in dark mode."
              value={faviconDark}
              saving={savingKey === 'favicon_dark_url'}
              onPick={(e) => pickFavicon(e, 'favicon_dark_url', setFaviconDark)}
            />
          </>
        )}
      </div>
    </SectionShell>
  )
}
