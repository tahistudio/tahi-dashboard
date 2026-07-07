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

import { useEffect, useState } from 'react'
import { apiPath } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import { SectionShell, Seg } from '@/components/tahi/settings/primitives'

type SettingsMap = Record<string, string | null>

const DEFAULT_COLOR = '#5A824E'
const DEFAULT_FAVICON = '/favicon.png'

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

        {/* Favicon (light) */}
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
            <b>Favicon (light mode)</b>
            <small>Tab icon shown while the viewer is in light mode.</small>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input
              className="set-input"
              type="url"
              value={faviconLight}
              onChange={(e) => setFaviconLight(e.target.value)}
              placeholder={DEFAULT_FAVICON}
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="btn1"
              onClick={() => void save('favicon_light_url', faviconLight)}
              disabled={savingKey === 'favicon_light_url'}
            >
              {savingKey === 'favicon_light_url' ? 'Saving...' : 'Save'}
            </button>
          </div>
          {faviconLight && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 2 }}>
              <span className="led">Preview</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={faviconLight}
                alt="Favicon light mode preview"
                style={{ width: 24, height: 24, objectFit: 'contain' }}
                onError={(e) => {
                  ;(e.currentTarget as HTMLImageElement).style.display = 'none'
                }}
              />
            </div>
          )}
        </div>

        {/* Favicon (dark) */}
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
            <b>Favicon (dark mode)</b>
            <small>Tab icon shown while the viewer is in dark mode.</small>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input
              className="set-input"
              type="url"
              value={faviconDark}
              onChange={(e) => setFaviconDark(e.target.value)}
              placeholder={DEFAULT_FAVICON}
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="btn1"
              onClick={() => void save('favicon_dark_url', faviconDark)}
              disabled={savingKey === 'favicon_dark_url'}
            >
              {savingKey === 'favicon_dark_url' ? 'Saving...' : 'Save'}
            </button>
          </div>
          {faviconDark && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 2 }}>
              <span className="led">Preview</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={faviconDark}
                alt="Favicon dark mode preview"
                style={{ width: 24, height: 24, objectFit: 'contain' }}
                onError={(e) => {
                  ;(e.currentTarget as HTMLImageElement).style.display = 'none'
                }}
              />
            </div>
          )}
        </div>
      </div>
    </SectionShell>
  )
}
