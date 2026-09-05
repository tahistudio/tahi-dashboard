'use client'

/**
 * The Clients list: the studio's own account layer, and the second reading of
 * the rail that Requests and Tasks already use.
 *
 * Shape, top to bottom: a page header with New client and an overflow, then
 * <RailLayout> carrying the saved views, the six filter dimensions, the sort
 * and Save as default, and inside it either the dense list or the portfolio
 * cards. Below lg the rail moves into the Filters sheet and the table becomes
 * one card per client, which is where every touch target grows to 2.75rem.
 *
 * Four things worth knowing before changing anything here.
 *
 * 1. Archived clients. GET /api/admin/clients hides them unless it is asked
 *    for them, so this page fetches both buckets and lets lib-side rules in
 *    _list/clients-views.ts decide which views may see them. Without the
 *    second fetch the Archived rail count would read zero from every other
 *    view, which is the exact lie a saved view is supposed to prevent.
 *
 * 2. What a count covers. The endpoint pages at 50 and returns no total, so
 *    once a full page comes back the rail counts describe the clients loaded
 *    and not the roster. Status and plan are therefore pushed to the server,
 *    which is the one narrowing it can do before it pages; health, owner, tag
 *    and tracks can only narrow what came back, and the rail and the page bar
 *    say so in words rather than letting a number imply otherwise.
 *
 * 3. MRR and owners. The list endpoint carries neither. customMrr lives in D1
 *    but is deliberately absent from db/schema.ts, so the route's select()
 *    never sees it, and the owner is a project_manager access rule rather than
 *    a column. Both are read from existing read-only endpoints, both are
 *    skipped when the viewer may not see them, and both distinguish "this
 *    client has none" from "the read failed": a cell that prints "Not set"
 *    over a $4,000 retainer is worse than one that says it does not know.
 *
 * 4. Scoping. An impersonated team member is filtered out of `rows` BEFORE
 *    the saved-view counts are taken, so the rail can never advertise a row
 *    that clicking it would refuse to open.
 */

import * as React from 'react'
import useSWR from 'swr'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import {
  AlertTriangle, ArchiveRestore, Archive, ArrowUpRight, Download, Eye, MailPlus,
  MoreHorizontal, Plus, Tag as TagIcon, Users,
} from 'lucide-react'
import { apiPath } from '@/lib/api'
import { mapLimit } from '@/lib/concurrency'
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
import { useFeature, usePermissions } from '@/components/tahi/permissions-context'
import { useImpersonation, setImpersonation } from '@/components/tahi/impersonation-banner'
import { RailLayout } from '@/components/tahi/rail/rail-layout'
import { SaveDefaultControl, type RailFilterChip } from '@/components/tahi/rail/rail-controls'

