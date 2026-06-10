'use client'

import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import {
  Plus, Users, Globe, MessageSquare, Clock, ArrowUpRight,
  Building2, Mail, User as UserIcon, RefreshCw, Save,
} from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { apiPath } from '@/lib/api'
import { useImpersonation } from '@/components/tahi/impersonation-banner'
import { PageHeader } from '@/components/tahi/page-header'
import { Avatar } from '@/components/tahi/avatar'
import { Badge, type BadgeTone } from '@/components/tahi/badge'
import { Card } from '@/components/tahi/card'
import { DataTable, type DataTableColumn } from '@/components/tahi/data-table'
import { FilterBar, type FilterDef, type ActiveFilter } from '@/components/tahi/filter-bar'
import { EmptyState } from '@/components/tahi/empty-state'
import { SlideOver } from '@/components/tahi/slide-over'
import { Input, Select } from '@/components/tahi/input'
import { useToast } from '@/components/tahi/toast'
import { formatDistanceToNow } from 'date-fns'

// ── Static config ───────────────────────────────────────────────────────────

// Status options drive the Status filter chip. Prospects live in the
// pipeline so they're absent here. Tones match the rest of the dashboard's
// status language (positive = active, warning = paused, danger = churned).
interface StatusDef {
  value: string
  label: string
  tone: BadgeTone
}
const STATUSES: StatusDef[] = [
  { value: 'active',   label: 'Active',   tone: 'positive' },
  { value: 'paused',   label: 'Paused',   tone: 'warning'  },
  { value: 'churned',  label: 'Churned',  tone: 'danger'   },
  { value: 'archived', label: 'Archived', tone: 'neutral'  },
]
const STATUS_BY_VALUE = new Map(STATUSES.map(s => [s.value, s]))

// Plan tones mirror the per-plan colouring used elsewhere in the dashboard
// (Maintain = brand green, Scale = teal, Tune = info, Launch = purple,
// Hourly = warning, Custom = neutral). Anything unrecognised falls through
// to neutral via the lookup.
interface PlanDef {
  value: string
  label: string
  tone: BadgeTone
}
const PLANS: PlanDef[] = [
  { value: 'maintain', label: 'Maintain', tone: 'brand'   },
  { value: 'scale',    label: 'Scale',    tone: 'teal'    },
  { value: 'tune',     label: 'Tune',     tone: 'info'    },
  { value: 'launch',   label: 'Launch',   tone: 'purple'  },
  { value: 'hourly',   label: 'Hourly',   tone: 'warning' },
  { value: 'custom',   label: 'Custom',   tone: 'neutral' },
]
const PLAN_BY_VALUE = new Map(PLANS.map(p => [p.value, p]))

// Health tone map for the small dot column. Green / amber / red are the
// only values stored.
const HEALTH_TONE: Record<string, BadgeTone> = {
  green: 'positive',
  amber: 'warning',
  red:   'danger',
}

// ── Types ───────────────────────────────────────────────────────────────────

interface Organisation {
  id: string
  name: string
  website: string | null
  status: string
  planType: string | null
  healthStatus: string | null
  industry: string | null
  openRequestCount: number
  updatedAt: string | null
  createdAt: string | null
}

// ── Component ───────────────────────────────────────────────────────────────

