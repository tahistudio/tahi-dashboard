'use client'

/**
 * The client Settings tab: everything about this client that is configuration
 * rather than a view.
 *
 * The organisation record (with the IC.2 invoicing channel, payment terms, the
 * auto-derive pills and the project manager), the subscription with its
 * add-ons and billing interval, how many tracks they get, their brands, the
 * studio tags, the private notes, the AI health check, and the danger zone.
 *
 * The Overview rail shows the same notes and health card. That is deliberate,
 * not a duplicate: only one tab is mounted at a time, both render the same
 * component, and both write the same endpoint, so there is one implementation
 * and no chance of the two drifting.
 *
 * Two sections the prototype had are deliberately absent, because shipping
 * them would mean inventing columns:
 *   - per-client health rules (quiet / overdue / idle thresholds) has no
 *     column; the rules in lib are the studio defaults for every client;
 *   - the portal-visibility grid belongs to the shipped feature_visibility
 *     system and its /permissions builder, which already owns per-subject
 *     control. Sending a client there beats a second, weaker copy here.
 */

import { useState } from 'react'
import { AlertTriangle, ChevronDown, ExternalLink, ListOrdered, Palette } from 'lucide-react'
import { Card } from '@/components/tahi/card'
import { TahiButton } from '@/components/tahi/tahi-button'
import { AiHealthCheckCard } from '../_kit/ai-health-card'
import { InternalNotesCard } from '../_kit/internal-notes-card'
import { OrgDetailsCard } from '../_kit/org-details-card'
import { NoSubscriptionCard, SubscriptionCard } from '../_kit/subscription-card'
import { TagsCard } from '../_kit/tags-card'
import { TracksConfig } from '../_kit/tracks-config'
import { BrandsTab } from './brands'
import type { Organisation, Subscription, Track } from '../_kit/types'

function parseLegacyBrands(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((b): b is string => typeof b === 'string') : []
  } catch {
    return []
  }
}

function Section({
  icon,
  title,
  description,
  children,
}: {
  icon?: React.ReactNode
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col" style={{ gap: '0.625rem' }}>
      <div className="flex items-start" style={{ gap: '0.5625rem' }}>
        {icon && (
          <span
            aria-hidden="true"
            className="inline-flex items-center justify-center flex-shrink-0"
            style={{
              width: '1.625rem',
              height: '1.625rem',
              borderRadius: 'var(--radius-leaf-sm)',
              background: 'var(--color-bg-secondary)',
              color: 'var(--color-text-muted)',
            }}
          >
            {icon}
          </span>
        )}
        <div className="flex flex-col" style={{ gap: '0.125rem', minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: '0.875rem', fontWeight: 700, color: 'var(--color-text)' }}>{title}</h3>
          {description && (
            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{description}</p>
          )}
        </div>
      </div>
      {children}
    </section>
  )
}

