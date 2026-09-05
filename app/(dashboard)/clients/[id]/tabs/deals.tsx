'use client'

/**
 * The client Deals tab: this client's pipeline, linking into /pipeline.
 *
 * Every figure goes through <Money> in the currency the deal was actually
 * raised in. The aggregate is grouped the same way rather than adding a GBP
 * deal to a NZD one and printing a dollar sign over the result.
 */

import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import { Clock, Handshake, Plus, User, Users } from 'lucide-react'
import { Badge } from '@/components/tahi/badge'
import { Card } from '@/components/tahi/card'
import { EmptyState } from '@/components/tahi/empty-state'
import { Money } from '@/components/tahi/money'
import { SkeletonList } from '@/components/tahi/skeletons'
import { TahiButton } from '@/components/tahi/tahi-button'
import { MoneySums, sumByCurrency } from '../_kit/currency-sums'

// ── Deals tab ─────────────────────────────────────────────────────────────────

export interface DealRow {
  id: string
  title: string
  orgId: string | null
  stageId: string
  ownerId: string | null
  value: number
  currency: string
  expectedCloseDate: string | null
  closedAt: string | null
  createdAt: string
  updatedAt: string
  orgName: string | null
  stageName: string | null
  stageColour: string | null
  stageProbability: number | null
  stageIsClosedWon: number | null
  stageIsClosedLost: number | null
  ownerName: string | null
  ownerAvatarUrl: string | null
  contactCount: number
}


export function DealsTab({ clientId, orgName }: { clientId: string; orgName: string }) {
  const router = useRouter()

  const { data, isLoading: loading } = useSWR<{ items: DealRow[] }>(
    `/api/admin/deals?orgId=${clientId}`,
  )
  const deals = data?.items ?? []

  if (loading) {
    return (
      <SkeletonList rows={4} />
    )
  }

  const totals = sumByCurrency(deals.map(d => ({ totalAmount: d.value, currency: d.currency })))

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-[var(--color-text)]">
          Deals ({deals.length})
          {deals.length > 0 && (
            <span className="text-sm font-normal text-[var(--color-text-muted)] ml-2 inline-flex items-center gap-1">
              Total: <MoneySums sums={totals} />
            </span>
          )}
        </h2>
        <TahiButton variant="primary" size="sm" onClick={() => router.push(`/pipeline?new=1&orgId=${clientId}`)}>
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          New Deal
        </TahiButton>
      </div>

      {deals.length === 0 ? (
        <EmptyState
          variant="inline"
          icon={<Handshake className="w-8 h-8" />}
          title={`No deals for ${orgName} yet`}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {deals.map(deal => {
            const isWon = deal.stageIsClosedWon === 1
            const isLost = deal.stageIsClosedLost === 1
            return (
              <Card
                key={deal.id}
                interactive
                onClick={() => router.push(`/pipeline?deal=${deal.id}`)}
              >
                <div className="flex items-start justify-between mb-2 gap-2">
                  <h3 className="text-sm font-semibold text-[var(--color-text)] truncate">
                    {deal.title}
                  </h3>
                  {/* Use shared stageColour() (via Badge stage=) so a deal's stage
                      chip matches the Pipeline board and the Reports charts. */}
                  {isWon ? (
                    <Badge tone="positive" size="sm" className="flex-shrink-0">{deal.stageName ?? 'Unknown'}</Badge>
                  ) : isLost ? (
                    <Badge tone="danger" size="sm" className="flex-shrink-0">{deal.stageName ?? 'Unknown'}</Badge>
                  ) : (
                    <Badge stage={deal.stageName ?? 'Unknown'} size="sm" className="flex-shrink-0">{deal.stageName ?? 'Unknown'}</Badge>
                  )}
                </div>

                <Money
                  as="p"
                  native={deal.value}
                  currency={deal.currency}
                  sensitive
                  className="text-lg font-bold text-[var(--color-text)] mb-2"
                />

                <div className="flex items-center gap-4 text-xs text-[var(--color-text-muted)]">
                  {deal.ownerName && (
                    <span className="flex items-center gap-1">
                      <User className="w-3 h-3" />
                      {deal.ownerName}
                    </span>
                  )}
                  {deal.expectedCloseDate && (
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(deal.expectedCloseDate).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}
                    </span>
                  )}
                  {deal.contactCount > 0 && (
                    <span className="flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {deal.contactCount}
                    </span>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
