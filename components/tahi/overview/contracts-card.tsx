'use client'

// ─── Contracts card (CLIENTS / OPS zone) ─────────────────────────────────────
//
// Domain OPS: deliberately ACHROMATIC warm ink. Contracts are admin plumbing,
// not a colour story; the card's ONLY colour is a semantic warning-amber pulse
// on near-expiry rows (under 14 days). Everything else is ink + the ops tint
// IconChip identity. Two groups:
//
//   AWAITING SIGNATURE  (status 'sent' | 'draft')
//   EXPIRING SOON       (expiresAt within ~30 days)
//
// Each row: contract name + orgName (data-private) + a live expiry countdown
// driven by the page-wide useSharedTick(1000), with a semantic amber pulse dot
// when under 14 days.
//
// Source: /api/admin/contracts -> { items: [{ id, name, status, orgName,
// sentAt, expiresAt, ... }] }. The route MAY later return signedCount +
// totalSigners per item; when present we render a segmented signer-progress bar
// (0 -> signed/total on reveal). Today the route does NOT return those fields,
// so the bar is skipped gracefully.
//
// When there are multiple AWAITING-SIGNATURE contracts we present them in a
// peek-behind CardDeck; otherwise a single row. EXPIRING SOON is always a list.
//
// Reduced-motion safe: the amber pulse + segment grow live behind
// prefers-reduced-motion (CSS), the countdown is information (the only resting
// movement the page budget allows) via the shared tick.

import { useEffect, useState } from 'react'
import { FileSignature } from 'lucide-react'
import { DomainCard, IconChip } from './domain-card'
import { CardDeck } from '@/components/tahi/card-deck'
import { useSharedTick, useReveal } from '@/lib/use-homepage-motion'
import { apiPath } from '@/lib/api'

interface Contract {
  id: string
  name: string
  status: string
  orgName: string | null
  sentAt: string | null
  expiresAt: string | null
  // Optional: only present once the endpoint aggregates signers. Rendered
  // gracefully when absent.
  signedCount?: number
  totalSigners?: number
}

const DAY_MS = 24 * 60 * 60 * 1000
const EXPIRING_WINDOW_DAYS = 30
const URGENT_DAYS = 14

const SHELL: React.CSSProperties = {
  background: 'var(--color-bg)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 'var(--space-6)',
}

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 'var(--text-2xs, 0.6875rem)',
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--color-text-subtle)',
}

const GROUP_LABEL_STYLE: React.CSSProperties = {
  fontSize: 'var(--text-2xs, 0.6875rem)',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--color-text-subtle)',
}

