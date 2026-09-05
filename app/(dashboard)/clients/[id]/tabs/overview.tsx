'use client'

/** The client Overview tab: signal tiles, the org record, recent requests,
 *  and the rail of account cards. */

import { EngagementHealthCard } from '@/components/tahi/engagement-health-card'
import { Gate } from '@/components/tahi/permissions-context'
import { AiHealthCheckCard } from '../_kit/ai-health-card'
import { BrandsCard } from '../_kit/brands-card'
import { ClientSignalTiles } from '../_kit/signal-tiles'
import { ContactsCard } from '../_kit/contacts-card'
import { HealthNoteCard } from '../_kit/health-note-card'
import { InternalNotesCard } from '../_kit/internal-notes-card'
import { OrgDetailsCard } from '../_kit/org-details-card'
import { RecentRequestsCard } from '../_kit/recent-requests-card'
import { RequestMixCard } from '../_kit/request-mix-card'
import { NoSubscriptionCard, SubscriptionCard } from '../_kit/subscription-card'
import { TagsCard } from '../_kit/tags-card'
import type { Contact, Organisation, Request, Subscription, Track } from '../_kit/types'

export function OverviewTab({
  org,
  contacts,
  subscription,
  tracks,
  recentRequests,
  onUpdated,
}: {
  org: Organisation
  contacts: Contact[]
  subscription: Subscription | null
  tracks: Track[]
  recentRequests: Request[]
  onUpdated: () => void
}) {
  return (
    <div className="flex flex-col gap-6">
      <ClientSignalTiles
        org={org}
        contacts={contacts}
        subscription={subscription}
        recentRequests={recentRequests}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column (wide) */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          <OrgDetailsCard org={org} onUpdated={onUpdated} />
          <RecentRequestsCard requests={recentRequests} orgId={org.id} />
        </div>

        {/* Right column (narrow) */}
        <div className="flex flex-col gap-6">
          {/* Delivery spine (#148) Slice 4 - live rollup across this client's schedules. */}
          <Gate feature="clients.engagement_health">
            <EngagementHealthCard orgId={org.id} />
          </Gate>
          <AiHealthCheckCard org={org} onUpdated={onUpdated} />
          {recentRequests.length > 0 && (
            <RequestMixCard requests={recentRequests} />
          )}
          <ContactsCard contacts={contacts} />
          {subscription && (
            <SubscriptionCard subscription={subscription} tracks={tracks} orgId={org.id} onUpdated={onUpdated} />
          )}
          {!subscription && <NoSubscriptionCard planType={org.planType} />}
          {org.healthNote && <HealthNoteCard note={org.healthNote} health={org.healthStatus} />}
          <BrandsCard org={org} onUpdated={onUpdated} />
          <TagsCard org={org} onUpdated={onUpdated} />
          <InternalNotesCard org={org} onUpdated={onUpdated} />
        </div>
      </div>
    </div>
  )
}
