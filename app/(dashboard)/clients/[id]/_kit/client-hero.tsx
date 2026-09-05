'use client'

/**
 * <ClientHero>. Who this client is, and how the account is doing, above the
 * tab strip.
 *
 * Left: the name, the status when it is not simply "active", the studio tags,
 * a meta line, and the brand chips. Right: the stat cells that answer the
 * questions someone opens this page with. Plan and tracks are spelled out
 * in words ("Scale, 1 of 2 tracks busy") rather than left as a bare meter,
 * because the meter alone does not say what it is measuring.
 *
 * The brand chips come from the brands table, which is what Settings edits and
 * what requests are filed under. The organisations.brands JSON column is the
 * deprecated store and Settings renders it as a read-only footnote, so reading
 * it here would show names nothing in the UI can change, and hide the ones it
 * can. The strip's column count follows the number of cells actually rendered,
 * since MRR drops out for a seat without the billing card.
 *
 * MRR is admin-only: it is gated on clients.billing_card, the same key the
 * profitability and costs routes enforce server-side.
 */

import { useMemo } from 'react'
import {
  CalendarDays,
  ChevronDown,
  Eye,
  Globe,
  Handshake,
  Loader2,
  Mail,
  MoreHorizontal,
  Pause,
  Play,
  RefreshCw,
  Settings,
  Receipt,
  Trash2,
  User,
} from 'lucide-react'
import { Avatar } from '@/components/tahi/avatar'
import { Badge, type BadgeTone } from '@/components/tahi/badge'
import { Menu } from '@/components/tahi/menu'
import { Money } from '@/components/tahi/money'
import { PlanBadge, StatusBadge } from '@/components/tahi/status-badge'
import { TahiButton } from '@/components/tahi/tahi-button'
import { Tooltip } from '@/components/tahi/tooltip'
import { formatDate } from '@/lib/utils'
import { InlineAction } from './chrome'
import type { ClientTabId, Contact, Organisation, Subscription, Track } from './types'
import type { TeamMemberPm } from './org-details-card'

const HEALTH_META: Record<string, { label: string; tone: BadgeTone }> = {
  green: { label: 'Healthy', tone: 'positive' },
  amber: { label: 'Watch', tone: 'warning' },
  red: { label: 'At risk', tone: 'danger' },
}

export interface HeroCall {
  id: string
  title: string
  scheduledAt: string
}

/** A row of /api/admin/brands, the source of truth the Settings tab edits. */
export interface HeroBrand {
  id: string
  name: string
  primaryColour: string | null
}

