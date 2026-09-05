'use client'

/** <RecentRequestsCard>. The last few requests for this client, with a jump
 *  to the full board. */

import { useRouter } from 'next/navigation'
import { ChevronRight, FileText } from 'lucide-react'
import { EmptyState } from '@/components/tahi/empty-state'
import { RequestCard } from '@/components/tahi/request-card'
import { TahiButton } from '@/components/tahi/tahi-button'
import type { Request } from './types'

// ── Recent requests card ───────────────────────────────────────────────────────

export function RecentRequestsCard({ requests, orgId }: { requests: Request[]; orgId: string }) {
  const router = useRouter()

  return (
    <div className="bg-[var(--color-bg)] rounded-xl border border-[var(--color-border)] p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-[var(--color-text)]">Recent requests</h2>
        <TahiButton
          variant="ghost"
          size="sm"
          onClick={() => router.push(`/requests?org=${orgId}`)}
          className="text-xs"
        >
          View all <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
        </TahiButton>
      </div>

      {requests.length === 0 ? (
        <EmptyState
          variant="inline"
          icon={<FileText className="w-8 h-8" />}
          title="No requests yet"
        />
      ) : (
        <div className="flex flex-col gap-2">
          {requests.map(req => (
            <RequestCard
              key={req.id}
              id={req.id}
              title={req.title}
              status={req.status}
              type={req.type}
              priority={req.priority}
              updatedAt={req.updatedAt}
              createdAt={req.createdAt}
            />
          ))}
        </div>
      )}
    </div>
  )
}
