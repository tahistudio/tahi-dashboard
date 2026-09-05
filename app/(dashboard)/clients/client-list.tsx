'use client'

/**
 * The Clients list: the studio's own account layer, and the second reading of
 * the rail that Requests and Tasks already use.
 *
 * Shape, top to bottom: a page header with New client and an overflow, then
 * <RailLayout> carrying the saved views, the five filter dimensions, the sort
 * and Save as default, and inside it either the dense list or the portfolio
 * cards. Below lg the rail moves into the Filters sheet and the table becomes
 * one card per client, which is where every touch target grows to 2.75rem.
 *
 * Three things worth knowing before changing anything here.
 *
 * 1. Archived clients. GET /api/admin/clients hides them unless it is asked
 *    for them, so this page fetches both buckets and lets lib-side rules in
 *    _list/clients-views.ts decide which views may see them. Without the
 *    second fetch the Archived rail count would read zero from every other
 *    view, which is the exact lie a saved view is supposed to prevent.
 *
 * 2. MRR. The list endpoint physically cannot return it: customMrr lives in
 *    D1 but is deliberately absent from db/schema.ts, so the route's select()
 *    never sees it. The figures come from the existing read-only
 *    /api/admin/reports/retainer-health, fetched only when the viewer can see
 *    money, and a client with no figure prints its engagement word rather
 *    than a dash.
 *
 * 3. Scoping. An impersonated team member is filtered out of `rows` BEFORE
 *    the saved-view counts are taken, so the rail can never advertise a row
 *    that clicking it would refuse to open.
 */

import * as React from 'react'
import useSWR from 'swr'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import {
  ArchiveRestore, Archive, ArrowUpRight, Download, Eye, MailPlus,
  MoreHorizontal, Plus, Users,
} from 'lucide-react'
import { apiPath } from '@/lib/api'
import { PageHeader } from '@/components/tahi/page-header'
import { TahiButton } from '@/components/tahi/tahi-button'
import { Card } from '@/components/tahi/card'
import { Menu } from '@/components/tahi/menu'
import { DataTable, type DataTableAction, type DataTableColumn } from '@/components/tahi/data-table'
import { EmptyState } from '@/components/tahi/empty-state'
import { SkeletonTable } from '@/components/tahi/skeletons'
import { BulkActionBar, type BulkAction } from '@/components/tahi/bulk-action-bar'
import { PlanBadge } from '@/components/tahi/status-badge'
import { RelativeTime } from '@/components/tahi/relative-time'
import { useToast } from '@/components/tahi/toast'
import { useFeature } from '@/components/tahi/permissions-context'
import { useImpersonation, setImpersonation } from '@/components/tahi/impersonation-banner'
import { RailLayout } from '@/components/tahi/rail/rail-layout'
import { SaveDefaultControl, type RailFilterChip } from '@/components/tahi/rail/rail-controls'

import {
  ClientCell,
  ClientHealthBadge,
  ClientMoneyCell,
  ClientStatusBadge,
  ClientTagChips,
  OpenWorkCell,
  TrackMeterCell,
} from './_list/client-chips'
import { ClientMobileCard } from './_list/client-mobile-card'
import { ClientsCardsView } from './_list/clients-cards-view'
import { ClientsPageBar } from './_list/clients-page-bar'
import { ClientsRail, buildClientChips, clientTagOptions } from './_list/clients-rail'
import { ClientsViewSwitcher, CLIENTS_VIEW_PANEL_ID } from './_list/clients-view-switcher'
import { clientsToCsv, downloadCsv } from './_list/clients-csv'
import {
  EMPTY_CLIENT_DRAFT,
  NewClientPanel,
  canSubmitDraft,
  type NewClientDraft,
} from './_list/new-client-panel'
import {
  ARCHIVED_VIEW_KEY,
  DEFAULT_CLIENT_FILTERS,
  anyClientFilterActive,
  applyClientViews,
  clientTagValues,
  countClientsSavedViews,
  showsArchived,
  statusFromUrl,
  toClientRow,
  type ClientApiRow,
  type ClientFilterKey,
  type ClientRow,
} from './_list/clients-views'
import { useClientsRailState } from './_list/use-clients-rail-state'

/** The endpoint's page size. Not configurable, so it is stated once here. */
const PAGE_SIZE = 50