import {
  ClientCell,
  ClientHealthBadge,
  ClientMoneyCell,
  ClientOwnerCell,
  ClientStatusBadge,
  ClientTagChips,
  OpenWorkCell,
  TrackMeterCell,
} from './_list/client-chips'
import { ClientMobileCard } from './_list/client-mobile-card'
import { ClientsCardsView } from './_list/clients-cards-view'
import { ClientsPageBar } from './_list/clients-page-bar'
import { ClientsRail, buildClientChips, clientOwnerOptions, clientTagOptions } from './_list/clients-rail'
import { ClientsViewSwitcher, CLIENTS_VIEW_PANEL_ID } from './_list/clients-view-switcher'
import { clientsToCsv, downloadCsv } from './_list/clients-csv'
import {
  EMPTY_CLIENT_DRAFT,
  NewClientPanel,
  canSubmitDraft,
  draftContactName,
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
import { useClientOwners } from './_list/use-client-owners'
import { useClientsRailState } from './_list/use-clients-rail-state'

/** The endpoint's page size. Not configurable, so it is stated once here. */
const PAGE_SIZE = 50

interface ClientsFetch {
  /** Both buckets, merged. The views decide which of them may be seen. */
  rows: ClientApiRow[]
  /** The bucket being paged came back full, so there is probably another. */
  pageFull: boolean
}

interface RetainerHealthRow {
  orgId: string
  mrrNzd?: number | null
}

interface MrrRead {
  rows: RetainerHealthRow[]
  /** False when the report refused or failed, which is a different fact from
   *  "this client has no MRR". */
  ok: boolean
}

/** The plan values the endpoint can filter on. "none" is not one of them: the
 *  column holds NULL as well as the literal string, so `?plan=none` would
 *  quietly drop every client whose plan was never set. That one stays here. */
function serverPlan(plan: string): string | null {
  return plan === 'all' || plan === 'none' ? null : plan
}

/** The status values the endpoint can filter on before it pages. Archived is
 *  not one of them here: it already drives which bucket is being read. */
function serverStatus(status: string): string | null {
  return status === 'all' || status === 'archived' ? null : status
}

export function ClientList() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const { showToast } = useToast()

  // -- Who is looking -------------------------------------------------------

  const { isImpersonatingTeamMember, impersonatedAccessRules } = useImpersonation()
  const billingVisible = useFeature('clients.billing_card')
  const { level } = usePermissions()
  const isViewerImpersonation = isImpersonatingTeamMember
    && impersonatedAccessRules.length > 0
    && impersonatedAccessRules.every(r => r.role === 'viewer')
  // A scoped teammate never sees money on this surface, exactly as the
  // prototype has it. `useFeature` fails open on an unknown key, so the level
  // is part of the gate too: otherwise a real team member signed in as
  // themselves reads a column the impersonated version of them cannot. The
  // server keeps its own gate on the figures either way.
  const canSeeMoney = billingVisible && level !== 'team_member' && !isImpersonatingTeamMember
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
  const { setQuery: setRailQuery, syncUrlStatus } = rail
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  // The last `q` this page put in the URL. Anything else arriving in `q` came
  // from outside (Back, forward, a pasted link), and that is the only case the
  // mirror below is allowed to overwrite the box with.
  const writtenSearchRef = React.useRef(urlSearch)
  const handleQueryChange = React.useCallback((value: string) => {
    setRailQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      writtenSearchRef.current = value.trim()
      writeUrl(p => {
        p.delete('page')
        if (value.trim()) p.set('q', value.trim()); else p.delete('q')
      })
    }, 300)
  }, [setRailQuery, writeUrl])

  React.useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
  }, [])

  // Back out of a search has to move the box, not just the fetch. Without
  // this, `?q=` disappears, the list reloads unsearched, and the rail keeps
  // narrowing the rows by text that is no longer in the address bar, so Back
  // looks like it did nothing.
  React.useEffect(() => {
    if (urlSearch === writtenSearchRef.current) return
    writtenSearchRef.current = urlSearch
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setRailQuery(urlSearch)
  }, [urlSearch, setRailQuery])

  // The same for the one filter a link can name.
  React.useEffect(() => {
    syncUrlStatus(urlStatus)
  }, [urlStatus, syncUrlStatus])

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
  // The two dimensions the endpoint can narrow on before it pages. Leaving
  // them client-side is what made "Plan: Scale" on page one answer "no clients
  // match" while every match sat on page two.
  const askStatus = serverStatus(filters.status)
  const askPlan = serverPlan(filters.plan)

  const {
    data,
    error,
    isLoading,
    mutate: mutateClients,
  } = useSWR<ClientsFetch>(
    `admin/clients?search=${urlSearch}&mode=${mode}&page=${page}&status=${askStatus ?? ''}&plan=${askPlan ?? ''}`,
    async () => {
      const live = new URLSearchParams()
      const archived = new URLSearchParams()
      if (urlSearch) {
        live.set('search', urlSearch)
        archived.set('search', urlSearch)
      }
      if (askStatus) live.set('status', askStatus)
      if (askPlan) {
        live.set('plan', askPlan)
        archived.set('plan', askPlan)
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
  // who cannot see money. A 403 (the report carries its own `reports` gate,
  // which the billing card does not imply) is reported rather than swallowed:
  // the column then says "Unknown", because "Not set" would be a statement
  // about the client made from a request that never arrived.
  const { data: mrrRead } = useSWR<MrrRead>(
    canSeeMoney ? 'admin/reports/retainer-health' : null,
    async () => {
      const res = await fetch(apiPath('/api/admin/reports/retainer-health'))
      if (!res.ok) return { rows: [], ok: false }
      return { rows: ((await res.json()) as { clients?: RetainerHealthRow[] }).clients ?? [], ok: true }
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  )
  const mrrUnknown = canSeeMoney && mrrRead?.ok !== true

  const mrrByOrg = React.useMemo(() => {
    const map = new Map<string, number>()
    for (const row of mrrRead?.rows ?? []) {
      if (typeof row.mrrNzd === 'number' && row.mrrNzd > 0) map.set(row.orgId, row.mrrNzd)
    }
    return map
  }, [mrrRead])

  // Who holds each account. Read-only, cached for the session, and never
  // allowed to fail the list.
  const owners = useClientOwners()

  const rows = React.useMemo(
    () => (data?.rows ?? []).map(raw => toClientRow(
      raw,
      mrrByOrg.get(raw.id) ?? null,
      owners.byOrg.get(raw.id) ?? null,
    )),
    [data, mrrByOrg, owners],
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

  // Until the owner index lands, every row's ownerId is null, so applying the
  // Owner dimension would empty the list and then refill it a moment later.
  // The rail keeps showing what the user picked; only the narrowing waits.
  const effectiveFilters = React.useMemo(
    () => (owners.known || filters.owner === DEFAULT_CLIENT_FILTERS.owner
      ? filters
      : { ...filters, owner: DEFAULT_CLIENT_FILTERS.owner }),
    [filters, owners.known],
  )

  const visible = React.useMemo(
    () => applyClientViews(scopedRows, { savedView, filters: effectiveFilters, query, sort }),
    [scopedRows, savedView, effectiveFilters, query, sort],
  )

  const tagOptions = React.useMemo(() => clientTagOptions(clientTagValues(scopedRows)), [scopedRows])
  const ownerOptions = React.useMemo(
    () => clientOwnerOptions(owners.owners, owners.known),
    [owners],
  )
  const chips = React.useMemo(
    () => buildClientChips(filters, tagOptions, ownerOptions),
    [filters, tagOptions, ownerOptions],
  )

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

  // The table owns the mechanics: the checkbox column, shift-range, select
  // all, and the brand tint on a selected row. This page owns the set, so the
  // bulk bar and the mobile card can read it.
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(() => new Set<string>())
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

  /** The one toggle the mobile card needs: below md the table is unmounted, so
   *  its own checkbox never renders. */
  const toggleRow = React.useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  const clearSelection = React.useCallback(() => setSelected(new Set<string>()), [])

  // -- Mutations ------------------------------------------------------------

  const patchClient = React.useCallback(async (id: string, body: Record<string, unknown>) => {
    const res = await fetch(apiPath(`/api/admin/clients/${id}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error('Failed to update the client')
  }, [])

  const patchStatus = React.useCallback(
    (id: string, status: string) => patchClient(id, { status }),
    [patchClient],
  )

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
          // The endpoint and the contacts table both hold one name, so the
          // panel's two fields are joined here. Empty stays empty, which is
          // what leaves the route free to fall back to the address.
          primaryContactName: draftContactName(draft),
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

  /** One PATCH per row, a few at a time. A serial loop over a full page is 50
   *  sequential round trips to D1 with the bulk bar sat busy throughout, and a
   *  bare Promise.all over the same 50 is a thundering herd. */
  const bulkPatch = React.useCallback(async (
    rows: readonly ClientRow[],
    body: (row: ClientRow) => Record<string, unknown> | null,
  ) => {
    const results = await mapLimit(rows, 6, async row => {
      const payload = body(row)
      if (!payload) return 'skipped' as const
      try {
        await patchClient(row.id, payload)
        return 'ok' as const
      } catch {
        return 'failed' as const
      }
    })
    await mutateClients()
    clearSelection()
    return {
      ok: results.filter(r => r === 'ok').length,
      failed: results.filter(r => r === 'failed').length,
    }
  }, [patchClient, mutateClients, clearSelection])

  const bulkStatus = React.useCallback(
    (status: string) => bulkPatch(selectedRows, () => ({ status })),
    [bulkPatch, selectedRows],
  )

  /** Adds one label to every selected client, leaving the labels they already
   *  carry alone. A row that already has it is skipped rather than rewritten. */
  const bulkTag = React.useCallback(
    (tag: string) => bulkPatch(
      selectedRows,
      row => (row.tags.includes(tag) ? null : { tags: JSON.stringify([...row.tags, tag]) }),
    ),
    [bulkPatch, selectedRows],
  )

  /** Every label already in use on the loaded roster. A bulk tag can only ever
   *  apply a label the studio has, which is the same rule the Tag filter
   *  follows: the organisations table has no managed tag vocabulary. */
  const bulkTagValues = React.useMemo(() => clientTagValues(scopedRows), [scopedRows])

  const bulkActions = React.useMemo<BulkAction[]>(() => {
    const actions: BulkAction[] = [
      { id: 'active', section: 'Status', label: 'Mark active', verb: 'set to active', run: () => bulkStatus('active') },
      { id: 'paused', section: 'Status', label: 'Mark paused', verb: 'paused', run: () => bulkStatus('paused') },
      { id: 'churned', section: 'Status', label: 'Mark churned', verb: 'marked churned', run: () => bulkStatus('churned') },
    ]
    for (const tag of bulkTagValues) {
      actions.push({
        id: `tag:${tag}`,
        section: 'Add tag',
        label: tag,
        icon: <TagIcon size={14} aria-hidden="true" />,
        verb: `tagged ${tag}`,
        run: () => bulkTag(tag),
      })
    }
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
  }, [archivedOnly, bulkStatus, bulkTag, bulkTagValues, selectedRows.length])

  /** The header export takes the whole view. The bulk bar takes the
   *  selection. Neither pretends to export what is behind the page. */
  const exportView = React.useCallback(() => {
    downloadCsv(`tahi-clients-${new Date().toISOString().slice(0, 10)}.csv`, clientsToCsv(visible, canSeeMoney))
    showToast(`${visible.length} ${visible.length === 1 ? 'client' : 'clients'} exported`, 'success')
  }, [visible, canSeeMoney, showToast])

  // -- Columns --------------------------------------------------------------

  const columns = React.useMemo<DataTableColumn<ClientRow>[]>(() => {
    const list: DataTableColumn<ClientRow>[] = [
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
        render: row => <ClientMoneyCell row={row} unknownLabel={mrrUnknown ? 'Unknown' : undefined} />,
      })
    }

    list.push(
      {
        key: 'health',
        header: 'Health',
        width: '7.5rem',
        // data-row-control is what DataTable's row click looks for before it
        // navigates. Without it, a tap that opens the reasons bubble on a
        // touch tablet also pushes /clients/{id} out from under it.
        render: row => (
          <span data-row-control style={{ display: 'inline-flex' }}>
            <ClientHealthBadge row={row} />
          </span>
        ),
      },
      {
        key: 'open',
        header: 'Open',
        width: '7rem',
        render: row => <OpenWorkCell row={row} />,
      },
      {
        key: 'owner',
        header: 'Owner',
        width: '8.5rem',
        render: row => <ClientOwnerCell row={row} known={owners.known} />,
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
  }, [canSeeMoney, mrrUnknown, owners.known])

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
  const pageFull = !!data?.pageFull
  // Rows the current view is allowed to show at all. The archived bucket is
  // always loaded so the Archived count can be honest, so counting it towards
  // "is the roster empty" would put a studio with an empty live list and a
  // full archive into the filtered branch with nothing filtering.
  const viewableRows = React.useMemo(
    () => (archivedOnly ? scopedRows : scopedRows.filter(r => r.status !== 'archived')),
    [scopedRows, archivedOnly],
  )
  // "No clients yet" is only true on the first page, with nothing narrowing
  // the list. On page two an empty result means the page is past the end, and
  // offering "Add the first client" to a studio with 50 of them is nonsense.
  const nothingAtAll = !firstLoad && !error && page === 1 && viewableRows.length === 0 && !filtersActive
  const pastTheEnd = !firstLoad && !error && page > 1 && viewableRows.length === 0
  // The page came back with rows, and the client-side half of the rail hid all
  // of them. There may well be matches on the next page, so the useful action
  // is Next, not Clear.
  const missOnThisPage = !nothingAtAll && !pastTheEnd && (pageFull || page > 1)

  const emptyTitle = nothingAtAll
    ? (isImpersonatingTeamMember ? 'No clients in scope for this teammate' : 'No clients yet')
    : pastTheEnd
      ? 'Nothing on this page'
      : missOnThisPage
        ? 'No matches on this page'
        : 'No clients match'

  const emptyDescription = nothingAtAll
    ? (isImpersonatingTeamMember
      ? 'Their access rules do not reach any client, so this list is empty for them.'
      : 'Add the first one and the roster starts here. Give them a primary contact and we email that person a link into their portal.')
    : pastTheEnd
      ? 'This page is past the end of the list. The clients are on the earlier pages.'
      : missOnThisPage
        ? 'Health, owner, tag and track filters only narrow the clients loaded here, so a match may be waiting on the next page.'
        : 'Try clearing a filter, a saved view, or the search.'

  const emptyAction = nothingAtAll
    ? (!writeDisabled && !isImpersonatingTeamMember
      ? <TahiButton size="sm" style={{ minHeight: '2.75rem' }} onClick={openPanel} iconLeft={<Plus className="w-3.5 h-3.5" />}>Add the first client</TahiButton>
      : undefined)
    : pastTheEnd
      ? <TahiButton size="sm" style={{ minHeight: '2.75rem' }} variant="secondary" onClick={() => goToPage(1)}>Back to page 1</TahiButton>
      : (
        <span className="flex flex-wrap items-center justify-center" style={{ gap: '0.5rem' }}>
          <TahiButton size="sm" style={{ minHeight: '2.75rem' }} variant="secondary" onClick={clearAll}>Clear filters</TahiButton>
          {missOnThisPage && pageFull && (
            <TahiButton size="sm" style={{ minHeight: '2.75rem' }} variant="ghost" onClick={() => { goToPage(page + 1); clearSelection() }}>
              Try the next page
            </TahiButton>
          )}
        </span>
      )

  const emptyState = (
    <EmptyState
      icon={<Users className="w-6 h-6" />}
      title={emptyTitle}
      description={emptyDescription}
      action={emptyAction}
    />
  )

  /** The read failed and there is nothing on screen to keep. */
  const hardError = !!error && !data
  /** The read failed but the previous page is still in hand. SWR holds `error`
   *  until the next SUCCESSFUL revalidation, so swapping the table out here
   *  would empty the whole list after one blipped background refresh. */
  const staleError = !!error && !!data

  const body = (() => {
    if (firstLoad) {
      // Unwrapped: SkeletonTable draws its own border and radius, so a Card
      // around it draws a second one. The count is the table's data columns
      // (client, status, plan, MRR, health, open, owner, tags, last activity),
      // so the shape does not jump when the rows land. The select cell and the
      // actions kebab are hairlines either side and are not worth a bar.
      return <SkeletonTable rows={6} columns={canSeeMoney ? 9 : 8} />
    }
    if (hardError) {
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
        : (
          <ClientsCardsView
            rows={visible}
            canSeeMoney={canSeeMoney}
            mrrUnknown={mrrUnknown}
            ownersKnown={owners.known}
            onOpen={openClient}
          />
        )
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
          selectable
          selectedIds={selected}
          onSelectionChange={setSelected}
          empty={emptyState}
          mobileCard={row => (
            <ClientMobileCard
              row={row}
              canSeeMoney={canSeeMoney}
              mrrUnknown={mrrUnknown}
              ownersKnown={owners.known}
              selected={selected.has(row.id)}
              writeDisabled={writeDisabled}
              onToggleSelect={() => toggleRow(row.id)}
              onOpen={() => openClient(row)}
              onViewAs={() => viewAsClient(row)}
              onInvite={() => { void invite(row) }}
              onArchive={() => { void setRowStatus(row, 'archived', 'archived') }}
              onRestore={() => { void setRowStatus(row, 'active', 'is back in the list') }}
            />
          )}
        />
      </Card>
    )
  })()

  // What the rail counts and the page bar are actually describing. The
  // endpoint pages at 50 and returns no total, so the moment there is a second
  // page the counts stop being roster figures. Status and plan reach the
  // server, so they narrow before the paging; the other four cannot.
  const partialRoster = pageFull || page > 1
  const serverNarrowed = !!askStatus || !!askPlan
  const countsNote = partialRoster || serverNarrowed
    ? `Counts cover the ${scopedRows.length} ${scopedRows.length === 1 ? 'client' : 'clients'} loaded${serverNarrowed ? ' under the status and plan asked for' : ''}, not the whole roster.`
    : null
  const scopeNote = partialRoster
    ? 'Health, owner, tag and track filters narrow the clients loaded here.'
    : null

  const railProps = {
    savedView,
    onSavedViewChange: setSavedView,
    counts,
    filters,
    onFiltersChange: setFilters,
    sort,
    onSortChange: rail.setSort,
    tagOptions,
    ownerOptions,
    canSeeMoney,
    countsNote,
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
        <div
          id={CLIENTS_VIEW_PANEL_ID}
          role="tabpanel"
          tabIndex={0}
          className="tahi-focus-ring flex flex-col"
          style={{ gap: '0.75rem' }}
        >
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

          {/* A failed background revalidate with rows still in hand is a
              banner, not a swap. SWR keeps `error` set until the next
              successful read, so replacing the body here would blank a
              populated table after every blipped refresh, and the most common
              trigger is the mutate that follows a successful archive. */}
          {staleError && (
            <div
              role="status"
              className="flex flex-col sm:flex-row sm:items-center"
              style={{
                gap: '0.625rem',
                padding: '0.625rem 0.875rem',
                border: '1px solid var(--color-warning)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-warning-bg)',
              }}
            >
              <AlertTriangle size={15} aria-hidden="true" style={{ flexShrink: 0, color: 'var(--color-warning)' }} />
              <p style={{ margin: 0, flex: 1, fontSize: '0.75rem', color: 'var(--color-text)' }}>
                The last refresh did not land. These rows are the ones loaded before it.
              </p>
              <TahiButton size="sm" variant="secondary" style={{ minHeight: '2.75rem' }} onClick={() => { void mutateClients() }}>
                Try again
              </TahiButton>
            </div>
          )}

          {body}

          {!firstLoad && !hardError && (
            <ClientsPageBar
              page={page}
              shown={visible.length}
              pageSize={PAGE_SIZE}
              hasNext={pageFull}
              scopeNote={scopeNote}
              onPageChange={next => { goToPage(next); clearSelection() }}
            />
          )}

          {filtersActive && visible.length === 0 && scopedRows.length > 0 && view === 'list' && (
            <p style={{ margin: 0, fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>
              {scopedRows.length} {scopedRows.length === 1 ? 'client is' : 'clients are'} loaded but hidden by the
              {savedView === ARCHIVED_VIEW_KEY ? ' archived view' : ' current filters'}.
              {pageFull ? ' There may be more on the next page.' : ''}
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