export function SettingsTab({
  clientId,
  org,
  subscription,
  tracks,
  writeDisabled,
  onUpdated,
  onPauseToggle,
  onArchiveToggle,
}: {
  clientId: string
  org: Organisation
  subscription: Subscription | null
  tracks: Track[]
  writeDisabled: boolean
  onUpdated: () => void
  onPauseToggle: () => void
  onArchiveToggle: () => void
}) {
  const [dangerOpen, setDangerOpen] = useState(false)
  const legacyBrands = parseLegacyBrands(org.brands)
  const isPaused = org.status === 'paused'
  const isArchived = org.status === 'archived'

  return (
    <div className="flex flex-col" style={{ gap: '1.5rem' }}>
      <Section title="Organisation details" description="Who they are, how they are billed, and who runs the account.">
        <OrgDetailsCard org={org} onUpdated={onUpdated} />
      </Section>

      <Section title="Subscription" description="The plan, its add-ons, and how often it is billed.">
        {subscription
          ? <SubscriptionCard subscription={subscription} tracks={tracks} orgId={org.id} onUpdated={onUpdated} />
          : <NoSubscriptionCard planType={org.planType} />}
      </Section>

      <Section
        icon={<ListOrdered className="w-3.5 h-3.5" />}
        title="Tracks"
        description="How many parallel slots of work this client has. The lanes themselves are on Overview."
      >
        <Card padding="sm">
          <TracksConfig clientId={clientId} writeDisabled={writeDisabled} />
        </Card>
      </Section>

      <Section
        icon={<Palette className="w-3.5 h-3.5" />}
        title="Brands"
        description="Sub-identities requests can be filed under. Most clients have one."
      >
        {legacyBrands.length > 0 && (
          <Card padding="sm">
            <p style={{ margin: '0 0 0.375rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              Older free-text brand labels on this client, kept read-only while the brands table becomes the single source:
            </p>
            <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-text)' }}>
              {legacyBrands.join(', ')}
            </p>
          </Card>
        )}
        <BrandsTab clientId={clientId} />
      </Section>

      <Section title="Tags" description="Studio labels. The client never sees them; the list filter and saved views do.">
        <TagsCard org={org} onUpdated={onUpdated} />
      </Section>

      <Section title="Studio notes" description="How they like to work, who signs off, what to avoid.">
        <InternalNotesCard org={org} onUpdated={onUpdated} />
      </Section>

      <Section title="AI health check" description="A grounded read on this client from their recent activity. Nothing is applied until you say so.">
        <AiHealthCheckCard org={org} onUpdated={onUpdated} />
      </Section>

      <Section title="Portal visibility" description="What this client can see in their portal.">
        <Card padding="sm">
          <p style={{ margin: '0 0 0.625rem', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
            Per-client visibility is set in the permissions builder, which owns the whole feature tree and its
            templates. Visible means permitted, and anything switched off is not in their nav at all.
          </p>
          <TahiButton
            variant="secondary"
            size="sm"
            onClick={() => window.open('/permissions', '_blank', 'noopener,noreferrer')}
            iconLeft={<ExternalLink className="w-3.5 h-3.5" />}
          >
            Open the permissions builder
          </TahiButton>
        </Card>
      </Section>

      {/* Danger zone */}
      <section className="flex flex-col" style={{ gap: '0.625rem' }}>
        <button
          type="button"
          aria-expanded={dangerOpen}
          aria-controls="client-danger-zone"
          onClick={() => setDangerOpen(v => !v)}
          className="tahi-focus-ring flex items-center text-left"
          style={{
            gap: '0.5625rem',
            minHeight: '2.75rem',
            padding: '0 0.5rem',
            marginLeft: '-0.5rem',
            border: 'none',
            background: 'none',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
          }}
        >
          <span
            aria-hidden="true"
            className="inline-flex items-center justify-center flex-shrink-0"
            style={{
              width: '1.625rem',
              height: '1.625rem',
              borderRadius: 'var(--radius-leaf-sm)',
              background: 'var(--color-danger-bg)',
              color: 'var(--color-danger)',
            }}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
          </span>
          <span className="flex flex-col" style={{ gap: '0.125rem' }}>
            <span style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--color-text)' }}>Danger zone</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              Each of these asks first. Nothing here deletes anything.
            </span>
          </span>
          <ChevronDown
            className="w-4 h-4"
            aria-hidden="true"
            style={{
              marginLeft: 'auto',
              color: 'var(--color-text-muted)',
              transform: dangerOpen ? 'rotate(180deg)' : undefined,
              transition: 'transform var(--motion-base) var(--ease-out)',
            }}
          />
        </button>

        {dangerOpen && (
          <Card id="client-danger-zone" padding="sm" style={{ borderColor: 'var(--color-danger)' }}>
            <div className="flex flex-col" style={{ gap: '0.875rem' }}>
              {subscription && (
                <div className="flex items-start justify-between flex-wrap" style={{ gap: '0.75rem' }}>
                  <div className="flex flex-col" style={{ gap: '0.125rem', minWidth: '12rem', flex: 1 }}>
                    <strong style={{ fontSize: '0.8125rem', color: 'var(--color-text)' }}>
                      {isPaused ? 'Resume the retainer' : 'Pause the retainer'}
                    </strong>
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                      {isPaused
                        ? 'They go back to active and the tracks reopen for work.'
                        : 'Marks the client paused. Open requests keep their place.'}
                    </span>
                  </div>
                  <TahiButton variant="secondary" size="sm" disabled={writeDisabled} onClick={onPauseToggle}>
                    {isPaused ? 'Resume' : 'Pause'}
                  </TahiButton>
                </div>
              )}

              <div className="flex items-start justify-between flex-wrap" style={{ gap: '0.75rem' }}>
                <div className="flex flex-col" style={{ gap: '0.125rem', minWidth: '12rem', flex: 1 }}>
                  <strong style={{ fontSize: '0.8125rem', color: 'var(--color-text)' }}>
                    {isArchived ? 'Unarchive client' : 'Archive client'}
                  </strong>
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                    {isArchived
                      ? `${org.name} reappears in the active client lists.`
                      : `Hides ${org.name} from the active lists. Everything is kept and can come back.`}
                  </span>
                </div>
                <TahiButton
                  variant={isArchived ? 'secondary' : 'danger'}
                  size="sm"
                  disabled={writeDisabled}
                  onClick={onArchiveToggle}
                >
                  {isArchived ? 'Unarchive' : 'Archive'}
                </TahiButton>
              </div>

              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>
                There is no delete. A client is archived, never removed, so their invoices and requests stay in the books.
              </p>
            </div>
          </Card>
        )}
      </section>
    </div>
  )
}
