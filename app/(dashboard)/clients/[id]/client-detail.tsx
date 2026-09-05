'use client'

/**
 * The client detail shell: fetch the record once, render the header, the tab
 * strip, and whichever tab is open.
 *
 * Every tab body and every Overview card now lives in its own file under
 * ./tabs and ./_kit. This file owns only the things that are genuinely
 * page-level: the SWR read of `/api/admin/clients/[id]`, the error bounce, the
 * portal-invite action, impersonation, archive, and which tab is showing.
 */

import { useState, useEffect } from 'react'
import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import { apiPath } from '@/lib/api'
import { Breadcrumb } from '@/components/tahi/breadcrumb'
import { useToast } from '@/components/tahi/toast'
import {
  Building2,
  Mail,
  Layers,
  Clock,
  Activity,
  RefreshCw,
  Users,
  Loader2,
  DollarSign,
  File,
  ScrollText,
  Phone,
  Eye,
  Trash2,
  TrendingUp,
  Handshake,
  CalendarDays,
  Palette,
  ListOrdered,
  Percent,
  Globe,
} from 'lucide-react'
import { StatusBadge, PlanBadge, HealthDot } from '@/components/tahi/status-badge'
import { TrackMeter } from '@/components/tahi/track-meter'
import { TahiButton } from '@/components/tahi/tahi-button'
import { DiscoveryCallsCard } from '@/components/tahi/discovery-calls'
import { cn } from '@/lib/utils'
import { LoadingSkeleton } from './_kit/loading-skeleton'
import type { ClientData } from './_kit/types'
import { OverviewTab } from './tabs/overview'
import { RequestsTab } from './tabs/requests'
import { TrackQueueTab } from './tabs/track-queue'
import { FilesTab } from './tabs/files'
import { InvoicesTab } from './tabs/invoices'
import { ContractsTab } from './tabs/contracts'
import { ContactsTab } from './tabs/contacts'
import { BrandsTab } from './tabs/brands'
import { DealsTab } from './tabs/deals'
import { TimeTab } from './tabs/time'
import { CrmActivitiesTab } from './tabs/crm-activities'
import { RevenueTab } from './tabs/revenue'
import { ProfitabilityTab } from './tabs/profitability'
import { ActivityTab } from './tabs/activity'

// ── Tabs ───────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'overview',      label: 'Overview',      icon: Building2 },
  { id: 'requests',      label: 'Requests',      icon: Layers },
  { id: 'trackqueue',    label: 'Track Queue',   icon: ListOrdered },
  { id: 'files',         label: 'Files',         icon: File },
  { id: 'invoices',      label: 'Invoices',      icon: DollarSign },
  { id: 'contracts',     label: 'Contracts',     icon: ScrollText },
  { id: 'contacts',      label: 'Contacts',      icon: Users },
  { id: 'calls',         label: 'Calls',         icon: Phone },
  { id: 'brands',        label: 'Brands',        icon: Palette },
  { id: 'deals',         label: 'Deals',         icon: Handshake },
  { id: 'time',          label: 'Time',          icon: Clock },
  { id: 'crm',           label: 'Activities',    icon: CalendarDays },
  { id: 'revenue',       label: 'Revenue',       icon: TrendingUp },
  { id: 'profitability', label: 'Profitability', icon: Percent },
  { id: 'activity',      label: 'Activity',      icon: Activity },
] as const

type TabId = typeof TABS[number]['id']

// ── Main component ─────────────────────────────────────────────────────────────

