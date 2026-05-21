'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { Search, Plus, Users, RefreshCw, ArrowUpDown } from 'lucide-react'
import { ClientCard } from '@/components/tahi/client-card'
import { TahiButton } from '@/components/tahi/tahi-button'
import { NewClientDialog } from '@/components/tahi/dialogs/new-client-dialog'
import { apiPath } from '@/lib/api'
import { useImpersonation } from '@/components/tahi/impersonation-banner'
import { PageHeader } from '@/components/tahi/page-header'
import { Input } from '@/components/tahi/input'

// Tab layout: Active (status='active') first, then a dynamic tab per
// plan-type present among active clients (Maintain, Scale, Tune, Launch,
// Hourly, Custom…), then status tabs for Paused / Churned / Archived.
// Prospects are intentionally absent — they live in the pipeline.
//
// A tab's `value` is either a status string ("active" / "paused" / "churned"
// / "archived") or "plan:<planType>" for the plan tabs. The local filter
// reads the prefix.
type TabValue = 'active' | 'paused' | 'churned' | 'archived' | `plan:${string}`

const STATUS_TABS: { label: string; value: TabValue }[] = [
  { label: 'Active',   value: 'active' },
  { label: 'Paused',   value: 'paused' },
  { label: 'Churned',  value: 'churned' },
  { label: 'Archived', value: 'archived' },
]

// Display-friendly labels for known plan types — anything else falls back
// to a Title-Cased version of the raw value.
const PLAN_LABELS: Record<string, string> = {
  maintain: 'Maintain',
  scale: 'Scale',
  tune: 'Tune',
  launch: 'Launch',
  hourly: 'Hourly',
  custom: 'Custom',
}

function planLabel(plan: string): string {
  if (PLAN_LABELS[plan]) return PLAN_LABELS[plan]
  return plan.charAt(0).toUpperCase() + plan.slice(1)
}

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

