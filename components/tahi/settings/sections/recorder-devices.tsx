'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '@clerk/nextjs'
import { Laptop, Plus, RefreshCw, ShieldCheck } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import { usePermissions } from '@/components/tahi/permissions-context'
import { TahiButton } from '@/components/tahi/tahi-button'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { SectionShell } from '@/components/tahi/settings/primitives'

interface RecorderDevice {
  id: string
  name: string
  createdAt: string
  lastSeenAt: string | null
  revokedAt: string | null
  revokedReason: string | null
}

interface PairingCode {
  code: string
  expiresAt: string
}

const CARD: CSSProperties = {
  border: '0.0625rem solid var(--color-border)', borderRadius: 'var(--radius-md)',
  background: 'var(--color-bg)', padding: '1rem', minWidth: 0,
}
const BUTTON: CSSProperties = { minHeight: '2.75rem' }
const LEDE = 'Pair the Windows tray recorder with your account. Only your paired devices appear here.'

function dateLabel(value: string): string {
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Unknown'
}

async function readResponse(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json()
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('The server returned an invalid response. Try again.')
  const payload = body as Record<string, unknown>
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Could not save this change. Try again.')
  return payload
}

export function RecorderDevicesSection({ isAdmin = false }: { isAdmin?: boolean } = {}) {
  const permissions = usePermissions()
  const session = useAuth()
  const canManage = isAdmin && permissions.isAdmin
  const canPair = canManage && session.isLoaded && session.isSignedIn && !!session.sessionId
  const [pairing, setPairing] = useState<PairingCode | null>(null)
  const [pairingBusy, setPairingBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<RecorderDevice | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const expired = !!pairing && Date.parse(pairing.expiresAt) <= now
  const { data, error, isLoading, mutate } = useResource<{ items: RecorderDevice[] }>(
    canManage ? '/api/admin/recorder-devices' : null,
    { refreshInterval: pairing && !expired ? 15_000 : 0 },
  )

  useEffect(() => {
    if (!pairing || expired) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [pairing, expired])

  if (!canManage) return null

  const createCode = async () => {
    if (!canPair || pairingBusy) return
    setPairingBusy(true)
    setActionError(null)
    setNotice(null)
    setPairing(null)
    try {
      const payload = await readResponse(await fetch(apiPath('/api/admin/recorder-devices/pairing-code'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      }))
      if (typeof payload.code !== 'string' || typeof payload.expiresAt !== 'string' || !Number.isFinite(Date.parse(payload.expiresAt))) {
        throw new Error('Could not read the pairing code. Try again.')
      }
      setNow(Date.now())
      setPairing({ code: payload.code, expiresAt: payload.expiresAt })
    } catch (failure) {
      setActionError(failure instanceof Error ? failure.message : 'Could not create a pairing code. Try again.')
    } finally {
      setPairingBusy(false)
    }
  }

  const revoke = async () => {
    if (!revoking) return
    setActionError(null)
    setNotice(null)
    try {
      await readResponse(await fetch(apiPath(`/api/admin/recorder-devices/${encodeURIComponent(revoking.id)}/revoke`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      }))
      setNotice(`${revoking.name} was revoked. Its uploads are now blocked.`)
      setRevoking(null)
      await mutate()
    } catch (failure) {
      setActionError(failure instanceof Error ? failure.message : 'Could not revoke this device. Try again.')
      setRevoking(null)
    }
  }

  return (
    <SectionShell title="Recorder devices" lede={LEDE}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem', maxWidth: '36rem' }}>
          Pairing codes work once and expire after 10 minutes. Enter the code in the recorder on your Windows computer.
        </p>
        <TahiButton onClick={createCode} loading={pairingBusy} disabled={!canPair} iconLeft={<Plus aria-hidden="true" style={{ width: '1rem', height: '1rem' }} />} style={BUTTON}>
          Pair a device
        </TahiButton>
      </div>
      {!canPair && <p role="status" className="mb-4" style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>Sign in with your admin account to create a pairing code.</p>}
      {actionError && <p role="alert" className="mb-4" style={{ color: 'var(--color-danger-ink)', overflowWrap: 'anywhere' }}>{actionError}</p>}
      {notice && <p role="status" className="mb-4" style={{ color: 'var(--color-text-muted)', overflowWrap: 'anywhere' }}>{notice}</p>}
      {pairing && (
        <div role="status" aria-live="polite" className="mb-4" style={{ ...CARD, background: 'var(--color-bg-secondary)' }}>
          {expired ? (
            <p style={{ color: 'var(--color-text-muted)' }}>This pairing code has expired. Select Pair a device for a new code.</p>
          ) : (
            <>
              <p style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem', marginBottom: '0.5rem' }}>Your single-use pairing code</p>
              <output aria-label="Pairing code" style={{ display: 'block', color: 'var(--color-text)', fontSize: 'clamp(1.25rem, 5vw, 1.75rem)', fontWeight: 700, letterSpacing: '0.18em', overflowWrap: 'anywhere' }}>{pairing.code}</output>
              <p style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem', marginTop: '0.5rem' }}>Expires {dateLabel(pairing.expiresAt)}. Keep this code private.</p>
            </>
          )}
        </div>
      )}
      {isLoading ? (
        <div role="status" aria-label="Loading recorder devices" className="space-y-3">
          {[0, 1].map(index => <div key={index} className="animate-pulse" style={{ ...CARD, height: '6rem', background: 'var(--color-bg-secondary)' }} />)}
          <span className="sr-only">Loading recorder devices</span>
        </div>
      ) : error ? (
        <div role="alert" style={CARD}>
          <p style={{ color: 'var(--color-text)', fontWeight: 600 }}>Could not load recorder devices</p>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem', margin: '0.5rem 0 1rem' }}>Your devices could not be checked. Try loading them again.</p>
          <TahiButton variant="secondary" onClick={() => { void mutate() }} iconLeft={<RefreshCw aria-hidden="true" style={{ width: '1rem', height: '1rem' }} />} style={BUTTON}>Try again</TahiButton>
        </div>
      ) : !data?.items.length ? (
        <div style={{ ...CARD, textAlign: 'center', padding: '2rem 1rem' }}>
          <span aria-hidden="true" style={{ display: 'inline-flex', padding: '0.875rem', marginBottom: '0.875rem', borderRadius: 'var(--radius-leaf)', background: 'var(--gradient-leaf-icon)', color: 'var(--color-text-on-dark)' }}><Laptop style={{ width: '1.5rem', height: '1.5rem' }} /></span>
          <h3 style={{ color: 'var(--color-text)', fontSize: '1rem', fontWeight: 600 }}>No recorder devices yet</h3>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem', marginTop: '0.5rem' }}>Pair your Windows computer to start recording calls from the tray.</p>
        </div>
      ) : (
        <ul aria-label="Your recorder devices" className="space-y-3" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {data.items.map(device => (
            <li key={device.id} style={CARD} className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="flex flex-wrap items-center gap-2">
                  <Laptop aria-hidden="true" style={{ width: '1rem', height: '1rem', color: 'var(--color-text-muted)', flexShrink: 0 }} />
                  <h3 style={{ color: 'var(--color-text)', fontSize: '0.9375rem', fontWeight: 600, overflowWrap: 'anywhere', minWidth: 0 }}>{device.name}</h3>
                  {device.revokedAt && <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-sm)', padding: '0.25rem 0.5rem' }}>Revoked</span>}
                </div>
                <dl className="flex flex-wrap gap-x-5 gap-y-1" style={{ marginTop: '0.5rem', color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>
                  <div><dt className="inline">Last seen: </dt><dd className="inline">{device.lastSeenAt ? dateLabel(device.lastSeenAt) : 'Not yet seen'}</dd></div>
                  <div><dt className="inline">Paired: </dt><dd className="inline">{dateLabel(device.createdAt)}</dd></div>
                </dl>
              </div>
              {device.revokedAt ? (
                <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>Revoked {dateLabel(device.revokedAt)}</span>
              ) : (
                <TahiButton variant="secondary" onClick={() => setRevoking(device)} aria-label={`Revoke ${device.name}`} style={BUTTON}>Revoke</TahiButton>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="flex items-start gap-2 mt-4" style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}><ShieldCheck aria-hidden="true" style={{ width: '1rem', height: '1rem', flexShrink: 0 }} />Revoke a lost or unused device to stop its uploads immediately. Devices expire after 30 days without use.</p>
      {revoking && typeof document !== 'undefined' && createPortal(
        <ConfirmDialog open title="Revoke recorder device?" description={`This stops ${revoking.name} from uploading recordings. Pair it again to restore access.`} confirmLabel="Revoke device" onConfirm={revoke} onCancel={() => setRevoking(null)} />,
        document.body,
      )}
    </SectionShell>
  )
}