export function ClientDetail({ clientId }: { clientId: string }) {
  const router = useRouter()
  const { showToast } = useToast()
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [invitingAll, setInvitingAll] = useState(false)

  // SWR-backed client record. `mutate` (aliased load) refetches after edits,
  // archive, etc. Any fetch error (e.g. a 404) bounces back to /clients,
  // matching the old non-ok redirect.
  const { data, isLoading: loading, error, mutate: load } = useSWR<ClientData>(
    `/api/admin/clients/${clientId}`,
  )

  useEffect(() => {
    if (error) router.push('/clients')
  }, [error, router])

  if (loading) return <LoadingSkeleton />
  if (!data) return null

  const { org, contacts, subscription, tracks, recentRequests } = data

  // Who the header "Invite to portal" button actually emails. The route sends
  // to the primary contact only (fanning out to a whole roster is opt-in via
  // `all`), and the payload is a live access token, so the control has to name
  // its target rather than hide it in a hover tooltip. This label is both the
  // title and the aria-label, so the icon-only state below sm announces the
  // same thing a mouse user reads.
  const inviteTarget = contacts.find(c => c.isPrimary) ?? contacts[0] ?? null
  const inviteTargetLabel = inviteTarget
    ? `Email a portal invite link to ${inviteTarget.email || inviteTarget.name}`
    : 'Add a contact before inviting anyone'

  return (
    <div className="flex flex-col min-h-0">
      {/* ── Header ── */}
      <div className="border-b border-[var(--color-border)] bg-[var(--color-bg)]">
        <div className="pb-0">
          {/* Breadcrumb */}
          <div style={{ marginBottom: '0.75rem' }}>
            <Breadcrumb items={[{ label: 'Clients', href: '/clients' }, { label: org.name }]} />
          </div>

          {/* Title row */}
          <div className="flex flex-col gap-3 mb-5 sm:flex-row sm:items-start">
            <div className="flex items-start gap-3 flex-1 min-w-0">
              <div className="flex-1 min-w-0">
                <h1 data-private className="text-xl font-bold text-[var(--color-text)] md:text-2xl break-words">
                  {org.name}
                </h1>
                <div className="flex items-center gap-2 flex-wrap mt-2">
                  <HealthDot health={org.healthStatus} className="w-2.5 h-2.5" />
                  <StatusBadge status={org.status} type="org" />
                  <PlanBadge plan={org.planType} />
                </div>

                {org.website && (
                  <a
                    href={org.website.startsWith('http') ? org.website : `https://${org.website}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-brand)] mt-1.5"
                    data-private
                  >
                    <Globe className="w-3.5 h-3.5" />
                    {org.website.replace(/^https?:\/\//, '')}
                  </a>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0 sm:ml-0">
              <TahiButton
                variant="secondary"
                size="sm"
                onClick={async () => {
                  const { setImpersonation } = await import('@/components/tahi/impersonation-banner')
                  const primaryContact = contacts[0]
                  setImpersonation({
                    orgId: org.id,
                    orgName: org.name,
                    contactId: primaryContact?.id,
                    contactName: primaryContact?.name,
                  })
                  router.push('/overview')
                }}
              >
                <Eye className="w-3.5 h-3.5 mr-1.5" />
                <span className="hidden sm:inline">View as Client</span>
                <span className="sm:hidden">Client View</span>
              </TahiButton>
              <TahiButton
                variant="secondary"
                size="sm"
                disabled={invitingAll || contacts.length === 0}
                title={inviteTargetLabel}
                aria-label={inviteTargetLabel}
                onClick={async () => {
                  setInvitingAll(true)
                  try {
                    const res = await fetch(apiPath(`/api/admin/clients/${clientId}/welcome-email`), { method: 'POST' })
                    const json = await res.json() as {
                      error?: string
                      sent?: number
                      total?: number
                      results?: { email: string; sent: boolean; error?: string }[]
                    }
                    if (!res.ok && !json.results) {
                      showToast(json.error ?? 'Could not send the invite', 'error')
                      return
                    }
                    const sent = json.sent ?? 0
                    const total = json.total ?? 0
                    if (sent === 0) {
                      const first = json.results?.find(r => !r.sent)?.error
                      showToast(first ? `Invite not sent: ${first}` : 'Invite not sent', 'error')
                    } else if (sent < total) {
                      showToast(`Invite sent to ${sent} of ${total} contacts`, 'warning')
                    } else {
                      showToast(total === 1
                        ? `Invite sent to ${json.results?.[0]?.email ?? 'the contact'}`
                        : `Invite sent to all ${total} contacts`, 'success')
                    }
                    await load()
                  } catch {
                    showToast('Could not send the invite', 'error')
                  } finally {
                    setInvitingAll(false)
                  }
                }}
              >
                {invitingAll
                  ? <Loader2 className="w-3.5 h-3.5 sm:mr-1.5 animate-spin" />
                  : <Mail className="w-3.5 h-3.5 sm:mr-1.5" />}
                <span className="hidden sm:inline">{invitingAll ? 'Sending...' : 'Invite to portal'}</span>
              </TahiButton>
              <TahiButton
                variant="secondary"
                size="sm"
                onClick={() => router.push(`/pipeline?new=1&orgId=${clientId}`)}
              >
                <Handshake className="w-3.5 h-3.5 sm:mr-1.5" />
                <span className="hidden sm:inline">New Deal</span>
              </TahiButton>
              <TahiButton variant="secondary" size="sm" onClick={() => { void load() }}>
                <RefreshCw className="w-3.5 h-3.5 sm:mr-1.5" />
                <span className="hidden sm:inline">Refresh</span>
              </TahiButton>
              <TahiButton
                variant="secondary"
                size="sm"
                onClick={async () => {
                  const isArchiving = org.status !== 'archived'
                  const verb = isArchiving ? 'Archive' : 'Unarchive'
                  if (!confirm(`${verb} ${org.name}?\n\n${isArchiving ? 'They will be hidden from active client lists. All data will be preserved and can be restored.' : 'They will reappear in your active client lists.'}`)) return
                  try {
                    const res = await fetch(apiPath(`/api/admin/clients/${clientId}`), {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ status: isArchiving ? 'archived' : 'active' }),
                    })
                    if (!res.ok) throw new Error('Failed')
                    await load()
                  } catch {
                    showToast(`Could not ${verb.toLowerCase()} this client. Please try again.`, 'error')
                  }
                }}
                aria-label={org.status === 'archived' ? 'Unarchive client' : 'Archive client'}
                title={org.status === 'archived' ? 'Unarchive client' : 'Archive client'}
              >
                {org.status === 'archived' ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 sm:mr-1.5" />
                    <span className="hidden sm:inline">Unarchive</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5 sm:mr-1.5" />
                    <span className="hidden sm:inline">Archive</span>
                  </>
                )}
              </TahiButton>
            </div>
          </div>

          {/* Track meter in header for quick glance */}
          {tracks.length > 0 && (
            <div className="mb-4 px-0">
              <TrackMeter tracks={tracks} />
            </div>
          )}

          {/* Tab nav */}
          <nav className="flex gap-0 border-b border-[var(--color-border)] overflow-x-auto scrollbar-hide" style={{ WebkitOverflowScrolling: 'touch' }}>
            {TABS.map(tab => {
              const Icon = tab.icon
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex-shrink-0 -mb-px',
                    isActive
                      ? 'border-[var(--color-brand)] text-[var(--color-brand)] bg-[var(--color-brand-50)]'
                      : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-border)]'
                  )}
                  style={{ minHeight: '2.75rem' }}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              )
            })}
          </nav>
        </div>
      </div>

      {/* ── Tab content ── */}
      <div className="flex-1 overflow-auto py-6 space-y-6">
        {activeTab === 'overview' && (
          <OverviewTab
            org={org}
            contacts={contacts}
            subscription={subscription}
            tracks={tracks}
            recentRequests={recentRequests}
            onUpdated={load}
          />
        )}
        {activeTab === 'requests' && (
          <RequestsTab clientId={clientId} />
        )}
        {activeTab === 'trackqueue' && (
          <TrackQueueTab clientId={clientId} />
        )}
        {activeTab === 'files' && (
          <FilesTab clientId={clientId} />
        )}
        {activeTab === 'invoices' && (
          <InvoicesTab clientId={clientId} />
        )}
        {activeTab === 'contracts' && (
          <ContractsTab clientId={clientId} />
        )}
        {activeTab === 'contacts' && (
          <ContactsTab clientId={clientId} contacts={contacts} onUpdated={load} />
        )}
        {activeTab === 'calls' && (
          <DiscoveryCallsCard parentType="org" parentId={clientId} />
        )}
        {activeTab === 'brands' && (
          <BrandsTab clientId={clientId} />
        )}
        {activeTab === 'deals' && (
          <DealsTab clientId={clientId} orgName={org.name} />
        )}
        {activeTab === 'time' && (
          <TimeTab clientId={clientId} />
        )}
        {activeTab === 'crm' && (
          <CrmActivitiesTab clientId={clientId} />
        )}
        {activeTab === 'revenue' && (
          <RevenueTab clientId={clientId} />
        )}
        {activeTab === 'profitability' && (
          <ProfitabilityTab clientId={clientId} />
        )}
        {activeTab === 'activity' && (
          <ActivityTab clientId={clientId} />
        )}

        {/* Mobile bottom nav spacer */}
        <div className="h-28 md:hidden" aria-hidden="true" />
      </div>
    </div>
  )
}