export function ClientList() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const search = searchParams.get('q') ?? ''
  // Default to the Active tab when nothing is in the URL.
  const activeTab = (searchParams.get('tab') ?? 'active') as TabValue
  const sortParam = searchParams.get('sort') ?? 'name'

  const [orgs, setOrgs] = useState<Organisation[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(() => searchParams.get('new') === '1')

  // Listen for keyboard shortcut events
  useEffect(() => {
    function handleShortcut(e: Event) {
      const detail = (e as CustomEvent).detail
      if (detail === 'new-client') setDialogOpen(true)
    }
    window.addEventListener('tahi:shortcut', handleShortcut)
    return () => window.removeEventListener('tahi:shortcut', handleShortcut)
  }, [])

  // Local input state for debouncing
  const [searchInput, setSearchInput] = useState(search)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync input if URL changes externally
  useEffect(() => {
    setSearchInput(search)
  }, [search])

  function toggleSort() {
    const params = new URLSearchParams(searchParams.toString())
    params.set('sort', sortParam === 'name' ? 'created' : 'name')
    router.replace(`${pathname}?${params.toString()}`)
  }

  function setTab(value: TabValue) {
    const params = new URLSearchParams(searchParams.toString())
    if (value === 'active') {
      params.delete('tab')
    } else {
      params.set('tab', value)
    }
    router.replace(`${pathname}?${params.toString()}`)
  }

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

  // Fetch all non-prospect, non-archived clients in one shot and tab between
  // them locally so each tab is instant + the counts are accurate. Archived
  // gets its own fetch (kept small via the API filter, only when needed).
  // Refetch only when we cross the archived boundary, not on every tab.
  const archivedView = activeTab === 'archived'
  const fetchClients = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (archivedView) params.set('status', 'archived')
      const res = await fetch(apiPath(`/api/admin/clients?${params}`))
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json() as { organisations?: Organisation[] }
      setOrgs(data.organisations ?? [])
    } catch {
      setOrgs([])
    } finally {
      setLoading(false)
    }
  }, [search, archivedView])

  useEffect(() => { fetchClients() }, [fetchClients])

  const { isImpersonatingTeamMember, impersonatedAccessRules } = useImpersonation()

  // When impersonating a team member, filter clients to only those they have access to
  const filteredOrgs = isImpersonatingTeamMember
    ? orgs.filter(org => {
      // No access rules means no access to any client
      if (impersonatedAccessRules.length === 0) return false
      return impersonatedAccessRules.some(rule => {
        if (rule.scopeType === 'all_clients') return true
        if (rule.scopeType === 'plan_type') return org.planType === rule.planType
        if (rule.scopeType === 'specific_clients') return rule.orgIds?.includes(org.id) ?? false
        return false
      })
    })
    : orgs

  // Determine if the impersonated team member is a viewer (hide create/edit actions)
  const isViewerImpersonation = isImpersonatingTeamMember &&
    impersonatedAccessRules.length > 0 &&
    impersonatedAccessRules.every(r => r.role === 'viewer')

  // Derive tab counts from the fetched set. When viewing Archived, the
  // fetch only returns archived rows, so the other counts will be zero —
  // we hide them in that mode to avoid showing misleading "0".
  const activeOrgs = filteredOrgs.filter(o => o.status === 'active')
  const tabCounts: Record<string, number> = {
    active: activeOrgs.length,
    paused: filteredOrgs.filter(o => o.status === 'paused').length,
    churned: filteredOrgs.filter(o => o.status === 'churned').length,
    archived: archivedView ? filteredOrgs.length : 0,
  }

  // Dynamic plan tabs: any planType present among active clients gets a
  // tab. Ordered with the canonical plans first, then anything else.
  const planSet = new Map<string, number>()
  for (const org of activeOrgs) {
    if (org.planType) planSet.set(org.planType, (planSet.get(org.planType) ?? 0) + 1)
  }
  const canonicalOrder = ['maintain', 'scale', 'tune', 'launch', 'hourly', 'custom']
  const planTabs = Array.from(planSet.keys()).sort((a, b) => {
    const ai = canonicalOrder.indexOf(a)
    const bi = canonicalOrder.indexOf(b)
    if (ai === -1 && bi === -1) return a.localeCompare(b)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  }).map(plan => ({
    label: planLabel(plan),
    value: (`plan:${plan}`) as TabValue,
    count: planSet.get(plan) ?? 0,
  }))

  // Apply the current tab to the list.
  const tabbedOrgs = filteredOrgs.filter(o => {
    if (activeTab === 'active') return o.status === 'active'
    if (activeTab === 'paused') return o.status === 'paused'
    if (activeTab === 'churned') return o.status === 'churned'
    if (activeTab === 'archived') return true // already filtered server-side
    if (activeTab.startsWith('plan:')) {
      const plan = activeTab.slice('plan:'.length)
      return o.status === 'active' && o.planType === plan
    }
    return true
  })

  const sortedOrgs = [...tabbedOrgs].sort((a, b) => {
    if (sortParam === 'created') {
      return new Date(b.createdAt ?? '').getTime() - new Date(a.createdAt ?? '').getTime()
    }
    return (a.name ?? '').localeCompare(b.name ?? '')
  })

  return (
    <div className="space-y-5">
      <PageHeader
        title="Clients"
        subtitle={
          tabbedOrgs.length > 0
            ? `${tabbedOrgs.length} ${tabbedOrgs.length === 1 ? 'client' : 'clients'} in this view`
            : 'Active, paused, and churned client organisations. Prospects live in the pipeline.'
        }
      >
        {!isViewerImpersonation && (
          <TahiButton
            iconLeft={<Plus className="w-4 h-4" />}
            onClick={() => setDialogOpen(true)}
            size="md"
          >
            Add client
          </TahiButton>
        )}
      </PageHeader>

      <Input
        value={searchInput}
        onChange={e => handleSearchChange(e.target.value)}
        placeholder="Search clients by name or website..."
        leadingIcon={<Search size={14} aria-hidden="true" />}
        style={{ width: '100%' }}
      />

      {/* Tabs: status (Active / Paused / Churned / Archived) + dynamic
          per-plan tabs derived from the active set. */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide flex-1" style={{ WebkitOverflowScrolling: 'touch' }}>
          <TabButton
            label="Active"
            count={tabCounts.active}
            active={activeTab === 'active'}
            onClick={() => setTab('active')}
          />
          {planTabs.map(t => (
            <TabButton
              key={t.value}
              label={t.label}
              count={t.count}
              active={activeTab === t.value}
              onClick={() => setTab(t.value)}
              subtle
            />
          ))}
          <span aria-hidden="true" style={{ width: 1, alignSelf: 'stretch', background: 'var(--color-border-subtle)', flexShrink: 0, margin: '0 0.25rem' }} />
          <TabButton
            label="Paused"
            count={tabCounts.paused}
            active={activeTab === 'paused'}
            onClick={() => setTab('paused')}
          />
          <TabButton
            label="Churned"
            count={tabCounts.churned}
            active={activeTab === 'churned'}
            onClick={() => setTab('churned')}
          />
          <TabButton
            label="Archived"
            count={archivedView ? tabCounts.archived : undefined}
            active={activeTab === 'archived'}
            onClick={() => setTab('archived')}
          />
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {loading && (
            <RefreshCw className="w-3.5 h-3.5 text-[var(--color-text-subtle)] animate-spin" />
          )}
          <button
            onClick={toggleSort}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-full transition-colors bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-brand)] hover:text-[var(--color-brand-dark)] whitespace-nowrap flex-shrink-0"
          >
            <ArrowUpDown className="w-3 h-3" />
            {sortParam === 'name' ? 'A-Z' : 'Newest'}
          </button>
        </div>
      </div>

      {/* List */}
      {!loading && orgs.length === 0 ? (
        <EmptyState onAdd={() => setDialogOpen(true)} />
      ) : (
        <div className="space-y-2">
          {sortedOrgs.map(org => (
            <ClientCard
              key={org.id}
              id={org.id}
              name={org.name}
              website={org.website}
              status={org.status}
              planType={org.planType}
              healthStatus={org.healthStatus}
              openRequestCount={org.openRequestCount}
              industry={org.industry}
              lastActivity={org.updatedAt ?? org.createdAt}
            />
          ))}
        </div>
      )}

      <NewClientDialog open={dialogOpen} onClose={() => { setDialogOpen(false); fetchClients() }} />
    </div>
  )
}