/** A stat cell. No side borders: the strip is one card, the cells are spacing. */
function Stat({
  label,
  value,
  sub,
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
}) {
  return (
    <div className="flex flex-col" style={{ gap: '0.3125rem', minWidth: 0, padding: '0.125rem 0' }}>
      <span
        className="uppercase"
        style={{ fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.05em', color: 'var(--color-text-subtle)' }}
      >
        {label}
      </span>
      <span className="flex items-center" style={{ gap: '0.375rem', minHeight: '1.5rem', minWidth: 0, fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text)' }}>
        {value}
      </span>
      {sub != null && (
        <span
          className="flex items-center"
          style={{ gap: '0.375rem', minWidth: 0, fontSize: '0.75rem', fontWeight: 500, color: 'var(--color-text-subtle)' }}
        >
          {sub}
        </span>
      )}
    </div>
  )
}

function parseTags(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}

export function ClientHero({
  org,
  contacts,
  tracks,
  brands,
  subscription,
  teamMembers,
  assignedPm,
  nextCall,
  canMoney,
  inviting,
  healthReason,
  onTab,
  onInvite,
  onViewAs,
  onOwnerChange,
  onRefresh,
  onNewDeal,
  onPauseToggle,
  onArchiveToggle,
}: {
  org: Organisation
  contacts: Contact[]
  tracks: Track[]
  brands: HeroBrand[]
  subscription: Subscription | null
  teamMembers: TeamMemberPm[]
  assignedPm: string | null
  nextCall: HeroCall | null
  canMoney: boolean
  inviting: boolean
  healthReason: string | null
  onTab: (tab: ClientTabId) => void
  onInvite: () => void
  onViewAs: () => void
  onOwnerChange: (pmId: string | null) => void
  onRefresh: () => void
  onNewDeal: () => void
  onPauseToggle: () => void
  onArchiveToggle: () => void
}) {
  const tags = useMemo(() => parseTags(org.tags), [org.tags])

  const health = HEALTH_META[(org.healthStatus ?? '').toLowerCase()] ?? { label: 'Not set', tone: 'neutral' as BadgeTone }
  const busyTracks = tracks.filter(t => t.currentRequestId).length
  const ownerName = teamMembers.find(m => m.id === assignedPm)?.name ?? null

  const inviteTarget = contacts.find(c => c.isPrimary) ?? contacts[0] ?? null
  const inviteLabel = inviteTarget
    ? `Email a portal invite link to ${inviteTarget.email || inviteTarget.name}`
    : 'Add a contact before inviting anyone'

  const mrrCurrency = org.customMrrCurrency ?? org.preferredCurrency ?? 'NZD'
  const isPaused = org.status === 'paused'
  const isArchived = org.status === 'archived'

  const trackWords = tracks.length === 0
    ? (org.billingModel === 'hourly' ? 'Hourly, billed monthly' : 'No retainer tracks')
    : `${busyTracks} of ${tracks.length} ${tracks.length === 1 ? 'track' : 'tracks'} busy`

  return (
    <section
      aria-label={org.name}
      style={{
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--color-border-strong)',
        background: 'var(--color-bg)',
        padding: '1rem',
      }}
    >
      {/* Identity + actions */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex items-start flex-1 min-w-0" style={{ gap: '0.875rem' }}>
          <Avatar name={org.name} size="lg" tooltip={false} />
          <div className="flex flex-col min-w-0" style={{ gap: '0.4375rem' }}>
            <div className="flex items-center flex-wrap" style={{ gap: '0.5rem' }}>
              <h1
                data-private
                className="break-words"
                style={{ margin: 0, fontSize: '1.5rem', lineHeight: 1.1, fontWeight: 800, letterSpacing: '-0.025em', color: 'var(--color-text)' }}
              >
                {org.name}
              </h1>
              {org.status !== 'active' && <StatusBadge status={org.status} type="org" />}
              {tags.map(t => (
                <Badge key={t} tone="neutral" size="sm">{t}</Badge>
              ))}
            </div>

            <div
              className="flex items-center flex-wrap"
              style={{ gap: '0.5rem', fontSize: '0.8125rem', fontWeight: 500, color: 'var(--color-text-muted)' }}
            >
              {org.industry && <span>{org.industry}</span>}
              {org.website && (
                <InlineAction
                  href={org.website.startsWith('http') ? org.website : `https://${org.website}`}
                  ariaLabel={`Open ${org.website.replace(/^https?:\/\//, '')} in a new tab`}
                >
                  <Globe className="w-3.5 h-3.5" aria-hidden="true" />
                  <span data-private>{org.website.replace(/^https?:\/\//, '')}</span>
                </InlineAction>
              )}
              <span>Client since {formatDate(org.createdAt)}</span>
            </div>

            {brands.length > 0 && (
              <div className="flex items-center flex-wrap" style={{ gap: '0.375rem' }}>
                {brands.map(b => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => onTab('settings')}
                    className="tahi-focus-ring min-h-[2.75rem] md:min-h-[1.625rem]"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.375rem',
                      padding: '0 0.625rem',
                      borderRadius: '9999px',
                      border: '1px solid var(--color-border-subtle)',
                      background: 'var(--color-bg)',
                      color: 'var(--color-text-muted)',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                    title="Manage brands in Settings"
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: '0.75rem',
                        height: '0.75rem',
                        borderRadius: 'var(--radius-leaf-sm)',
                        background: b.primaryColour ?? 'var(--color-brand-light)',
                      }}
                    />
                    <span data-private>{b.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center flex-wrap lg:justify-end" style={{ gap: '0.5rem' }}>
          <TahiButton
            variant="secondary"
            size="sm"
            disabled={inviting || contacts.length === 0}
            title={inviteLabel}
            aria-label={inviteLabel}
            onClick={onInvite}
          >
            {inviting
              ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" aria-hidden="true" />
              : <Mail className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />}
            {inviting ? 'Sending...' : 'Invite to portal'}
          </TahiButton>
          <TahiButton
            variant="secondary"
            size="sm"
            onClick={onViewAs}
            title={`Open the portal exactly as ${org.name} sees it`}
          >
            <Eye className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
            View as client
          </TahiButton>
          <Menu
            align="end"
            width="15rem"
            trigger={
              <button
                type="button"
                aria-label="More client actions"
                className="tahi-focus-ring"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: '2.75rem',
                  minWidth: '2.75rem',
                  borderRadius: 'var(--radius-button)',
                  border: '1px solid var(--color-border-strong)',
                  background: 'var(--color-bg)',
                  color: 'var(--color-text-muted)',
                  cursor: 'pointer',
                }}
              >
                <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
              </button>
            }
          >
            <Menu.Item icon={<Settings className="w-3.5 h-3.5" />} onClick={() => onTab('settings')}>
              Edit details and settings
            </Menu.Item>
            <Menu.Item icon={<CalendarDays className="w-3.5 h-3.5" />} onClick={() => onTab('calls')}>
              Book a call
            </Menu.Item>
            <Menu.Item icon={<Receipt className="w-3.5 h-3.5" />} onClick={() => onTab('invoices')}>
              Invoices
            </Menu.Item>
            <Menu.Item icon={<Handshake className="w-3.5 h-3.5" />} onClick={onNewDeal}>
              New deal
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={onRefresh}>
              Refresh this page
            </Menu.Item>
            {subscription && (
              <Menu.Item
                icon={isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                onClick={onPauseToggle}
              >
                {isPaused ? 'Resume the retainer' : 'Pause the retainer'}
              </Menu.Item>
            )}
            <Menu.Item
              icon={isArchived ? <RefreshCw className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
              tone={isArchived ? 'default' : 'danger'}
              onClick={onArchiveToggle}
            >
              {isArchived ? 'Unarchive client' : 'Archive client'}
            </Menu.Item>
          </Menu>
        </div>
      </div>

      {/* Stat strip. Four cells without the billing card, five with it, and the
          column count follows so there is no dead column at xl. */}
      <div
        className={canMoney
          ? 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5'
          : 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4'}
        style={{ gap: '0.875rem', marginTop: '1rem', paddingTop: '1rem' }}
      >
        <Stat
          label="Plan"
          value={<PlanBadge plan={subscription?.planType ?? org.planType} />}
          sub={trackWords}
        />

        {canMoney && (
          <Stat
            label={org.customMrr != null ? 'MRR' : 'Billing'}
            value={
              org.customMrr != null
                ? <Money native={org.customMrr} currency={mrrCurrency} withDisplay sensitive />
                : <span style={{ color: 'var(--color-text-subtle)' }}>Not set</span>
            }
            sub={
              org.customMrr != null
                ? `per month, ${org.billingModel ?? 'retainer'}`
                : (org.billingModel ? `${org.billingModel} billing` : 'No billing model set')
            }
          />
        )}

        <Stat
          label="Health"
          value={<Badge tone={health.tone} size="sm" dot>{health.label}</Badge>}
          sub={
            healthReason
              ? (
                <Tooltip label={healthReason} asChild showOnTap>
                  <span className="truncate" style={{ maxWidth: '100%' }}>{healthReason}</span>
                </Tooltip>
              )
              : 'Nothing to flag'
          }
        />

        <Stat
          label="Owner"
          value={
            <Menu
              align="start"
              width="14rem"
              trigger={
                <button
                  type="button"
                  aria-label="Change the account owner"
                  className="tahi-focus-ring"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.375rem',
                    minHeight: '2.75rem',
                    padding: '0 0.375rem',
                    borderRadius: 'var(--radius-sm)',
                    border: 'none',
                    background: 'none',
                    color: 'var(--color-text)',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {ownerName
                    ? <Avatar name={ownerName} size="sm" tooltip={false} />
                    : <User className="w-3.5 h-3.5" aria-hidden="true" style={{ color: 'var(--color-text-subtle)' }} />}
                  <span className="truncate">{ownerName ?? 'Unassigned'}</span>
                  <ChevronDown className="w-3 h-3" aria-hidden="true" />
                </button>
              }
            >
              <Menu.Label>Account owner</Menu.Label>
              <Menu.Item onClick={() => onOwnerChange(null)}>No owner assigned</Menu.Item>
              {teamMembers.map(m => (
                <Menu.Item key={m.id} onClick={() => onOwnerChange(m.id)}>
                  {m.name}
                </Menu.Item>
              ))}
            </Menu>
          }
          sub="runs the account"
        />

        <Stat
          label="Next call"
          value={
            nextCall
              ? formatDate(nextCall.scheduledAt)
              : <span style={{ color: 'var(--color-text-subtle)' }}>None booked</span>
          }
          sub={
            <InlineAction onClick={() => onTab('calls')}>
              {nextCall ? nextCall.title : 'Book a call'}
            </InlineAction>
          }
        />
      </div>
    </section>
  )
}