export function ContractsCard({ className }: { className?: string }) {
  const [contracts, setContracts] = useState<Contract[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch(apiPath('/api/admin/contracts'))
      .then(r => (r.ok ? (r.json() as Promise<{ items: Contract[] }>) : { items: [] }))
      .then(data => {
        if (cancelled) return
        setContracts(data.items ?? [])
      })
      .catch(() => {
        if (!cancelled) setContracts([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <section aria-label="Contracts" className={className} style={SHELL}>
        <Header />
        <div className="tahi-shimmer" style={{ height: '2.5rem', marginBottom: 'var(--space-3)' }} />
        <div className="tahi-shimmer" style={{ height: '2.5rem', width: '80%' }} />
      </section>
    )
  }

  const awaiting = contracts.filter(c => c.status === 'sent' || c.status === 'draft')

  const now = Date.now()
  const expiringSoon = contracts
    .filter(c => {
      if (!c.expiresAt) return false
      const t = new Date(c.expiresAt).getTime()
      if (Number.isNaN(t)) return false
      const days = (t - now) / DAY_MS
      return days >= 0 && days <= EXPIRING_WINDOW_DAYS
    })
    .sort((a, b) => new Date(a.expiresAt as string).getTime() - new Date(b.expiresAt as string).getTime())

  // Empty: nothing to chase. Calm single line.
  if (awaiting.length === 0 && expiringSoon.length === 0) {
    return (
      <section aria-label="Contracts" className={className} style={SHELL}>
        <Header />
        <p style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-muted)', lineHeight: 1.55 }}>
          Nothing awaiting signature and nothing expiring soon. Sent and expiring contracts surface here.
        </p>
      </section>
    )
  }

  return (
    <DomainCard
      domain="ops"
      title="Contracts"
      icon={<FileSignature size={15} />}
      viewHref="/clients"
    >
      {/* AWAITING SIGNATURE */}
      {awaiting.length > 0 && (
        <div style={{ marginBottom: expiringSoon.length > 0 ? 'var(--space-5)' : 0 }}>
          <GroupHeader label="Awaiting signature" count={awaiting.length} />
          {awaiting.length > 1 ? (
            <CardDeck
              items={awaiting}
              getKey={(c) => c.id}
              ariaLabel="Contracts awaiting signature"
              minHeight="4.25rem"
              accentColor="var(--domain-ops)"
              renderCard={(c) => <AwaitingRow contract={c} />}
            />
          ) : (
            <AwaitingRow contract={awaiting[0]} />
          )}
        </div>
      )}

      {/* EXPIRING SOON */}
      {expiringSoon.length > 0 && (
        <div style={{ marginTop: awaiting.length > 0 ? 'var(--space-1)' : 0 }}>
          <GroupHeader label="Expiring soon" count={expiringSoon.length} />
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {expiringSoon.slice(0, 4).map(c => (
              <li key={c.id}>
                <ExpiringRow contract={c} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </DomainCard>
  )
}

// ── Awaiting-signature row ────────────────────────────────────────────────────

function AwaitingRow({ contract }: { contract: Contract }) {
  const hasSignerProgress =
    typeof contract.signedCount === 'number' &&
    typeof contract.totalSigners === 'number' &&
    (contract.totalSigners as number) > 0

  return (
    <div style={{ padding: 'var(--space-2) 0', minWidth: 0 }}>
      <div className="flex items-baseline justify-between" style={{ gap: 'var(--space-3)' }}>
        <div style={{ minWidth: 0 }}>
          <p
            data-private
            className="truncate"
            style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text)', minWidth: 0 }}
          >
            {contract.name}
          </p>
          {contract.orgName && (
            <p data-private className="truncate" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: '0.0625rem' }}>
              {contract.orgName}
            </p>
          )}
        </div>
        <span
          className="flex items-center"
          style={{
            gap: 'var(--space-1)',
            padding: '0.0625rem 0.4375rem',
            borderRadius: 'var(--radius-full)',
            background: 'var(--color-bg-secondary)',
            color: 'var(--color-text-muted)',
            fontSize: 'var(--text-2xs, 0.6875rem)',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {contract.status === 'sent' ? 'Sent' : 'Draft'}
        </span>
      </div>

      {/* Signer-progress bar: only when the endpoint supplies the counts. */}
      {hasSignerProgress && (
        <SignerProgress signed={contract.signedCount as number} total={contract.totalSigners as number} />
      )}
    </div>
  )
}

// ── Expiring-soon row ─────────────────────────────────────────────────────────

function ExpiringRow({ contract }: { contract: Contract }) {
  // Subscribe to the page-wide 1s tick so the countdown stays live without a
  // private interval. The tick value is unused directly; reading it forces the
  // re-render each second.
  useSharedTick(1000)

  const expiresAt = contract.expiresAt ? new Date(contract.expiresAt).getTime() : null
  const now = Date.now()
  const msLeft = expiresAt !== null ? expiresAt - now : null
  const daysLeft = msLeft !== null ? msLeft / DAY_MS : null
  const urgent = daysLeft !== null && daysLeft <= URGENT_DAYS

  return (
    <div className="flex items-center justify-between" style={{ gap: 'var(--space-3)', padding: 'var(--space-1-5) 0', minWidth: 0 }}>
      <div className="flex items-center" style={{ gap: 'var(--space-2)', minWidth: 0 }}>
        {/* Semantic amber dot when under 14 days; otherwise a quiet neutral tick. */}
        <span
          aria-hidden="true"
          className={urgent ? 'tahi-warn-dot' : undefined}
          style={{
            width: '0.4375rem',
            height: '0.4375rem',
            borderRadius: 'var(--radius-full)',
            background: urgent ? 'var(--color-warning)' : 'var(--color-border-strong)',
            flexShrink: 0,
          }}
        />
        <div style={{ minWidth: 0 }}>
          <p data-private className="truncate" style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--color-text)', minWidth: 0 }}>
            {contract.name}
          </p>
          {contract.orgName && (
            <p data-private className="truncate" style={{ fontSize: 'var(--text-2xs, 0.6875rem)', color: 'var(--color-text-subtle)' }}>
              {contract.orgName}
            </p>
          )}
        </div>
      </div>
      <span
        className="tabular-nums"
        style={{
          fontSize: 'var(--text-xs)',
          fontWeight: 600,
          color: urgent ? 'color-mix(in oklab, var(--color-warning) 62%, var(--color-text))' : 'var(--color-text-muted)',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        {formatCountdown(msLeft)}
      </span>
    </div>
  )
}

// ── Signer-progress segmented bar ─────────────────────────────────────────────
//
// Renders only when the endpoint supplies signedCount + totalSigners. A row of
// `total` segments; `signed` fill in (ops ink), the rest read as track. Grows
// 0 -> signed on reveal via .tahi-segment-fill / useReveal.

function SignerProgress({ signed, total }: { signed: number; total: number }) {
  const { ref, inView } = useReveal<HTMLDivElement>()
  const safeSigned = Math.max(0, Math.min(signed, total))

  return (
    <div ref={ref} style={{ marginTop: 'var(--space-2)' }}>
      <div className="flex items-center" style={{ gap: 'var(--space-1)' }} aria-hidden="true">
        {Array.from({ length: total }, (_, i) => {
          const isSigned = inView && i < safeSigned
          return (
            <span
              key={i}
              className="tahi-segment-fill"
              style={{
                flex: 1,
                height: '0.3125rem',
                borderRadius: 'var(--radius-full)',
                background: isSigned ? 'var(--domain-ops)' : 'var(--color-bg-tertiary)',
              }}
            />
          )
        })}
      </div>
      <p className="tabular-nums" style={{ fontSize: 'var(--text-2xs, 0.6875rem)', color: 'var(--color-text-subtle)', marginTop: 'var(--space-1-5)' }}>
        {safeSigned} of {total} signed
      </p>
    </div>
  )
}

// ── Countdown formatting ──────────────────────────────────────────────────────
//
// Human countdown to expiry. Days when far out, hours + minutes when close,
// minutes + seconds in the final hour (the shared 1s tick keeps it live).

function formatCountdown(msLeft: number | null): string {
  if (msLeft === null) return 'no expiry'
  if (msLeft <= 0) return 'expired'

  const totalSeconds = Math.floor(msLeft / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (days >= 1) {
    return `${days}d ${hours}h`
  }
  if (hours >= 1) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m ${seconds}s`
}

// ── Group header ──────────────────────────────────────────────────────────────

function GroupHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-baseline justify-between" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-2-5)' }}>
      <span style={GROUP_LABEL_STYLE}>{label}</span>
      <span className="tabular-nums" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}>
        {count}
      </span>
    </div>
  )
}

// ── Letterpress zone header (loading + empty states) ──────────────────────────

function Header() {
  return (
    <div className="flex items-center" style={{ gap: 'var(--space-2-5)', marginBottom: 'var(--space-5)' }}>
      <IconChip domain="ops"><FileSignature size={15} /></IconChip>
      <h2 style={LABEL_STYLE}>Contracts</h2>
    </div>
  )
}