function TabButton({
  label, count, active, onClick, subtle = false,
}: {
  label: string
  count?: number
  active: boolean
  onClick: () => void
  /** Plan tabs are visually slightly lighter than status tabs so the eye
   *  groups Active / Paused / Churned / Archived as the primary axis. */
  subtle?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center transition-colors whitespace-nowrap flex-shrink-0"
      style={{
        gap: '0.375rem',
        padding: '0.375rem 0.75rem',
        fontSize: '0.75rem',
        fontWeight: 500,
        borderRadius: '9999px',
        background: active ? 'var(--color-brand)' : 'var(--color-bg)',
        color: active ? '#ffffff' : 'var(--color-text-muted)',
        border: `1px solid ${active ? 'var(--color-brand)' : (subtle ? 'var(--color-border-subtle)' : 'var(--color-border)')}`,
        cursor: 'pointer',
      }}
      onMouseEnter={e => {
        if (!active) {
          e.currentTarget.style.borderColor = 'var(--color-brand)'
          e.currentTarget.style.color = 'var(--color-brand-dark)'
        }
      }}
      onMouseLeave={e => {
        if (!active) {
          e.currentTarget.style.borderColor = subtle ? 'var(--color-border-subtle)' : 'var(--color-border)'
          e.currentTarget.style.color = 'var(--color-text-muted)'
        }
      }}
      aria-pressed={active}
    >
      <span>{label}</span>
      {typeof count === 'number' && (
        <span
          style={{
            fontSize: '0.625rem',
            fontWeight: 600,
            padding: '0 0.375rem',
            borderRadius: '9999px',
            background: active ? 'rgba(255,255,255,0.22)' : 'var(--color-bg-secondary)',
            color: active ? '#ffffff' : 'var(--color-text-subtle)',
            lineHeight: '1.125rem',
            minWidth: '1.25rem',
            textAlign: 'center',
          }}
        >
          {count}
        </span>
      )}
    </button>
  )
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div
        className="w-16 h-16 brand-gradient flex items-center justify-center mb-4"
        style={{ borderRadius: 'var(--radius-leaf)' }}
      >
        <Users className="w-8 h-8 text-white" />
      </div>
      <h3 className="text-base font-semibold text-[var(--color-text)] mb-2">No clients yet</h3>
      <p className="text-sm text-[var(--color-text-muted)] max-w-sm">
        Add your first client to get started. They will receive an invite email to access their portal.
      </p>
      <TahiButton className="mt-5" iconLeft={<Plus className="w-4 h-4" />} onClick={onAdd}>
        Add first client
      </TahiButton>
    </div>
  )
}
