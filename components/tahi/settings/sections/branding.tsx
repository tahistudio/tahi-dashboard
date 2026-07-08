'use client'

/*
 * Branding settings section (design: `function Branding(){...}` in settings-app.jsx).
 *
 * Section order matches the design: Portal logo (AvatarUpload, 78 rounded),
 * Favicon (AvatarUpload, 52 rounded), Portal name, Primary colour (Presets /
 * Custom hex Seg, six swatches, colour + hex inputs, live preview button).
 *
 * Persistence is real: logo and favicon files go through the existing R2
 * presign -> PUT -> confirm flow (app/api/uploads/*) and the served URL is
 * written into the settings K/V keys the portal reads. Keys:
 *   portal_name, portal_primary_color, portal_logo_url  (consumed by
 *     app/(dashboard)/layout.tsx for client-portal sessions)
 *   favicon_light_url, favicon_dark_url  (super-admin platform asset;
 *     deliberately unwired in the layout, see its TODO)
 */

import { useEffect, useRef, useState } from 'react'
import { useUser } from '@clerk/nextjs'
import { apiPath } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import {
  SectionShell,
  Seg,
  AvatarUpload,
  Toasts,
  useToasts,
} from '@/components/tahi/settings/primitives'

type SettingsMap = Record<string, string | null>

const DEFAULT_COLOR = '#5A824E'
const SWATCHES = ['#5A824E', '#2A6FDB', '#1F8A5B', '#B4531F', '#6D4FA3', '#0E7C86']
const HEX_RE = /^#[0-9a-fA-F]{6}$/
const LEDE = 'How your portal looks to clients - logo, name and accent.'

// Favicon is a platform-level (Tahi) asset, so only super admins may change it.
const SUPER_ADMIN_EMAILS = new Set(['business@tahi.studio', 'staci@tahi.studio'])

type AssetKind = 'logo' | 'fav_light' | 'fav_dark'

const ASSET_KEYS: Record<AssetKind, string> = {
  logo: 'portal_logo_url',
  fav_light: 'favicon_light_url',
  fav_dark: 'favicon_dark_url',
}

interface PresignResponse {
  uploadUrl: string
  storageKey: string
  fileId: string
}