interface ClientsFetch {
  rows: ClientApiRow[]
  /** The live bucket came back full, so there is probably another page. */
  pageFull: boolean
}

interface RetainerHealthRow {
  orgId: string
  mrrNzd?: number | null
}

export function ClientList() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const { showToast } = useToast()

  // -- Who is looking -------------------------------------------------------

  const { isImpersonatingTeamMember, impersonatedAccessRules } = useImpersonation()
  const billingVisible = useFeature('clients.billing_card')
  const isViewerImpersonation = isImpersonatingTeamMember
    && impersonatedAccessRules.length > 0
    && impersonatedAccessRules.every(r => r.role === 'viewer')
  // A scoped teammate never sees money on this surface, exactly as the
  // prototype has it. The server keeps its own gate on the figures.
  const canSeeMoney = billingVisible && !isImpersonatingTeamMember
  const writeDisabled = isViewerImpersonation

  // -- URL ------------------------------------------------------------------

  const urlSearch = searchParams.get('q') ?? ''
  const urlStatus = statusFromUrl(searchParams.get('status'))
  const page = Math.max(1, Number.parseInt(searchParams.get('page') ?? '1', 10) || 1)

  const rail = useClientsRailState({
    canSeeMoney,
    initialQuery: urlSearch,
    initialStatus: urlStatus,
  })
  const { filters, savedView, sort, query, view } = rail

  const writeUrl = React.useCallback((mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString())
    mutate(params)
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname)
  }, [searchParams, pathname, router])

  const goToPage = React.useCallback((next: number) => {
    writeUrl(p => { if (next <= 1) p.delete('page'); else p.set('page', String(next)) })
  }, [writeUrl])

  // The search box drives two things: an instant client-side narrowing of the
  // page on screen, and a debounced `q` that re-asks the server so a name on
  // page four can still be found.
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleQueryChange = React.useCallback((value: string) => {
    rail.setQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      writeUrl(p => {
        p.delete('page')
        if (value.trim()) p.set('q', value.trim()); else p.delete('q')
      })
    }, 300)
  }, [rail, writeUrl])

  React.useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
  }, [])

  // Status is the one dimension a link can name, so it is the one that gets
  // written back. Everything else stays a per-user preference. Every
  // narrowing change also drops `page`: page three of the old filter answers
  // a brand new question with an empty list.
  const setFilters = React.useCallback((next: typeof filters) => {
    rail.setFilters(next)
    writeUrl(p => {
      p.delete('page')
      if (next.status === DEFAULT_CLIENT_FILTERS.status) p.delete('status')
      else p.set('status', next.status)
    })
  }, [rail, writeUrl])

  const setSavedView = React.useCallback((next: string | null) => {
    rail.setSavedView(next)
    writeUrl(p => p.delete('page'))
  }, [rail, writeUrl])

  // -- Data -----------------------------------------------------------------

  // GET /api/admin/clients hides archived rows unless it is asked for them, so
  // both buckets are always read and the rail decides which views may see
  // which. Fetching only the bucket on screen would make the rail lie in both
  // directions: Archived would read zero from the live views, and All clients
  // would read zero while standing in Archived.
  //
  // `page` follows whichever bucket the reader is actually paging through; the
  // other one is only there to be counted, so it stays on its first page.
  const archivedOnly = showsArchived(savedView, filters)
  const mode = archivedOnly ? 'archived' : 'live'

  const {
    data,
    error,
    isLoading,
    mutate: mutateClients,
  } = useSWR<ClientsFetch>(
    `admin/clients?search=${urlSearch}&mode=${mode}&page=${page}`,
    async () => {
      const live = new URLSearchParams()
      const archived = new URLSearchParams()
      if (urlSearch) {
        live.set('search', urlSearch)
        archived.set('search', urlSearch)
      }
      archived.set('status', 'archived')
      live.set('page', String(archivedOnly ? 1 : page))
      archived.set('page', String(archivedOnly ? page : 1))

      const [liveRes, archivedRes] = await Promise.all([
        fetch(apiPath(`/api/admin/clients?${live}`)),
        fetch(apiPath(`/api/admin/clients?${archived}`)),
      ])

      // The bucket being read is the one that has to succeed. The other only
      // feeds a rail count, so a failure there must not take the list down.
      const readRes = archivedOnly ? archivedRes : liveRes
      if (!readRes.ok) throw new Error('Failed to load clients')

      const liveRows = liveRes.ok
        ? ((await liveRes.json()) as { organisations?: ClientApiRow[] }).organisations ?? []
        : []
      const archivedRows = archivedRes.ok
        ? ((await archivedRes.json()) as { organisations?: ClientApiRow[] }).organisations ?? []
        : []
      const read = archivedOnly ? archivedRows : liveRows
      return { rows: [...liveRows, ...archivedRows], pageFull: read.length >= PAGE_SIZE }
    },
    { keepPreviousData: true },
  )

  // MRR, from the one existing read that has it. Skipped entirely for anyone
  // who cannot see money, and a 403 (no reports feature) simply leaves every
  // figure unknown rather than failing the page.
  const { data: healthData } = useSWR<RetainerHealthRow[]>(
    canSeeMoney ? 'admin/reports/retainer-health' : null,
    async () => {
      const res = await fetch(apiPath('/api/admin/reports/retainer-health'))
      if (!res.ok) return []
      return ((await res.json()) as { clients?: RetainerHealthRow[] }).clients ?? []
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  )

  const mrrByOrg = React.useMemo(() => {
    const map = new Map<string, number>()
    for (const row of healthData ?? []) {
      if (typeof row.mrrNzd === 'number' && row.mrrNzd > 0) map.set(row.orgId, row.mrrNzd)
    }
    return map
  }, [healthData])

  const rows = React.useMemo(
    () => (data?.rows ?? []).map(raw => toClientRow(raw, mrrByOrg.get(raw.id) ?? null)),
    [data, mrrByOrg],
  )

  // Scoping first, counting second. An impersonated teammate with no rules at
  // all sees nothing; the rules can scope by everyone, by plan, or by a named
  // set of clients.
  const scopedRows = React.useMemo(() => {
    if (!isImpersonatingTeamMember) return rows
    return rows.filter(org => {
      if (impersonatedAccessRules.length === 0) return false
      return impersonatedAccessRules.some(rule => {
        if (rule.scopeType === 'all_clients') return true
        if (rule.scopeType === 'plan_type') return org.planType === rule.planType
        if (rule.scopeType === 'specific_clients') return rule.orgIds?.includes(org.id) ?? false
        return false
      })
    })
  }, [rows, isImpersonatingTeamMember, impersonatedAccessRules])

  const counts = React.useMemo(() => countClientsSavedViews(scopedRows), [scopedRows])
  const visible = React.useMemo(
    () => applyClientViews(scopedRows, { savedView, filters, query, sort }),
    [scopedRows, savedView, filters, query, sort],
  )

  const tagOptions = React.useMemo(() => clientTagOptions(clientTagValues(scopedRows)), [scopedRows])
  const chips = React.useMemo(() => buildClientChips(filters, tagOptions), [filters, tagOptions])

  const clearChip = React.useCallback((chip: RailFilterChip) => {
    const key = chip.key as ClientFilterKey
    setFilters({ ...filters, [key]: DEFAULT_CLIENT_FILTERS[key] })
  }, [filters, setFilters])

  const clearAll = React.useCallback(() => {
    rail.setFilters({ ...DEFAULT_CLIENT_FILTERS })
    rail.setSavedView(null)
    rail.setQuery('')
    if (debounceRef.current) clearTimeout(debounceRef.current)
    writeUrl(p => { p.delete('q'); p.delete('status'); p.delete('page') })
  }, [rail, writeUrl])

  // -- Selection ------------------------------------------------------------

  const [selected, setSelected] = React.useState<ReadonlySet<string>>(() => new Set<string>())
  const lastIndexRef = React.useRef<number | null>(null)
  const visibleIds = React.useMemo(() => visible.map(r => r.id), [visible])

  // A selection that outlives the rows it named would archive something the
  // user can no longer see.
  React.useEffect(() => {
    setSelected(prev => {
      if (prev.size === 0) return prev
      const live = new Set(visibleIds)
      const next = new Set<string>()
      prev.forEach(id => { if (live.has(id)) next.add(id) })
      return next.size === prev.size ? prev : next
    })
  }, [visibleIds])

  const toggleRow = React.useCallback((id: string, index: number, shiftKey: boolean) => {
    setSelected(prev => {
      const next = new Set(prev)
      const anchor = lastIndexRef.current
      if (shiftKey && anchor !== null) {
        const from = Math.min(anchor, index)
        const to = Math.max(anchor, index)
        const turningOn = !prev.has(id)
        for (let i = from; i <= to; i += 1) {
          const rowId = visibleIds[i]
          if (!rowId) continue
          if (turningOn) next.add(rowId); else next.delete(rowId)
        }
      } else if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
    lastIndexRef.current = index
  }, [visibleIds])

  const allSelected = visibleIds.length > 0 && visibleIds.every(id => selected.has(id))
  const someSelected = !allSelected && visibleIds.some(id => selected.has(id))
  const toggleAll = React.useCallback(() => {
    setSelected(allSelected ? new Set<string>() : new Set(visibleIds))
    lastIndexRef.current = null
  }, [allSelected, visibleIds])
  const clearSelection = React.useCallback(() => setSelected(new Set<string>()), [])

  // -- Mutations ------------------------------------------------------------

  const patchStatus = React.useCallback(async (id: string, status: string) => {
    const res = await fetch(apiPath(`/api/admin/clients/${id}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (!res.ok) throw new Error('Failed to update the client')
  }, [])

  const setRowStatus = React.useCallback(async (row: ClientRow, status: string, verb: string) => {
    try {
      await patchStatus(row.id, status)
      showToast(`${row.name} ${verb}`, 'success')
      await mutateClients()
    } catch {
      showToast(`Could not update ${row.name}`, 'error')
    }
  }, [patchStatus, showToast, mutateClients])

  const invite = React.useCallback(async (row: ClientRow) => {
    try {
      const res = await fetch(apiPath(`/api/admin/clients/${row.id}/welcome-email`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const body = await res.json() as { sent?: number; total?: number; error?: string }
      if (!res.ok) {
        showToast(body.error ?? `The invite for ${row.name} did not send`, 'error')
        return
      }
      const sent = body.sent ?? 0
      const total = body.total ?? 0
      if (sent === 0) showToast(`No invite went out for ${row.name}`, 'error')
      else if (sent < total) showToast(`${sent} of ${total} invites sent for ${row.name}`, 'warning')
      else showToast(`Invite sent for ${row.name}`, 'success')
    } catch {
      showToast(`The invite for ${row.name} did not send`, 'error')
    }
  }, [showToast])

  const viewAsClient = React.useCallback((row: ClientRow) => {
    setImpersonation({ orgId: row.id, orgName: row.name })
    router.push('/overview')
  }, [router])

  const openClient = React.useCallback((row: ClientRow) => {
    router.push(`/clients/${row.id}`)
  }, [router])

  // -- New client -----------------------------------------------------------

  const [panelOpen, setPanelOpen] = React.useState(() => searchParams.get('new') === '1')
  const [draft, setDraft] = React.useState<NewClientDraft>(EMPTY_CLIENT_DRAFT)
  const [saving, setSaving] = React.useState(false)
  const [createError, setCreateError] = React.useState<string | null>(null)

  const openPanel = React.useCallback(() => {
    setDraft(EMPTY_CLIENT_DRAFT)
    setCreateError(null)
    setPanelOpen(true)
  }, [])

  const closePanel = React.useCallback(() => {
    setPanelOpen(false)
    setDraft(EMPTY_CLIENT_DRAFT)
    setCreateError(null)
  }, [])

  const updateDraft = React.useCallback(<K extends keyof NewClientDraft>(key: K, value: NewClientDraft[K]) => {
    setDraft(prev => ({ ...prev, [key]: value }))
    setCreateError(null)
  }, [])

  React.useEffect(() => {
    function handleShortcut(e: Event) {
      if ((e as CustomEvent).detail === 'new-client') openPanel()
    }
    window.addEventListener('tahi:shortcut', handleShortcut)
    return () => window.removeEventListener('tahi:shortcut', handleShortcut)
  }, [openPanel])

  const createClient = React.useCallback(async () => {
    if (!canSubmitDraft(draft)) {
      setCreateError('A client name is required, and the contact email has to look like one.')
      return
    }
    setSaving(true)
    setCreateError(null)
    try {
      const res = await fetch(apiPath('/api/admin/clients'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name,
          website: draft.website,
          industry: draft.industry,
          planType: draft.planType,
          primaryContactName: draft.primaryContactName,
          primaryContactEmail: draft.primaryContactEmail,
          sendInvite: draft.sendInvite,
        }),
      })
      if (!res.ok) {
        const body = await res.json() as { error?: string }
        throw new Error(body.error ?? 'Failed to create the client')
      }
      const body = await res.json() as {
        id?: string
        invite?: { email: string; link: string; emailed: boolean; error?: string } | null
      }
      // Report what actually happened to the invite. The panel promises an
      // email, so silently swallowing a failed send is what left an operator
      // believing a client had been let in when they had not.
      if (!body.invite) {
        showToast('Client created. Add a contact to invite them to the portal.', 'success')
      } else if (body.invite.emailed) {
        showToast(`Client created and invite sent to ${body.invite.email}`, 'success')
      } else if (draft.sendInvite) {
        showToast('Client created, but the invite email did not send. Resend it from the client page.', 'warning')
      } else {
        showToast('Client created. No invite sent yet.', 'success')
      }
      closePanel()
      await mutateClients()
      if (body.id) router.push(`/clients/${body.id}`)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }, [draft, showToast, closePanel, mutateClients, router])

  // -- Bulk -----------------------------------------------------------------

  const selectedRows = React.useMemo(
    () => visible.filter(r => selected.has(r.id)),
    [visible, selected],
  )

  const bulkStatus = React.useCallback(async (status: string) => {
    let ok = 0
    let failed = 0
    for (const row of selectedRows) {
      try {
        await patchStatus(row.id, status)
        ok += 1
      } catch {
        failed += 1
      }
    }
    await mutateClients()
    clearSelection()
    return { ok, failed }
  }, [selectedRows, patchStatus, mutateClients, clearSelection])

  const bulkActions = React.useMemo<BulkAction[]>(() => {
    const actions: BulkAction[] = [
      { id: 'active', section: 'Status', label: 'Mark active', verb: 'set to active', run: () => bulkStatus('active') },
      { id: 'paused', section: 'Status', label: 'Mark paused', verb: 'paused', run: () => bulkStatus('paused') },
      { id: 'churned', section: 'Status', label: 'Mark churned', verb: 'marked churned', run: () => bulkStatus('churned') },
    ]
    if (archivedOnly) {
      actions.push({
        id: 'restore',
        section: 'Archive',
        label: 'Restore from archive',
        icon: <ArchiveRestore size={14} aria-hidden="true" />,
        verb: 'restored',
        run: () => bulkStatus('active'),
      })
    } else {
      actions.push({
        id: 'archive',
        section: 'Danger',
        label: 'Archive',
        icon: <Archive size={14} aria-hidden="true" />,
        tone: 'danger',
        verb: 'archived',
        confirm: {
          title: `Archive ${selectedRows.length} ${selectedRows.length === 1 ? 'client' : 'clients'}?`,
          description: 'They drop out of the working list and cannot sign in to the portal. Nothing is deleted, and the Archived view brings them back.',
          confirmLabel: 'Archive',
          variant: 'danger',
        },
        run: () => bulkStatus('archived'),
      })
    }
    return actions
  }, [archivedOnly, bulkStatus, selectedRows.length])

  /** The header export takes the whole view. The bulk bar takes the
   *  selection. Neither pretends to export what is behind the page. */
  const exportView = React.useCallback(() => {
    downloadCsv(`tahi-clients-${new Date().toISOString().slice(0, 10)}.csv`, clientsToCsv(visible, canSeeMoney))
    showToast(`${visible.length} ${visible.length === 1 ? 'client' : 'clients'} exported`, 'success')
  }, [visible, canSeeMoney, showToast])

  // -- Columns --------------------------------------------------------------

  const rowIndex = React.useMemo(() => {
    const map = new Map<string, number>()
    visible.forEach((row, i) => map.set(row.id, i))
    return map
  }, [visible])

  const columns = React.useMemo<DataTableColumn<ClientRow>[]>(() => {
    const list: DataTableColumn<ClientRow>[] = [
      {
        key: '__select',
        width: '2.75rem',
        header: (
          <SelectBox
            checked={allSelected}
            indeterminate={someSelected}
            label={allSelected ? 'Deselect every client on screen' : 'Select every client on screen'}
            onToggle={toggleAll}
          />
        ),
        render: row => (
          <FullCellSelect
            checked={selected.has(row.id)}
            label={selected.has(row.id) ? `Deselect ${row.name}` : `Select ${row.name}`}
            onToggle={shiftKey => toggleRow(row.id, rowIndex.get(row.id) ?? 0, shiftKey)}
          />
        ),
      },
      {
        key: 'name',
        header: 'Client',
        minWidth: '17rem',
        render: row => <ClientCell row={row} />,
      },
      {
        key: 'status',
        header: 'Status',
        width: '7rem',
        render: row => <ClientStatusBadge status={row.status} />,
      },
      {
        key: 'plan',
        header: 'Plan and tracks',
        width: '11rem',
        render: row => (
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.3125rem' }}>
            <PlanBadge plan={row.planType} />
            <TrackMeterCell tracks={row.tracks} engagement={row.engagement} />
          </span>
        ),
      },
    ]

    if (canSeeMoney) {
      list.push({
        key: 'mrr',
        header: 'MRR',
        width: '7rem',
        render: row => <ClientMoneyCell row={row} />,
      })
    }

    list.push(
      {
        key: 'health',
        header: 'Health',
        width: '7.5rem',
        render: row => <ClientHealthBadge row={row} />,
      },
      {
        key: 'open',
        header: 'Open',
        width: '7rem',
        render: row => <OpenWorkCell row={row} />,
      },
      {
        key: 'tags',
        header: 'Tags',
        width: '9rem',
        render: row => row.tags.length > 0
          ? <ClientTagChips tags={row.tags} />
          : <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>None</span>,
      },
      {
        key: 'updatedAt',
        header: 'Last activity',
        width: '9.5rem',
        render: row => {
          const ts = row.updatedAt ?? row.createdAt
          if (!ts) return <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>Never</span>
          return (
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              <RelativeTime date={ts} />
            </span>
          )
        },
      },
    )

    return list
  }, [allSelected, someSelected, toggleAll, selected, toggleRow, rowIndex, canSeeMoney])

  const rowActions = React.useCallback((row: ClientRow): DataTableAction[] => {
    const actions: DataTableAction[] = [
      { label: 'Open client', icon: <ArrowUpRight size={14} />, onClick: () => openClient(row) },
      { label: 'View as client', icon: <Eye size={14} />, onClick: () => viewAsClient(row) },
    ]
    if (!writeDisabled) {
      actions.push({ label: 'Invite to portal', icon: <MailPlus size={14} />, onClick: () => { void invite(row) } })
      actions.push(row.status === 'archived'
        ? {
          label: 'Restore from archive',
          icon: <ArchiveRestore size={14} />,
          onClick: () => { void setRowStatus(row, 'active', 'is back in the list') },
        }
        : {
          label: 'Archive client',
          icon: <Archive size={14} />,
          tone: 'danger',
          onClick: () => { void setRowStatus(row, 'archived', 'archived') },
        })
    }
    return actions
  }, [openClient, viewAsClient, invite, setRowStatus, writeDisabled])

  // -- Render ---------------------------------------------------------------

  const filtersActive = anyClientFilterActive(filters)
    || !!savedView
    || query.trim().length > 0
    || urlSearch.length > 0
  const firstLoad = isLoading && !data
  // "No clients yet" is only true when nothing is narrowing the list. With a
  // search or a filter on, an empty result is a miss, and offering "Add the
  // first client" would be answering a question nobody asked.
  const nothingAtAll = !firstLoad && !error && scopedRows.length === 0 && !filtersActive

  const emptyState = (
    <EmptyState
      icon={<Users className="w-6 h-6" />}
      title={nothingAtAll
        ? (isImpersonatingTeamMember ? 'No clients in scope for this teammate' : 'No clients yet')
        : 'No clients match'}
      description={nothingAtAll
        ? (isImpersonatingTeamMember
          ? 'Their access rules do not reach any client, so this list is empty for them.'
          : 'Add the first one and the roster starts here. Give them a primary contact and we email that person a link into their portal.')
        : 'Try clearing a filter, a saved view, or the search.'}
      action={nothingAtAll
        ? (!writeDisabled && !isImpersonatingTeamMember
          ? <TahiButton size="sm" style={{ minHeight: '2.75rem' }} onClick={openPanel} iconLeft={<Plus className="w-3.5 h-3.5" />}>Add the first client</TahiButton>
          : undefined)
        : <TahiButton size="sm" style={{ minHeight: '2.75rem' }} variant="secondary" onClick={clearAll}>Clear filters</TahiButton>}
    />
  )

  const body = (() => {
    if (firstLoad) {
      return (
        <Card padding="none">
          <SkeletonTable rows={6} columns={canSeeMoney ? 6 : 5} />
        </Card>
      )
    }
    if (error) {
      return (
        <Card padding="lg">
          <EmptyState
            variant="inline"
            icon={<Users className="w-6 h-6" />}
            title="The client list did not load"
            description="The request to the clients endpoint failed. Nothing has changed on your side."
            action={<TahiButton size="sm" style={{ minHeight: '2.75rem' }} onClick={() => { void mutateClients() }}>Try again</TahiButton>}
          />
        </Card>
      )
    }
    if (view === 'cards') {
      return visible.length === 0
        ? <Card padding="lg">{emptyState}</Card>
        : <ClientsCardsView rows={visible} canSeeMoney={canSeeMoney} onOpen={openClient} />
    }
    return (
      <Card padding="none">
        <DataTable<ClientRow>
          ariaLabel="Clients"
          columns={columns}
          rows={visible}
          getRowId={r => r.id}
          density="compact"
          loading={false}
          paginate={false}
          onRowClick={openClient}
          rowActions={rowActions}
          empty={emptyState}
          mobileCard={row => (
            <ClientMobileCard
              row={row}
              canSeeMoney={canSeeMoney}
              selected={selected.has(row.id)}
              onToggleSelect={() => toggleRow(row.id, rowIndex.get(row.id) ?? 0, false)}
              onOpen={() => openClient(row)}
              onViewAs={() => viewAsClient(row)}
            />
          )}
        />
      </Card>
    )
  })()

  const railProps = {
    savedView,
    onSavedViewChange: setSavedView,
    counts,
    filters,
    onFiltersChange: setFilters,
    sort,
    onSortChange: rail.setSort,
    tagOptions,
    canSeeMoney,
    isDefault: rail.isDefault,
    onSaveDefault: rail.saveDefault,
  }

  const subtitle = archivedOnly
    ? 'Archived accounts. Everything is kept, and restoring one puts it straight back in the list.'
    : 'Every account: who they are, what they pay, how they are doing, and what needs you.'

  return (
    <div className="space-y-5">
      <PageHeader title="Clients" subtitle={subtitle}>
        <div className="flex items-center" style={{ gap: '0.5rem' }}>
          {!writeDisabled && (
            <TahiButton
              iconLeft={<Plus className="w-4 h-4" />}
              onClick={openPanel}
              size="md"
              style={{ minHeight: '2.75rem' }}
            >
              New client
            </TahiButton>
          )}
          <Menu
            align="end"
            width="14rem"
            trigger={
              <button
                type="button"
                aria-label="More client actions"
                className="tahi-focus-ring inline-flex items-center justify-center h-11 w-11 md:h-9 md:w-9"
                style={{
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--color-bg)',
                  color: 'var(--color-text-muted)',
                  cursor: 'pointer',
                }}
              >
                <MoreHorizontal size={16} aria-hidden="true" />
              </button>
            }
          >
            <Menu.Item icon={<Download size={14} />} onClick={exportView}>
              Export this view as CSV
            </Menu.Item>
          </Menu>
        </div>
      </PageHeader>

      <RailLayout
        rail={<ClientsRail {...railProps} />}
        railTouch={<ClientsRail {...railProps} touch />}
        switcher={<ClientsViewSwitcher value={view} onChange={rail.setView} />}
        chips={chips}
        onClearChip={clearChip}
        onClearAll={clearAll}
        onResetDefault={rail.hasDefault && !rail.isDefault ? rail.resetToDefault : undefined}
        query={query}
        onQueryChange={handleQueryChange}
        searchPlaceholder="Search clients, sites or tags"
        total={visible.length}
        itemNoun="client"
        loading={firstLoad}
        extraActiveCount={savedView ? 1 : 0}
        saveDefaultTouch={<SaveDefaultControl isDefault={rail.isDefault} onSave={rail.saveDefault} touch />}
      >
        <div id={CLIENTS_VIEW_PANEL_ID} role="tabpanel" className="flex flex-col" style={{ gap: '0.75rem' }}>
          {selected.size > 0 && (
            <BulkActionBar
              selectedCount={selected.size}
              itemNoun="client"
              primaryAction={{
                id: 'export',
                label: 'Export CSV',
                icon: <Download size={14} aria-hidden="true" />,
                run: () => {
                  downloadCsv(
                    `tahi-clients-${new Date().toISOString().slice(0, 10)}.csv`,
                    clientsToCsv(selectedRows, canSeeMoney),
                  )
                  return { ok: selectedRows.length }
                },
                verb: 'exported',
              }}
              actions={writeDisabled ? [] : bulkActions}
              onClear={clearSelection}
            />
          )}

          {body}

          {!firstLoad && !error && (
            <ClientsPageBar
              page={page}
              shown={visible.length}
              pageSize={PAGE_SIZE}
              hasNext={!!data?.pageFull}
              onPageChange={next => { goToPage(next); clearSelection() }}
            />
          )}

          {filtersActive && visible.length === 0 && scopedRows.length > 0 && view === 'list' && (
            <p style={{ margin: 0, fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>
              {scopedRows.length} {scopedRows.length === 1 ? 'client is' : 'clients are'} loaded but hidden by the
              {savedView === ARCHIVED_VIEW_KEY ? ' archived view' : ' current filters'}.
            </p>
          )}
        </div>
      </RailLayout>

      <NewClientPanel
        open={panelOpen}
        draft={draft}
        saving={saving}
        error={createError}
        onUpdate={updateDraft}
        onClose={closePanel}
        onSubmit={() => { void createClient() }}
      />
    </div>
  )
}

// -- Selection controls ------------------------------------------------------

/** The visual box. Shared by the header control and the row control so the
 *  two can never drift apart. */
function CheckboxGlyph({ checked, indeterminate = false }: { checked: boolean; indeterminate?: boolean }) {
  const filled = checked || indeterminate
  return (
    <span
      aria-hidden="true"
      style={{
        width: '1.125rem',
        height: '1.125rem',
        flex: 'none',
        boxSizing: 'border-box',
        borderRadius: 'var(--radius-sm)',
        border: `1px solid ${filled ? 'var(--color-brand)' : 'var(--color-border)'}`,
        background: filled ? 'var(--color-brand)' : 'var(--color-bg)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {indeterminate && (
        <span style={{ width: '0.5rem', height: '0.125rem', borderRadius: 'var(--radius-full)', background: 'var(--color-text-on-dark)' }} />
      )}
      {checked && !indeterminate && (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-on-dark)" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12.5l5.5 5.5L20 6.5" />
        </svg>
      )}
    </span>
  )
}

function SelectBox({
  checked,
  indeterminate,
  label,
  onToggle,
}: {
  checked: boolean
  indeterminate: boolean
  label: string
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={label}
      title={label}
      onClick={e => { e.stopPropagation(); onToggle() }}
      className="tahi-focus-ring inline-flex items-center justify-center"
      style={{
        width: '1.5rem',
        height: '1.5rem',
        padding: 0,
        border: 'none',
        borderRadius: 'var(--radius-sm)',
        background: 'transparent',
        cursor: 'pointer',
      }}
    >
      <CheckboxGlyph checked={checked} indeterminate={indeterminate} />
    </button>
  )
}

/**
 * The row control, sized to fill the whole cell rather than sitting as an
 * 18px dot inside it. The negative margins cancel the cell's own padding and
 * the matching padding puts it back, so the button IS the cell: clicking the
 * space beside the box selects the row, which is what the design review asked
 * for. `userSelect: none` keeps a shift-drag from painting a text selection
 * down the table.
 */
function FullCellSelect({
  checked,
  label,
  onToggle,
}: {
  checked: boolean
  label: string
  onToggle: (shiftKey: boolean) => void
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={e => {
        e.stopPropagation()
        if (e.shiftKey) window.getSelection()?.removeAllRanges()
        onToggle(e.shiftKey)
      }}
      className="tahi-focus-ring"
      style={{
        display: 'flex',
        alignItems: 'center',
        width: 'calc(100% + 2rem)',
        height: '100%',
        minHeight: '2.75rem',
        margin: '-0.5rem -1rem',
        padding: '0.5rem 1rem',
        border: 'none',
        borderRadius: 0,
        background: 'transparent',
        cursor: 'pointer',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      <CheckboxGlyph checked={checked} />
    </button>
  )
}
