'use client'

/**
 * The client Money tab.
 *
 * The prototype dropped Revenue, Profitability, Time and Deals. Rather than
 * lose four working surfaces, they fold into one tab behind a switch: what
 * this client has been billed, what they cost, the hours behind that, and
 * what is still being sold to them.
 *
 * One section is mounted at a time on purpose. Rendering all four together
 * fires six requests on a single tab click, three of them duplicates
 * (/api/admin/invoices and /api/admin/time are each read by two sections), so
 * the switch is a performance decision as much as a layout one.
 *
 * The whole tab is admin-only: /profitability and /costs already enforce
 * clients.billing_card server-side, and this is the matching client-side gate.
 */

import { useState } from 'react'
import { DollarSign } from 'lucide-react'
import { EmptyState } from '@/components/tahi/empty-state'
import { SegmentedControl } from '@/components/tahi/segmented-control'
import { SubBar } from '../_kit/chrome'
import { DealsTab } from './deals'
import { ProfitabilityTab } from './profitability'
import { RevenueTab } from './revenue'
import { TimeTab } from './time'
import type { Organisation } from '../_kit/types'

type MoneySection = 'revenue' | 'profitability' | 'time' | 'deals'

const SECTIONS = [
  { value: 'revenue' as const, label: 'Revenue' },
  { value: 'profitability' as const, label: 'Profitability' },
  { value: 'time' as const, label: 'Time' },
  { value: 'deals' as const, label: 'Deals' },
]

const BLURB: Record<MoneySection, string> = {
  revenue: 'What has been invoiced, what has landed, and what is still owed.',
  profitability: 'Revenue against the hours and costs behind it.',
  time: 'Every hour logged against this client.',
  deals: 'What is still being sold to them.',
}

export function MoneyTab({
  clientId,
  org,
  canMoney,
}: {
  clientId: string
  org: Organisation
  canMoney: boolean
}) {
  const [section, setSection] = useState<MoneySection>('revenue')

  if (!canMoney) {
    return (
      <EmptyState
        variant="inline"
        icon={<DollarSign className="w-8 h-8" />}
        title="Money is not visible to you"
        description="Revenue, profitability, time and deals are behind the billing card permission. Ask an owner if you need them."
      />
    )
  }

  return (
    <div className="flex flex-col" style={{ gap: '0.75rem' }}>
      <SubBar>
        <SegmentedControl
          role="tablist"
          ariaLabel="Money section"
          value={section}
          onChange={setSection}
          options={SECTIONS}
          size="sm"
        />
        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>{BLURB[section]}</span>
      </SubBar>

      {section === 'revenue' && (
        <RevenueTab
          clientId={clientId}
          currency={org.preferredCurrency ?? 'NZD'}
          hourlyRate={org.defaultHourlyRate}
        />
      )}
      {section === 'profitability' && <ProfitabilityTab clientId={clientId} />}
      {section === 'time' && <TimeTab clientId={clientId} />}
      {section === 'deals' && <DealsTab clientId={clientId} orgName={org.name} />}
    </div>
  )
}