export function ClientList() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  // URL-backed state. We keep `q` and `status` in the URL so bookmarks /
  // shared links still work. The plan filter is a client-side multiselect
  // and lives only in component state. It changes a lot during browsing
  // and doesn't need URL persistence.
  const urlSearch = searchParams.get('q') ?? ''
  // Status URL param is a comma-list of values. Default is the "currently
  // visible" set: active + paused + churned (everything except archived).
  // This matches the previous default tab (Active) but lets the user see
  // multiple status buckets at once via the multiselect chip.
  const urlStatusRaw = searchParams.get('status')
  const urlStatuses = useMemo(
    () => urlStatusRaw ? urlStatusRaw.split(',').filter(Boolean) : ['active'],
    [urlStatusRaw],
  )

  const [searchInput, setSearchInput] = useState(urlSearch)
  const [orgs, setOrgs] = useState<Organisation[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(() => searchParams.get('new') === '1')

  // New-client form draft. Shape mirrors the POST /api/admin/clients
  // payload exactly so no API change is needed when this lands.
  const initialDraft = useMemo(() => ({
    name: '',
    website: '',
    industry: '',
    planType: '',
    primaryContactName: '',
    primaryContactEmail: '',
  }), [])
  const [draft, setDraft] = useState(initialDraft)
  const [saving, setSaving] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const { showToast } = useToast()

  function updateDraft<K extends keyof typeof initialDraft>(k: K, v: string) {
    setDraft(prev => ({ ...prev, [k]: v }))
    setCreateError(null)
  }

  function closeDialog() {
    setDialogOpen(false)
    setDraft(initialDraft)
    setCreateError(null)
  }

  // Create handler. Calls the same endpoint and accepts the same body
  // shape as the prior <NewClientDialog>, so the BE contract is untouched.
  async function handleCreate() {
    if (!draft.name.trim()) {
      setCreateError('Client name is required')
      return
    }
    setSaving(true)
    setCreateError(null)
    try {
      const res = await fetch(apiPath('/api/admin/clients'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        throw new Error(data.error ?? 'Failed to create client')
      }
      const data = await res.json() as { id?: string }
      showToast('Client created successfully')
      closeDialog()
      await fetchClients()
      if (data.id) {
        router.push(`/clients/${data.id}`)
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  // FilterBar active state. Status + plan are both multiselect chips with
  // nonRemovable so they're permanent on the bar (no X, no "+ Add filter"
  // button). Same UX shape as the docs / leads pages.
  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>(() => ([
    { id: 'status', values: urlStatuses },
    { id: 'plan',   values: [] },
  ]))

  // Mirror URL changes (back/forward) into local state.
  useEffect(() => {
    setSearchInput(urlSearch)
  }, [urlSearch])

  // Write status changes back to the URL so the view is shareable.
  // Debounced via the user's filter chip interaction: happens on every
  // change which is fine because router.replace is cheap and doesn't
  // re-trigger the fetch (the fetch effect depends on `urlStatuses` which
  // only changes when the URL param changes).
  const syncStatusToUrl = useCallback((values: string[]) => {
    const params = new URLSearchParams(searchParams.toString())
    if (values.length === 0 || (values.length === 1 && values[0] === 'active')) {
      params.delete('status')
    } else {
      params.set('status', values.join(','))
    }
    router.replace(`${pathname}?${params.toString()}`)
  }, [searchParams, pathname, router])

  // Keyboard shortcut listener. Same `tahi:shortcut` channel used
  // elsewhere in the dashboard.
  useEffect(() => {
    function handleShortcut(e: Event) {
      const detail = (e as CustomEvent).detail
      if (detail === 'new-client') {
        setDraft(initialDraft)
        setCreateError(null)
        setDialogOpen(true)
      }
    }
    window.addEventListener('tahi:shortcut', handleShortcut)
    return () => window.removeEventListener('tahi:shortcut', handleShortcut)
  }, [initialDraft])

  // Debounce the search input -> URL.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  function handleSearchChange(value: string) {
    setSearchInput(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString())
      if (value.trim()) {
        params.set('q', value.trim())
      } else {
        params.delete('q')
      }
      router.replace(`${pathname}?${params.toString()}`)
    }, 300)
  }

  // Fetch. We let the server filter on `search` and `status=archived`
  // (because archived rows aren't returned by default) and do everything
  // else client-side so the FilterBar feels instant.
  // When the user selects only archived statuses, hit the archived
  // endpoint variant; otherwise fetch the default (non-archived) set.
  const needsArchived = urlStatuses.includes('archived')
  const onlyArchived = needsArchived && urlStatuses.length === 1
  const fetchClients = useCallback(async () => {
    setLoading(true)
    try {
      // If only archived is selected, ask the API for the archived bucket.
      // If archived is part of a wider selection, we do two fetches and
      // merge (one default, one archived) so the user can see "active plus
      // archived" together. This keeps the existing API contract.
      const baseParams = new URLSearchParams()
      if (urlSearch) baseParams.set('search', urlSearch)

      if (onlyArchived) {
        baseParams.set('status', 'archived')
        const res = await fetch(apiPath(`/api/admin/clients?${baseParams}`))
        if (!res.ok) throw new Error('Failed to fetch')
        const data = await res.json() as { organisations?: Organisation[] }
        setOrgs(data.organisations ?? [])
      } else if (needsArchived) {
        const [defaultRes, archivedRes] = await Promise.all([
          fetch(apiPath(`/api/admin/clients?${baseParams}`)),
          fetch(apiPath(`/api/admin/clients?${new URLSearchParams({
            ...(urlSearch ? { search: urlSearch } : {}),
            status: 'archived',
          })}`)),
        ])
        if (!defaultRes.ok || !archivedRes.ok) throw new Error('Failed to fetch')
        const a = await defaultRes.json() as { organisations?: Organisation[] }
        const b = await archivedRes.json() as { organisations?: Organisation[] }
        setOrgs([...(a.organisations ?? []), ...(b.organisations ?? [])])
      } else {
        const res = await fetch(apiPath(`/api/admin/clients?${baseParams}`))
        if (!res.ok) throw new Error('Failed to fetch')
        const data = await res.json() as { organisations?: Organisation[] }
        setOrgs(data.organisations ?? [])
      }
    } catch {
      setOrgs([])
    } finally {
      setLoading(false)
    }
  }, [urlSearch, needsArchived, onlyArchived])

  useEffect(() => { fetchClients() }, [fetchClients])

  const { isImpersonatingTeamMember, impersonatedAccessRules } = useImpersonation()

  // Apply impersonated team-member scoping. Same logic as before: if
  // there are no rules at all the impersonated user sees nothing; rules
  // can scope by all_clients / plan_type / specific_clients.
  const scopedOrgs = isImpersonatingTeamMember
    ? orgs.filter(org => {
      if (impersonatedAccessRules.length === 0) return false
      return impersonatedAccessRules.some(rule => {
        if (rule.scopeType === 'all_clients') return true
        if (rule.scopeType === 'plan_type') return org.planType === rule.planType
        if (rule.scopeType === 'specific_clients') return rule.orgIds?.includes(org.id) ?? false
        return false
      })
    })
    : orgs

  const isViewerImpersonation = isImpersonatingTeamMember &&
    impersonatedAccessRules.length > 0 &&
    impersonatedAccessRules.every(r => r.role === 'viewer')

  // Read selected filter values out of the FilterBar's active state.
  const selectedStatuses = useMemo(() => {
    const f = activeFilters.find(a => a.id === 'status')
    return new Set(f?.values ?? [])
  }, [activeFilters])
  const selectedPlans = useMemo(() => {
    const f = activeFilters.find(a => a.id === 'plan')
    return new Set(f?.values ?? [])
  }, [activeFilters])

  // Apply client-side filters (status + plan). Search is already applied
  // on the server side via the `q` URL param.
  const filteredOrgs = useMemo(() => {
    return scopedOrgs.filter(o => {
      if (selectedStatuses.size > 0 && !selectedStatuses.has(o.status)) return false
      if (selectedPlans.size > 0) {
        // "No plan" is selected when the user picks zero items; we only
        // hide rows when at least one plan is picked AND this org's plan
        // isn't in the set. Orgs with null planType are excluded when any
        // specific plan is picked.
        if (!o.planType || !selectedPlans.has(o.planType)) return false
      }
      return true
    })
  }, [scopedOrgs, selectedStatuses, selectedPlans])

  // FilterBar definitions. Both filters are nonRemovable multiselects so
  // they always sit on the bar and never expose a "+ Add filter" button.
  const filterDefs: FilterDef[] = useMemo(() => ([
    {
      id: 'status',
      label: 'Status',
      kind: 'multiselect',
      nonRemovable: true,
      options: STATUSES.map(s => ({ value: s.value, label: s.label, tone: s.tone })),
    },
    {
      id: 'plan',
      label: 'Plan',
      kind: 'multiselect',
      nonRemovable: true,
      options: PLANS.map(p => ({ value: p.value, label: p.label, tone: p.tone })),
    },
  ]), [])

  // Push status changes to the URL so the deep-link survives. Plan stays
  // ephemeral.
  const handleFiltersChange = useCallback((next: ActiveFilter[]) => {
    setActiveFilters(next)
    const statusValues = next.find(a => a.id === 'status')?.values ?? []
    syncStatusToUrl(statusValues)
  }, [syncStatusToUrl])

  // ── DataTable columns ────────────────────────────────────────────────────

  const columns: DataTableColumn<Organisation>[] = useMemo(() => ([
    {
      key: 'name',
      header: 'Client',
      sortable: true,
      sortValue: r => r.name.toLowerCase(),
      minWidth: '18rem',
      render: r => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', minWidth: 0 }}>
          <Avatar name={r.name} size="sm" />
          <div style={{ minWidth: 0 }}>
            <div data-private style={{
              fontWeight: 600,
              color: 'var(--color-text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>{r.name}</div>
            {(r.industry || r.website) && (
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.375rem',
                fontSize: '0.6875rem',
                color: 'var(--color-text-muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {r.industry && <span>{r.industry}</span>}
                {r.industry && r.website && <span aria-hidden="true">·</span>}
                {r.website && (
                  <span data-private style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                    <Globe size={10} aria-hidden="true" />
                    {r.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      sortValue: r => r.status,
      width: '8rem',
      render: r => {
        const s = STATUS_BY_VALUE.get(r.status)
        return (
          <Badge tone={s?.tone ?? 'neutral'} variant="soft" size="sm" dot={false}>
            {s?.label ?? r.status}
          </Badge>
        )
      },
    },
    {
      key: 'plan',
      header: 'Plan',
      sortable: true,
      sortValue: r => r.planType ?? '',
      width: '7.5rem',
      render: r => {
        if (!r.planType) {
          return <span style={{ color: 'var(--color-text-subtle)', fontSize: '0.6875rem' }}>-</span>
        }
        const p = PLAN_BY_VALUE.get(r.planType)
        return (
          <Badge tone={p?.tone ?? 'neutral'} variant="soft" size="sm" dot={false}>
            {p?.label ?? r.planType}
          </Badge>
        )
      },
    },
    {
      key: 'health',
      header: 'Health',
      sortable: true,
      sortValue: r => r.healthStatus ?? '',
      width: '6.5rem',
      render: r => {
        if (!r.healthStatus) {
          return <span style={{ color: 'var(--color-text-subtle)', fontSize: '0.6875rem' }}>-</span>
        }
        const tone = HEALTH_TONE[r.healthStatus] ?? 'neutral'
        const label = r.healthStatus.charAt(0).toUpperCase() + r.healthStatus.slice(1)
        return (
          <Badge tone={tone} variant="soft" size="sm" dot={true}>
            {label}
          </Badge>
        )
      },
    },
    {
      key: 'openRequests',
      header: 'Open',
      sortable: true,
      sortValue: r => r.openRequestCount ?? 0,
      width: '6rem',
      render: r => (
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.3125rem',
          fontSize: '0.75rem',
          color: r.openRequestCount > 0 ? 'var(--color-text)' : 'var(--color-text-subtle)',
          fontVariantNumeric: 'tabular-nums',
        }}>
          <MessageSquare size={11} aria-hidden="true" />
          {r.openRequestCount}
        </span>
      ),
    },
    {
      key: 'updatedAt',
      header: 'Last activity',
      sortable: true,
      sortValue: r => r.updatedAt ?? r.createdAt ?? '',
      width: '10rem',
      render: r => {
        const ts = r.updatedAt ?? r.createdAt
        if (!ts) {
          return <span style={{ color: 'var(--color-text-subtle)', fontSize: '0.6875rem' }}>-</span>
        }
        return (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.3125rem',
            fontSize: '0.75rem',
            color: 'var(--color-text-muted)',
          }}>
            <Clock size={11} aria-hidden="true" />
            {formatDistanceToNow(new Date(ts), { addSuffix: true })}
          </span>
        )
      },
    },
  ]), [])

  // ── Render ──────────────────────────────────────────────────────────────

  const totalCount = filteredOrgs.length
  const subtitle = totalCount > 0
    ? `${totalCount} ${totalCount === 1 ? 'client' : 'clients'} in this view`
    : 'Active, paused, and churned client organisations. Prospects live in the pipeline.'

  return (
    <div className="space-y-5">
      <PageHeader title="Clients" subtitle={subtitle}>
        {!isViewerImpersonation && (
          <TahiButton
            iconLeft={<Plus className="w-4 h-4" />}
            onClick={() => { setDraft(initialDraft); setCreateError(null); setDialogOpen(true) }}
            size="md"
          >
            Add client
          </TahiButton>
        )}
      </PageHeader>

      <FilterBar
        filters={filterDefs}
        active={activeFilters}
        onChange={handleFiltersChange}
        search={{
          value: searchInput,
          onChange: handleSearchChange,
          placeholder: 'Search clients by name or website...',
        }}
        size="sm"
      />

      <Card padding="none">
        <DataTable<Organisation>
          ariaLabel="Clients"
          columns={columns}
          rows={filteredOrgs}
          getRowId={r => r.id}
          defaultSort={{ key: 'name', dir: 'asc' }}
          loading={loading}
          onRowClick={(r) => router.push(`/clients/${r.id}`)}
          rowActions={(r) => [
            {
              label: 'Open client',
              icon: <ArrowUpRight size={14} />,
              onClick: () => router.push(`/clients/${r.id}`),
            },
          ]}
          empty={
            <EmptyState
              icon={<Users className="w-6 h-6" />}
              title={scopedOrgs.length === 0 ? 'No clients yet' : 'No matches'}
              description={scopedOrgs.length === 0
                ? 'Add your first client to get started. They will receive an invite email to access their portal.'
                : 'Try clearing a filter or adjusting your search.'}
              action={
                scopedOrgs.length === 0 && !isViewerImpersonation ? (
                  <TahiButton
                    size="sm"
                    onClick={() => { setDraft(initialDraft); setCreateError(null); setDialogOpen(true) }}
                    iconLeft={<Plus className="w-3.5 h-3.5" />}
                  >
                    Add first client
                  </TahiButton>
                ) : undefined
              }
            />
          }
        />
      </Card>

      <SlideOver
        open={dialogOpen}
        onClose={closeDialog}
        icon={<Building2 size={15} />}
        title="Add new client"
        subtitle="Creates their portal and sends an invite email."
        maxWidth="48rem"
      >
        <SlideOver.Body>
          <NewClientForm
            draft={draft}
            onUpdate={updateDraft}
            error={createError}
          />
        </SlideOver.Body>
        <SlideOver.Footer>
          <TahiButton variant="secondary" size="sm" onClick={closeDialog} disabled={saving}>
            Cancel
          </TahiButton>
          <div style={{ flex: 1 }} />
          <TahiButton
            size="sm"
            onClick={handleCreate}
            disabled={saving || !draft.name.trim()}
            iconLeft={saving
              ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              : <Save className="w-3.5 h-3.5" />}
          >
            {saving ? 'Adding...' : 'Add client'}
          </TahiButton>
        </SlideOver.Footer>
      </SlideOver>
    </div>
  )
}

// ── New-client form (lives inside the SlideOver) ────────────────────────────

interface NewClientDraft {
  name: string
  website: string
  industry: string
  planType: string
  primaryContactName: string
  primaryContactEmail: string
}

// Plan + industry option lists. Plan values map 1:1 with the BE schema's
// retainer plan slugs (see POST /api/admin/clients: Maintain/Scale spin up
// subscriptions + track records when chosen).
const PLAN_SELECT_OPTIONS = [
  { value: '',         label: 'No plan yet'                },
  { value: 'maintain', label: 'Maintain ($1,500/mo)'       },
  { value: 'scale',    label: 'Scale ($4,000/mo)'          },
  { value: 'tune',     label: 'Tune ($750 one-off)'        },
  { value: 'launch',   label: 'Launch ($2,500 one-off)'    },
  { value: 'hourly',   label: 'Hourly'                     },
  { value: 'custom',   label: 'Custom project'             },
] as const

const INDUSTRY_SELECT_OPTIONS = [
  { value: '',                        label: 'Select industry...'   },
  { value: 'Technology',              label: 'Technology'           },
  { value: 'E-commerce',              label: 'E-commerce'           },
  { value: 'Healthcare',              label: 'Healthcare'           },
  { value: 'Finance',                 label: 'Finance'              },
  { value: 'Education',               label: 'Education'            },
  { value: 'Hospitality',             label: 'Hospitality'          },
  { value: 'Real estate',             label: 'Real estate'          },
  { value: 'Professional services',   label: 'Professional services' },
  { value: 'Non-profit',              label: 'Non-profit'           },
  { value: 'Other',                   label: 'Other'                },
] as const

function NewClientForm({
  draft,
  onUpdate,
  error,
}: {
  draft: NewClientDraft
  onUpdate: <K extends keyof NewClientDraft>(k: K, v: string) => void
  error: string | null
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
      <div aria-live="polite">
        {error && (
          <div style={{
            padding: '0.5rem 0.75rem',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-danger-bg)',
            border: '1px solid var(--color-danger)',
            color: 'var(--color-danger)',
            fontSize: 'var(--text-sm)',
          }}>
            {error}
          </div>
        )}
      </div>

      <Field label="Client / company name *">
        <Input
          value={draft.name}
          onChange={(e) => onUpdate('name', e.target.value)}
          placeholder="Acme Corp"
          inputSize="md"
          leadingIcon={<Building2 size={13} aria-hidden="true" />}
          autoFocus
        />
      </Field>

      {/* Website is the wider field, industry is a short dropdown, so use
          the 1.5fr / 1fr proportion called out in the brief. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)', gap: '0.75rem' }}>
        <Field label="Website">
          <Input
            value={draft.website}
            onChange={(e) => onUpdate('website', e.target.value)}
            placeholder="https://..."
            inputSize="md"
            type="url"
            leadingIcon={<Globe size={13} aria-hidden="true" />}
          />
        </Field>
        <Field label="Industry">
          <Select
            value={draft.industry}
            onChange={(e) => onUpdate('industry', e.target.value)}
            options={INDUSTRY_SELECT_OPTIONS}
            selectSize="md"
            style={{ width: '100%' }}
          />
        </Field>
      </div>

      <Field label="Plan">
        <Select
          value={draft.planType}
          onChange={(e) => onUpdate('planType', e.target.value)}
          options={PLAN_SELECT_OPTIONS}
          selectSize="md"
          style={{ width: '100%' }}
        />
      </Field>

      <div style={{
        marginTop: '0.25rem',
        paddingTop: '0.875rem',
        borderTop: '1px solid var(--color-border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
      }}>
        <SectionLabel>Primary contact (optional, invite sent on save)</SectionLabel>

        {/* Name + email split: name is shorter on average, email gets the
            wider column. 1fr / 1.5fr keeps both readable. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.5fr)', gap: '0.75rem' }}>
          <Input
            value={draft.primaryContactName}
            onChange={(e) => onUpdate('primaryContactName', e.target.value)}
            placeholder="Full name"
            inputSize="md"
            leadingIcon={<UserIcon size={13} aria-hidden="true" />}
          />
          <Input
            value={draft.primaryContactEmail}
            onChange={(e) => onUpdate('primaryContactEmail', e.target.value)}
            placeholder="email@company.com"
            inputSize="md"
            type="email"
            leadingIcon={<Mail size={13} aria-hidden="true" />}
          />
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label style={{
        display: 'block',
        fontSize: '0.625rem',
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--color-text-subtle)',
        marginBottom: '0.3125rem',
      }}>{label}</label>
      {children}
    </div>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <label style={{
      display: 'block',
      fontSize: '0.625rem',
      fontWeight: 600,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      color: 'var(--color-text-subtle)',
    }}>{children}</label>
  )
}
