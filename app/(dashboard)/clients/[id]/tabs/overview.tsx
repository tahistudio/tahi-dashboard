'use client'

/**
 * The client Overview tab.
 *
 * Reading order matches the order someone actually needs it: what needs you
 * now, what is in the studio, then the record. The rail keeps the account
 * facts, the health read and the studio-only notes.
 */

import { ChevronRight, Inbox } from 'lucide-react'
import { EngagementHealthCard } from '@/components/tahi/engagement-health-card'
import { Gate } from '@/components/tahi/permissions-context'
import { DueDateChip } from '@/components/tahi/due-date-chip'
import { EmptyState } from '@/components/tahi/empty-state'
import { StatusBadge } from '@/components/tahi/status-badge'
import { AccountCard } from '../_kit/account-card'
import { ActivityBlock } from '../_kit/activity-block'
import { AiHealthCheckCard } from '../_kit/ai-health-card'
import { Block, InlineAction } from '../_kit/chrome'
import { ContactsCard } from '../_kit/contacts-card'
import { HealthNoteCard } from '../_kit/health-note-card'
import { InternalNotesCard } from '../_kit/internal-notes-card'
import { NeedsYou } from '../_kit/needs-you'
import { OnboardingCard, type ClientOnboarding } from '../_kit/onboarding-card'
import { OverviewTracks } from '../_kit/overview-tracks'
import { RequestMixCard } from '../_kit/request-mix-card'
import type { NeedItem, NeedRequest } from '../_kit/needs'
import type { ClientTabId, Contact, Organisation, Request, Subscription, Track } from '../_kit/types'

export function OverviewTab({
  clientId,
  org,
  contacts,
  subscription,
  tracks,
  requests,
  recentRequests,
  needs,
  needsLoading,
  onboarding,
  ownerName,
  canMoney,
  writeDisabled,
  onTab,
  onOpenRequest,
  onNewRequest,
  onAct,
  onUpdated,
}: {
  clientId: string
  org: Organisation
  contacts: Contact[]
  subscription: Subscription | null
  tracks: Track[]
  requests: NeedRequest[]
  recentRequests: Request[]
  needs: NeedItem[]
  needsLoading: boolean
  /** The derived checklist, or null while the record is still loading. */
  onboarding: ClientOnboarding | null
  ownerName: string | null
  canMoney: boolean
  writeDisabled: boolean
  onTab: (tab: ClientTabId) => void
  onOpenRequest: (id: string) => void
  onNewRequest: () => void
  onAct: (item: NeedItem) => void
  onUpdated: () => void
}) {
  const recent = [...requests]
    .sort((a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime())
    .slice(0, 6)

  return (
    <div className="flex flex-col" style={{ gap: '1rem' }}>
      <NeedsYou items={needs} loading={needsLoading} onAct={onAct} />

      <OverviewTracks
        clientId={clientId}
        orgName={org.name}
        requests={requests}
        writeDisabled={writeDisabled}
        onOpenBoard={() => onTab('requests')}
        onNewRequest={onNewRequest}
        onOpenRequest={onOpenRequest}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3" style={{ gap: '1rem', alignItems: 'start' }}>
        {/* Main column */}
        <div className="lg:col-span-2 flex flex-col" style={{ gap: '1rem', minWidth: 0 }}>
          <Block
            icon={<Inbox className="w-3.5 h-3.5" />}
            title="Recent requests"
            count={requests.length}
            action={<InlineAction onClick={() => onTab('requests')}>View all <ChevronRight className="w-3 h-3" aria-hidden="true" /></InlineAction>}
          >
            {recent.length === 0 ? (
              <EmptyState
                variant="inline"
                icon={<Inbox className="w-8 h-8" />}
                title="No requests yet"
                description={`Everything ${org.name} asks for lands here first.`}
                ctaLabel={writeDisabled ? undefined : 'New request'}
                onCtaClick={writeDisabled ? undefined : onNewRequest}
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {recent.map(r => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => onOpenRequest(r.id)}
                    className="tahi-focus-ring flex items-center flex-wrap text-left"
                    style={{
                      gap: '0.625rem',
                      minHeight: '2.75rem',
                      padding: '0.375rem 0.5rem',
                      border: 'none',
                      borderRadius: 'var(--radius-sm)',
                      background: 'none',
                      cursor: 'pointer',
                      transition: 'background var(--motion-quick) var(--ease-out)',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
                  >
                    {r.requestNumber != null && (
                      <span className="tabular-nums" style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-text-subtle)' }}>
                        #{r.requestNumber}
                      </span>
                    )}
                    <span
                      className="truncate"
                      style={{ flex: 1, minWidth: '8rem', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)' }}
                    >
                      {r.title}
                    </span>
                    <StatusBadge status={r.status} />
                    <DueDateChip dueDate={r.dueDate} status={r.status} size="sm" />
                  </button>
                ))}
              </div>
            )}
          </Block>

          <ActivityBlock clientId={clientId} orgName={org.name} writeDisabled={writeDisabled} />
        </div>

        {/* Rail */}
        <div className="flex flex-col" style={{ gap: '1rem', minWidth: 0 }}>
          <AccountCard
            org={org}
            subscription={subscription}
            tracks={tracks}
            ownerName={ownerName}
            canMoney={canMoney}
            onOpenSettings={() => onTab('settings')}
          />
          {/* Delivery spine (#148) Slice 4: live rollup across this client's schedules. */}
          <Gate feature="clients.engagement_health">
            <EngagementHealthCard orgId={org.id} />
          </Gate>
          {onboarding && onboarding.done < onboarding.total && (
            <OnboardingCard onboarding={onboarding} orgName={org.name} />
          )}
          <AiHealthCheckCard org={org} onUpdated={onUpdated} />
          {org.healthNote && <HealthNoteCard note={org.healthNote} health={org.healthStatus} />}
          {recentRequests.length > 0 && <RequestMixCard requests={recentRequests} />}
          <ContactsCard contacts={contacts} onManage={() => onTab('people')} />
          <InternalNotesCard org={org} onUpdated={onUpdated} />
        </div>
      </div>
    </div>
  )
}
