'use client'

/**
 * <AccountCard>. The Overview rail's read of the commercial facts: plan,
 * tracks, MRR, how they are invoiced and on what terms, status, since, owner.
 *
 * Read-only on purpose. Every one of these fields is editable, but in exactly
 * one place (Settings), so the page never offers two edit paths to the same
 * value. The head links there.
 */

import { Building2 } from 'lucide-react'
import { SidebarCard } from '@/components/tahi/rail/sidebar-card'
import { Money } from '@/components/tahi/money'
import { PlanBadge, StatusBadge } from '@/components/tahi/status-badge'
import { invoiceChannelLabel } from '@/lib/invoice-channel'
import { paymentTermsLabel } from '@/lib/invoice-billing'
import { formatDate } from '@/lib/utils'
import { InlineAction } from './chrome'
import type { Organisation, Subscription, Track } from './types'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      className="flex items-center justify-between flex-wrap"
      style={{ gap: '0.5rem', minHeight: '1.75rem', padding: '0.1875rem 0' }}
    >
      <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--color-text-muted)' }}>{label}</span>
      <span
        className="flex items-center"
        style={{ gap: '0.375rem', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)', minWidth: 0 }}
      >
        {children}
      </span>
    </div>
  )
}

export function AccountCard({
  org,
  subscription,
  tracks,
  ownerName,
  canMoney,
  onOpenSettings,
}: {
  org: Organisation
  subscription: Subscription | null
  tracks: Track[]
  ownerName: string | null
  canMoney: boolean
  onOpenSettings: () => void
}) {
  const mrrCurrency = org.customMrrCurrency ?? org.preferredCurrency ?? 'NZD'
  const trackWords = tracks.length === 0
    ? 'None'
    : tracks.map(t => (t.type === 'large' ? 'Large' : 'Small')).join(' + ')

  return (
    <SidebarCard
      title="Account"
      icon={<Building2 className="w-3.5 h-3.5" />}
      action={<InlineAction onClick={onOpenSettings} ariaLabel="Edit account settings">Edit</InlineAction>}
    >
      <Row label="Plan"><PlanBadge plan={subscription?.planType ?? org.planType} /></Row>
      <Row label="Tracks">{trackWords}</Row>
      {canMoney && (
        <Row label={org.customMrr != null ? 'MRR' : 'Billing model'}>
          {org.customMrr != null
            ? <Money native={org.customMrr} currency={mrrCurrency} withDisplay sensitive />
            : <span style={{ color: 'var(--color-text-subtle)', fontWeight: 500 }}>{org.billingModel ?? 'Not set'}</span>}
        </Row>
      )}
      {canMoney && (
        <Row label="Invoicing">
          <span>{invoiceChannelLabel(org.effectiveInvoiceChannel ?? org.invoiceChannel)}</span>
          <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--color-text-subtle)' }}>
            {org.paymentTerms ? paymentTermsLabel(org.paymentTerms) : 'terms not set'}
          </span>
        </Row>
      )}
      <Row label="Status"><StatusBadge status={org.status} type="org" /></Row>
      <Row label="Client since">{formatDate(org.createdAt)}</Row>
      <Row label="Owner">
        {ownerName ?? <span style={{ color: 'var(--color-text-subtle)', fontWeight: 500 }}>Unassigned</span>}
      </Row>
    </SidebarCard>
  )
}
