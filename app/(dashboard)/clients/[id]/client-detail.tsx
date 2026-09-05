'use client'

/**
 * The client detail shell: fetch the record once, render the hero, the tab
 * strip, and whichever tab is open.
 *
 * Every tab body and every Overview card lives in its own file under ./tabs
 * and ./_kit. This file owns only what is genuinely page-level: the SWR read
 * of `/api/admin/clients/[id]`, the error bounce, the shared reads the hero
 * and the Needs-you strip are built from, the portal invite, impersonation,
 * pause and archive, and the cross-tab state the design assumes (which tab is
 * open, which file or contact panel is up, whether the booking form is
 * expanded).
 *
 * The open tab is in the URL as ?tab=, so the hero's Next call, the Needs-you
 * actions and a shared link all land on the same door.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import {
  Building2,
  DollarSign,
  File,
  Layers,
  Phone,
  ScrollText,
  Settings as SettingsIcon,
  TrendingUp,
  Users,
} from 'lucide-react'
import { apiPath } from '@/lib/api'
import { Breadcrumb } from '@/components/tahi/breadcrumb'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { useFeature } from '@/components/tahi/permissions-context'
import { useToast } from '@/components/tahi/toast'
import { ClientHero, type HeroCall, type HeroBrand } from './_kit/client-hero'
import { ClientTabs, type ClientTabDef } from './_kit/client-tabs'
import { LoadingSkeleton } from './_kit/loading-skeleton'
import {
  firstHealthReason,
  isInvoiceOverdue,
  needsFor,
  OPEN_INVOICE_STATUSES,
  OPEN_REQUEST_STATUSES,
  type NeedItem,
  type NeedRequest,
} from './_kit/needs'
import { clientOnboarding } from './_kit/onboarding-card'
import type { TeamMemberPm } from './_kit/org-details-card'
import type { ClientData, ClientTabId } from './_kit/types'
import { CLIENT_CALLS_KEY, CallsTab, type ClientCallRow } from './tabs/calls'
import { FilesTab } from './tabs/files'
import { InvoicesTab, type InvoiceRow } from './tabs/invoices'
import { MoneyTab } from './tabs/money'
import { OverviewTab } from './tabs/overview'
import { PapersTab, type ContractRow } from './tabs/papers'
import { PeopleTab } from './tabs/people'
import { RequestsTab } from './tabs/requests'
import { SettingsTab } from './tabs/settings'

const TAB_IDS: ClientTabId[] = [
  'overview', 'requests', 'invoices', 'files', 'people', 'papers', 'calls', 'money', 'settings',
]

function normaliseTab(raw: string | undefined): ClientTabId {
  return TAB_IDS.includes(raw as ClientTabId) ? (raw as ClientTabId) : 'overview'
}

export function ClientDetail({ clientId, initialTab }: { clientId: string; initialTab?: string }) {
  const router = useRouter()
  const { showToast } = useToast()
  const canMoney = useFeature('clients.billing_card')

  const [tab, setTabState] = useState<ClientTabId>(() => normaliseTab(initialTab))
  const [fileId, setFileId] = useState<string | null>(null)
  const [contactId, setContactId] = useState<string | null>(null)
  const [bookOpen, setBookOpen] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [confirmAction, setConfirmAction] = useState<'pause' | 'archive' | null>(null)

  // ── The record ──
  const { data, isLoading: loading, error, mutate: load } = useSWR<ClientData>(
    `/api/admin/clients/${clientId}`,
  )

  // ── Shared reads. The hero and the Needs-you strip are built from these,
  // and each key is the same string its tab uses, so SWR serves one request
  // to both rather than fetching twice. ──
  const { data: requestData, isLoading: requestsLoading } =
    useSWR<{ requests: NeedRequest[] }>(`/api/admin/requests?clientId=${clientId}&status=all`)
  const { data: invoiceData } = useSWR<{ items: InvoiceRow[] }>(`/api/admin/invoices?orgId=${clientId}`)
  const { data: contractData } = useSWR<{ items: ContractRow[] }>(`/api/admin/contracts?orgId=${clientId}`)
  const { data: callData } = useSWR<{ calls: ClientCallRow[] }>(CLIENT_CALLS_KEY(clientId))
  // Brands come from the brands table, which the Settings tab edits. The
  // organisations.brands JSON column is the deprecated store and is shown there
  // as a read-only footnote, so the hero must not read it.
  const { data: brandData } = useSWR<{ items: HeroBrand[] }>(`/api/admin/brands?orgId=${clientId}`)
  const { data: teamData } = useSWR<{ items: TeamMemberPm[] }>('/api/admin/team-members')
  const { data: pmData, mutate: mutatePm } = useSWR<{ pmId: string | null; pmName: string | null }>(
    `/api/admin/clients/${clientId}/pm`,
  )

  // Sub-requests come back alongside their parents on ?status=all. Everything
  // that counts work on this page counts top-level requests only, the same rule
  // request-list.tsx applies before it builds the board, so a nested request is
  // never double counted in the tab badge or given its own Needs-you line.
  const requests = useMemo(
    () => (requestData?.requests ?? []).filter(r => !r.parentRequestId),
    [requestData],
  )
  const invoices = useMemo(() => invoiceData?.items ?? [], [invoiceData])
  const contracts = useMemo(() => contractData?.items ?? [], [contractData])
  const calls = useMemo(() => callData?.calls ?? [], [callData])
  const brands = useMemo(() => brandData?.items ?? [], [brandData])
  const teamMembers = useMemo(() => teamData?.items ?? [], [teamData])

  // ── Tab is URL state. router.replace so the back button still means "the
  // page before this client", not "the tab before this one". ──
  const setTab = useCallback((next: ClientTabId) => {
    setTabState(next)
    const params = new URLSearchParams(window.location.search)
    if (next === 'overview') params.delete('tab')
    else params.set('tab', next)
    const qs = params.toString()
    router.replace(`/clients/${clientId}${qs ? `?${qs}` : ''}`, { scroll: false })
  }, [clientId, router])

  // Panels belong to the tab that opened them, so a tab change clears both.
  useEffect(() => {
    setFileId(null)
    setContactId(null)
  }, [tab])

  // A tab change is a page change: start at the top of it.
  useEffect(() => {
    const main = document.getElementById('main-content') ?? document.scrollingElement
    if (main) main.scrollTop = 0
  }, [tab])

  useEffect(() => {
    if (error) router.push('/clients')
  }, [error, router])

  const upcomingCalls = useMemo(
    () => calls
      .filter(c => c.status === 'scheduled' && new Date(c.scheduledAt).getTime() >= Date.now())
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()),
    [calls],
  )

  const org = data?.org

  // The two money tabs are the ones a seat without clients.billing_card never
  // gets. Held here rather than inside the tab array so the Needs-you strip and
  // handleNeed answer to the same rule the strip's buttons have to obey.
  const tabAllowed = useCallback(
    (id: ClientTabId) => (id === 'invoices' || id === 'money' ? canMoney : true),
    [canMoney],
  )

  // Onboarding, derived the way the portal derives it rather than read straight
  // off the stored blob, which every import path seeds empty.
  const onboarding = useMemo(() => {
    if (!data) return null
    return clientOnboarding(data.org.onboardingState, data.org.onboardingLoomUrl, {
      requests,
      invoices,
      subscriptionStatus: data.subscription?.status ?? null,
      orgCreatedAt: data.org.createdAt ?? null,
    })
  }, [data, requests, invoices])

  const needs: NeedItem[] = useMemo(() => {
    if (!data) return []
    return needsFor({
      orgName: data.org.name,
      status: data.org.status,
      healthStatus: data.org.healthStatus,
      healthNote: data.org.healthNote,
      billingModel: data.org.billingModel,
      requests,
      invoices,
      contracts: contracts.map(k => ({
        id: k.id,
        name: k.name,
        status: k.status,
        // The route returns expiresAt; the old tab read a field that is not
        // on this response, which is why nothing ever warned about a lapse.
        expiryDate: k.expiresAt,
      })),
      contacts: data.contacts,
      calls,
      trackCount: data.tracks.length,
      occupiedTrackCount: data.tracks.filter(t => t.currentRequestId).length,
      canMoney,
      onboarding: onboarding ?? undefined,
    })
  }, [data, requests, invoices, contracts, calls, canMoney, onboarding])

  const handleNeed = useCallback((item: NeedItem) => {
    if (item.requestId) {
      router.push(`/requests/${item.requestId}`)
      return
    }
    // A tab this viewer does not have is not opened silently: setTab would
    // write ?tab= and the panel would fall back to Overview with no explanation.
    if (item.tab && tabAllowed(item.tab)) {
      if (item.tab === 'calls' && item.action.toLowerCase().includes('book')) setBookOpen(true)
      setTab(item.tab)
    }
  }, [router, setTab, tabAllowed])

  // A deep link to a tab this viewer cannot open renders Overview, so correct
  // the URL to match rather than leaving a link that never opens what it names.
  useEffect(() => {
    if (!tabAllowed(tab)) setTab('overview')
  }, [tab, tabAllowed, setTab])

  const handleOwnerChange = useCallback(async (pmId: string | null) => {
    try {
      const res = await fetch(apiPath(`/api/admin/clients/${clientId}/pm`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pmId }),
      })
      if (!res.ok) throw new Error('Failed')
      await mutatePm({ pmId, pmName: teamMembers.find(m => m.id === pmId)?.name ?? null }, { revalidate: true })
      showToast(pmId ? 'Account owner updated' : 'Account owner cleared', 'success')
    } catch {
      showToast('Could not change the account owner', 'error')
    }
  }, [clientId, mutatePm, showToast, teamMembers])

  const handleInvite = useCallback(async () => {
    if (!org) return
    setInviting(true)
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
      setInviting(false)
    }
  }, [clientId, load, org, showToast])

  const handleViewAs = useCallback(async () => {
    if (!data) return
    const { setImpersonation } = await import('@/components/tahi/impersonation-banner')
    const primaryContact = data.contacts.find(c => c.isPrimary) ?? data.contacts[0]
    setImpersonation({
      orgId: data.org.id,
      orgName: data.org.name,
      contactId: primaryContact?.id,
      contactName: primaryContact?.name,
    })
    router.push('/overview')
  }, [data, router])

  const runConfirm = useCallback(async () => {
    if (!org || !confirmAction) return
    const status = confirmAction === 'archive'
      ? (org.status === 'archived' ? 'active' : 'archived')
      : (org.status === 'paused' ? 'active' : 'paused')
    try {
      const res = await fetch(apiPath(`/api/admin/clients/${clientId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error('Failed')
      await load()
      showToast(
        confirmAction === 'archive'
          ? (status === 'archived' ? `${org.name} archived` : `${org.name} is back in your active clients`)
          : (status === 'paused' ? `${org.name} paused` : `${org.name} resumed`),
        'success',
      )
    } catch {
      showToast(`Could not ${confirmAction} this client. Please try again.`, 'error')
    } finally {
      setConfirmAction(null)
    }
  }, [clientId, confirmAction, load, org, showToast])

  if (loading) return <LoadingSkeleton />
  if (!data || !org) return null

  const { contacts, subscription, tracks, recentRequests } = data

  const openRequests = requests.filter(r => OPEN_REQUEST_STATUSES.includes(r.status))
  const overdueRequest = openRequests.some(r => {
    if (!r.dueDate) return false
    const d = new Date(r.dueDate)
    return !Number.isNaN(d.getTime()) && d < new Date()
  })
  const invoicesNow = new Date()
  const openInvoices = invoices.filter(i => OPEN_INVOICE_STATUSES.includes(i.status))
  // One predicate for the badge, the strip and the table, so a viewed invoice
  // thirty days past due cannot read red in one place and neutral in another.
  const overdueInvoice = invoices.some(i => isInvoiceOverdue(i, invoicesNow))
  const openPapers = contracts.filter(k => k.status === 'draft' || k.status === 'sent').length

  const tabs: ClientTabDef[] = [
    { id: 'overview', label: 'Overview', icon: Building2 },
    { id: 'requests', label: 'Requests', icon: Layers, count: openRequests.length, warn: overdueRequest },
    ...(canMoney
      ? [{ id: 'invoices' as const, label: 'Invoices', icon: DollarSign, count: openInvoices.length, warn: overdueInvoice }]
      : []),
    { id: 'files', label: 'Files', icon: File },
    { id: 'people', label: 'People', icon: Users, count: contacts.length },
    { id: 'papers', label: 'Papers', icon: ScrollText, count: openPapers },
    { id: 'calls', label: 'Calls', icon: Phone, count: upcomingCalls.length },
    ...(canMoney ? [{ id: 'money' as const, label: 'Money', icon: TrendingUp }] : []),
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
  ]

  // A tab the viewer cannot see must not stay open behind a deep link. The
  // effect above rewrites the URL; this keeps the render honest until it does.
  const activeTab: ClientTabId = tabs.some(t => t.id === tab) ? tab : 'overview'

  const nextCall: HeroCall | null = upcomingCalls[0]
    ? { id: upcomingCalls[0].id, title: upcomingCalls[0].title, scheduledAt: upcomingCalls[0].scheduledAt }
    : null

  const ownerName = teamMembers.find(m => m.id === (pmData?.pmId ?? null))?.name ?? pmData?.pmName ?? null

  return (
    <div className="flex flex-col min-h-0" style={{ gap: '1rem' }}>
      <Breadcrumb items={[{ label: 'Clients', href: '/clients' }, { label: org.name }]} />

      <ClientHero
        org={org}
        contacts={contacts}
        tracks={tracks}
        brands={brands}
        subscription={subscription}
        teamMembers={teamMembers}
        assignedPm={pmData?.pmId ?? null}
        nextCall={nextCall}
        canMoney={canMoney}
        inviting={inviting}
        healthReason={firstHealthReason({ healthNote: org.healthNote })}
        onTab={setTab}
        onInvite={() => { void handleInvite() }}
        onViewAs={() => { void handleViewAs() }}
        onOwnerChange={pmId => { void handleOwnerChange(pmId) }}
        onRefresh={() => { void load() }}
        onNewDeal={() => router.push(`/pipeline?new=1&orgId=${clientId}`)}
        onPauseToggle={() => setConfirmAction('pause')}
        onArchiveToggle={() => setConfirmAction('archive')}
      />

      <ClientTabs tabs={tabs} value={activeTab} onChange={setTab} />

      <div id={`client-panel-${activeTab}`} role="tabpanel" aria-labelledby={`client-tab-${activeTab}`}>
        {activeTab === 'overview' && (
          <OverviewTab
            clientId={clientId}
            org={org}
            contacts={contacts}
            subscription={subscription}
            tracks={tracks}
            requests={requests}
            recentRequests={recentRequests}
            needs={needs}
            needsLoading={requestsLoading}
            onboarding={onboarding}
            ownerName={ownerName}
            canMoney={canMoney}
            writeDisabled={false}
            onTab={setTab}
            onOpenRequest={id => router.push(`/requests/${id}`)}
            onNewRequest={() => setTab('requests')}
            onAct={handleNeed}
            onUpdated={load}
          />
        )}
        {activeTab === 'requests' && (
          <RequestsTab clientId={clientId} orgName={org.name} writeDisabled={false} />
        )}
        {activeTab === 'invoices' && (
          <InvoicesTab clientId={clientId} org={org} canMoney={canMoney} writeDisabled={false} onTab={setTab} />
        )}
        {activeTab === 'files' && (
          <FilesTab clientId={clientId} orgName={org.name} fileId={fileId} onOpenFile={setFileId} />
        )}
        {activeTab === 'people' && (
          <PeopleTab
            clientId={clientId}
            orgName={org.name}
            contacts={contacts}
            contactId={contactId}
            writeDisabled={false}
            onOpenContact={setContactId}
            onUpdated={load}
          />
        )}
        {activeTab === 'papers' && (
          <PapersTab clientId={clientId} orgName={org.name} writeDisabled={false} />
        )}
        {activeTab === 'calls' && (
          <CallsTab
            clientId={clientId}
            orgName={org.name}
            contacts={contacts}
            writeDisabled={false}
            bookOpen={bookOpen}
            onBookOpenChange={setBookOpen}
          />
        )}
        {activeTab === 'money' && (
          <MoneyTab clientId={clientId} org={org} canMoney={canMoney} />
        )}
        {activeTab === 'settings' && (
          <SettingsTab
            clientId={clientId}
            org={org}
            subscription={subscription}
            tracks={tracks}
            writeDisabled={false}
            onUpdated={load}
            onPauseToggle={() => setConfirmAction('pause')}
            onArchiveToggle={() => setConfirmAction('archive')}
          />
        )}
      </div>

      <ConfirmDialog
        open={confirmAction != null}
        variant={confirmAction === 'archive' && org.status !== 'archived' ? 'danger' : 'warning'}
        title={
          confirmAction === 'archive'
            ? (org.status === 'archived' ? `Unarchive ${org.name}?` : `Archive ${org.name}?`)
            : (org.status === 'paused' ? `Resume ${org.name}?` : `Pause ${org.name}?`)
        }
        description={
          confirmAction === 'archive'
            ? (org.status === 'archived'
              ? 'They reappear in your active client lists and can sign in to the portal again.'
              : 'They drop out of the active client lists and cannot sign in. Nothing is deleted, and you can unarchive them from the Archived view any time.')
            : (org.status === 'paused'
              ? 'They go back to active and their tracks reopen for work.'
              : 'They are marked paused. Open requests keep their place; nothing is cancelled.')
        }
        confirmLabel={
          confirmAction === 'archive'
            ? (org.status === 'archived' ? 'Unarchive' : 'Archive')
            : (org.status === 'paused' ? 'Resume' : 'Pause')
        }
        onConfirm={runConfirm}
        onCancel={() => setConfirmAction(null)}
      />

      {/* Mobile bottom nav spacer */}
      <div className="h-28 md:hidden" aria-hidden="true" />
    </div>
  )
}
