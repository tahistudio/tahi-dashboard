'use client'

/**
 * <ClientSignalTiles>. The three-up hero strip on the client Overview:
 * health, open requests, monthly recurring. Moved out of client-detail.tsx
 * unchanged.
 */

import { useDisplayCurrency } from '@/lib/display-currency-context'
import { FeatureCard } from '@/components/tahi/feature-card'
import type { Contact, Organisation, Request, Subscription } from './types'

// ── Client-level signal tiles (Overview hero strip) ────────────────────────────

/** Map a request status into a stable bucket for the donut + summary tiles. */
export function bucketRequestStatus(status: string): 'open' | 'review' | 'done' | 'other' {
  const s = status.toLowerCase()
  if (s === 'delivered' || s === 'completed' || s === 'closed' || s === 'cancelled') return 'done'
  if (s === 'client_review' || s === 'client review' || s === 'in_review' || s === 'review') return 'review'
  if (s === 'submitted' || s === 'in_progress' || s === 'in progress' || s === 'on_hold' || s === 'on hold') return 'open'
  return 'other'
}

const HEALTH_TILE: Record<string, { label: string; description: string; dot: string; tone: 'positive' | 'warning' | 'danger' | 'neutral' }> = {
  green:  { label: 'Healthy',     description: 'Engagement is on track. No red flags surfaced.',                     dot: '#22C55E', tone: 'positive' },
  amber:  { label: 'Watch',       description: 'Mixed signals. Worth a quick check-in with the client this week.',  dot: '#F59E0B', tone: 'warning'  },
  red:    { label: 'At risk',     description: 'Action needed soon - surface to the lead and agree a next step.',    dot: '#EF4444', tone: 'danger'   },
}

export function ClientSignalTiles({
  org,
  contacts,
  subscription,
  recentRequests,
}: {
  org: Organisation
  contacts: Contact[]
  subscription: Subscription | null
  recentRequests: Request[]
}) {
  const { displayCurrency, formatNativeWithDisplay } = useDisplayCurrency()
  const openRequests = recentRequests.filter(r => bucketRequestStatus(r.status) !== 'done').length
  const reviewRequests = recentRequests.filter(r => bucketRequestStatus(r.status) === 'review').length

  const healthKey = (org.healthStatus ?? '').toLowerCase()
  const health = HEALTH_TILE[healthKey] ?? { label: 'Unset', description: 'No health signal recorded yet for this client.', dot: '#9CA3AF', tone: 'neutral' as const }

  const primaryContact = contacts.find(c => c.isPrimary) ?? contacts[0] ?? null

  const mrrCurrency = org.preferredCurrency ?? displayCurrency ?? 'NZD'
  const mrrDisplay = org.customMrr != null
    ? formatNativeWithDisplay(org.customMrr, mrrCurrency)
    : null

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* Health tile (cream + signal dot) */}
      <FeatureCard variant="cream" padding="md">
        <FeatureCard.Eyebrow>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4375rem' }}>
            <span
              aria-hidden="true"
              style={{
                width: '0.5rem',
                height: '0.5rem',
                borderRadius: '9999px',
                background: health.dot,
                display: 'inline-block',
              }}
            />
            Client health
          </span>
        </FeatureCard.Eyebrow>
        <FeatureCard.Title style={{ fontSize: '1.375rem' }}>{health.label}</FeatureCard.Title>
        <FeatureCard.Description>{health.description}</FeatureCard.Description>
      </FeatureCard>

      {/* Open requests tile (forest, eye-catching when there's load) */}
      <FeatureCard variant={openRequests > 0 ? 'forest' : 'cream'} padding="md">
        <FeatureCard.Eyebrow>Open requests</FeatureCard.Eyebrow>
        <FeatureCard.Title style={{ fontSize: '2rem', letterSpacing: '-0.02em' }}>
          {openRequests}
        </FeatureCard.Title>
        <FeatureCard.Description>
          {openRequests === 0
            ? 'No active requests on the board right now.'
            : reviewRequests > 0
              ? `${reviewRequests} waiting on client review.`
              : 'All active work is in flight with the team.'}
        </FeatureCard.Description>
      </FeatureCard>

      {/* MRR / billing tile */}
      <FeatureCard variant="cream" padding="md">
        <FeatureCard.Eyebrow>Monthly recurring</FeatureCard.Eyebrow>
        <FeatureCard.Title style={{ fontSize: '1.625rem' }}>
          <span data-private>{mrrDisplay ?? (subscription ? 'On retainer' : 'Not set')}</span>
        </FeatureCard.Title>
        <FeatureCard.Description>
          {subscription
            ? `${subscription.planType.charAt(0).toUpperCase()}${subscription.planType.slice(1)} plan · ${subscription.status}`
            : primaryContact
              ? <>Primary contact: <span data-private>{primaryContact.name}</span></>
              : 'No active subscription on record.'}
        </FeatureCard.Description>
      </FeatureCard>
    </div>
  )
}