function SkeletonCard() {
  const bar = (w: string, h: number, mt = 0) => (
    <div
      className="animate-pulse"
      style={{ height: h, width: w, borderRadius: 6, background: 'var(--bg-tertiary)', marginTop: mt }}
    />
  )
  return (
    <div className="set-card">
      <div className="av-row">
        <div
          className="animate-pulse"
          style={{ width: 78, height: 78, borderRadius: 18, background: 'var(--bg-tertiary)', flexShrink: 0 }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          {bar('30%', 13)}
          {bar('62%', 11, 7)}
        </div>
      </div>
      <div className="av-row" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <div
          className="animate-pulse"
          style={{ width: 52, height: 52, borderRadius: 18, background: 'var(--bg-tertiary)', flexShrink: 0 }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          {bar('24%', 13)}
          {bar('52%', 11, 7)}
        </div>
      </div>
      <div className="set-grid2" style={{ gridTemplateColumns: '1fr', borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
        <div className="set-field">
          {bar('22%', 13)}
          {bar('100%', 40, 8)}
        </div>
      </div>
    </div>
  )
}

export function BrandingSection({ isAdmin }: { isAdmin?: boolean } = {}) {
  const { data, isLoading, mutate } = useResource<{ settings: SettingsMap }>(
    isAdmin === false ? null : '/api/admin/settings',
  )
  const settings = data?.settings
  const { toasts, toast } = useToasts()

  const [portalName, setPortalName] = useState('')
  const [color, setColor] = useState(DEFAULT_COLOR)
  const [hexMode, setHexMode] = useState(false)
  const [hex, setHex] = useState(DEFAULT_COLOR)
  const [logoUrl, setLogoUrl] = useState('')
  const [faviconLight, setFaviconLight] = useState('')
  const [faviconDark, setFaviconDark] = useState('')
  const [busy, setBusy] = useState<AssetKind | null>(null)

  const { user } = useUser()
  const email = user?.primaryEmailAddress?.emailAddress?.toLowerCase() ?? null
  const isSuperAdmin = email ? SUPER_ADMIN_EMAILS.has(email) : false

  // Seed the editors ONCE from the loaded settings. Later mutate() refreshes
  // must not clobber text the admin is mid-way through typing.
  const seeded = useRef(false)
  useEffect(() => {
    if (!settings || seeded.current) return
    seeded.current = true
    const c = settings['portal_primary_color'] ?? DEFAULT_COLOR
    setPortalName(settings['portal_name'] ?? '')
    setColor(HEX_RE.test(c) ? c : DEFAULT_COLOR)
    setHex(HEX_RE.test(c) ? c : DEFAULT_COLOR)
    setLogoUrl(settings['portal_logo_url'] ?? '')
    setFaviconLight(settings['favicon_light_url'] ?? '')
    setFaviconDark(settings['favicon_dark_url'] ?? '')
  }, [settings])

  async function save(key: string, value: string, okMsg?: string): Promise<boolean> {
    try {
      const res = await fetch(apiPath('/api/admin/settings'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      })
      if (!res.ok) throw new Error('save failed')
      await mutate()
      if (okMsg) toast(okMsg)
      return true
    } catch {
      toast('Could not save branding', 'err')
      return false
    }
  }

  // Debounced colour persistence: the native colour picker fires change
  // continuously while dragging, so writes coalesce; blur flushes immediately
  // so switching sections can never lose the chosen colour.
  const colorTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingColor = useRef<string | null>(null)
  useEffect(
    () => () => {
      if (colorTimer.current) clearTimeout(colorTimer.current)
    },
    [],
  )
  function queueColorSave(c: string) {
    pendingColor.current = c
    if (colorTimer.current) clearTimeout(colorTimer.current)
    colorTimer.current = setTimeout(() => {
      colorTimer.current = null
      const v = pendingColor.current
      pendingColor.current = null
      if (v) void save('portal_primary_color', v, 'Primary colour saved')
    }, 600)
  }
  function flushColorSave() {
    if (colorTimer.current) {
      clearTimeout(colorTimer.current)
      colorTimer.current = null
    }
    const v = pendingColor.current
    pendingColor.current = null
    if (v) void save('portal_primary_color', v, 'Primary colour saved')
  }
  // Immediate commit (swatch clicks): drop any queued hex save so a stale
  // debounced value can never overwrite the click.
  function saveColorNow(c: string) {
    if (colorTimer.current) {
      clearTimeout(colorTimer.current)
      colorTimer.current = null
    }
    pendingColor.current = null
    void save('portal_primary_color', c, 'Primary colour saved')
  }

  // R2 upload: presign -> PUT to the proxy URL -> confirm metadata -> store
  // the authenticated serve URL in the matching settings key.
  async function uploadAsset(kind: AssetKind, file: File) {
    setBusy(kind)
    try {
      const presignRes = await fetch(apiPath('/api/uploads/presign'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          requestId: 'branding',
        }),
      })
      if (!presignRes.ok) throw new Error('presign failed')
      const { uploadUrl, storageKey, fileId } = (await presignRes.json()) as PresignResponse

      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
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
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
        }),
      })
      if (!confirmRes.ok) throw new Error('confirm failed')

      const servedUrl = apiPath('/api/uploads/serve?key=' + encodeURIComponent(storageKey))
      const ok = await save(
        ASSET_KEYS[kind],
        servedUrl,
        kind === 'logo' ? 'Portal logo updated' : 'Favicon updated',
      )
      if (ok) {
        if (kind === 'logo') setLogoUrl(servedUrl)
        if (kind === 'fav_light') setFaviconLight(servedUrl)
        if (kind === 'fav_dark') setFaviconDark(servedUrl)
      }
    } catch {
      toast('Upload failed', 'err')
    } finally {
      setBusy(null)
    }
  }

  async function removeAsset(kind: AssetKind) {
    const ok = await save(
      ASSET_KEYS[kind],
      '',
      kind === 'logo' ? 'Portal logo removed' : 'Favicon removed',
    )
    if (ok) {
      if (kind === 'logo') setLogoUrl('')
      if (kind === 'fav_light') setFaviconLight('')
      if (kind === 'fav_dark') setFaviconDark('')
    }
  }

  if (isAdmin === false) return null

  if (isLoading && !settings) {
    return (
      <SectionShell title="Branding" lede={LEDE}>
        <SkeletonCard />
      </SectionShell>
    )
  }

  return (
    <SectionShell title="Branding" lede={LEDE}>
      <div className="set-card">
        {/* Portal logo */}
        <div className="av-row">
          <AvatarUpload
            value={logoUrl || null}
            initials="TS"
            onFile={(f) => void uploadAsset('logo', f)}
            onRemove={() => void removeAsset('logo')}
            size={78}
            shape="rounded"
            busy={busy === 'logo'}
            ariaLabel="Upload portal logo"
          />
          <div className="av-row-t">
            <b>Portal logo</b>
            <small>
              Shown in the client portal header and on shared documents. SVG or PNG with a
              transparent background.
            </small>
          </div>
        </div>

        {/* Favicon - platform-level Tahi asset: super admins only. */}
        {isSuperAdmin && (
          <>
            <div className="av-row" style={{ borderTop: '1px solid var(--border-subtle)' }}>
              <AvatarUpload
                value={faviconLight || null}
                initials="T"
                onFile={(f) => void uploadAsset('fav_light', f)}
                onRemove={() => void removeAsset('fav_light')}
                size={52}
                shape="rounded"
                busy={busy === 'fav_light'}
                ariaLabel="Upload favicon for light mode"
              />
              <div className="av-row-t">
                <b>Favicon (light mode)</b>
                <small>The icon in the browser tab. Square, at least 64×64px.</small>
              </div>
            </div>
            <div className="av-row" style={{ borderTop: '1px solid var(--border-subtle)' }}>
              <AvatarUpload
                value={faviconDark || null}
                initials="T"
                onFile={(f) => void uploadAsset('fav_dark', f)}
                onRemove={() => void removeAsset('fav_dark')}
                size={52}
                shape="rounded"
                busy={busy === 'fav_dark'}
                ariaLabel="Upload favicon for dark mode"
              />
              <div className="av-row-t">
                <b>Favicon (dark mode)</b>
                <small>Shown when the browser tab is dark. Square, at least 64×64px.</small>
              </div>
            </div>
          </>
        )}

        {/* Portal name */}
        <div
          className="set-grid2"
          style={{ gridTemplateColumns: '1fr', borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}
        >
          <div className="set-field">
            <label htmlFor="branding-portal-name">Portal name</label>
            <input
              id="branding-portal-name"
              className="set-input"
              value={portalName}
              onChange={(e) => setPortalName(e.target.value)}
              onBlur={() => {
                const savedVal = settings?.['portal_name'] ?? ''
                if (portalName !== savedVal) {
                  void save('portal_name', portalName, 'Portal name saved')
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
              placeholder="Tahi Studio"
            />
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
                    saveColorNow(c)
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
                  queueColorSave(e.target.value)
                }}
                onBlur={flushColorSave}
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
                  if (HEX_RE.test(v)) {
                    setColor(v)
                    queueColorSave(v)
                  }
                }}
                onBlur={flushColorSave}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
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
      </div>
      <Toasts toasts={toasts} />
    </SectionShell>
  )
}
