'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { Search, Plus, Users, RefreshCw, ArrowUpDown } from 'lucide-react'
import { ClientCard } from '@/components/tahi/client-card'
import { TahiButton } from '@/components/tahi/tahi-button'
import { NewClientDialog } from '@/components/tahi/dialogs/new-client-dialog'
import { apiPath } from '@/lib/api'
import { useImpersonation } from '@/components/tahi/impersonation-banner'

const STATUS_FILTERS = [
  { label: 'All',      value: 'all' },
  { label: 'Active',   value: 'active' },
  { label: 'Maintain', value: 'maintain' }, // plan filter
  { label: 'Scale',    value: 'scale' },
  { label: 'Paused',   value: 'paused' },
  { label: 'Churned',  value: 'churned' },
]

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
  const statusFilter = searchParams.get('status') ?? 'all'
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

  function setStatusFilter(value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value === 'all') {
      params.delete('status')
    } else {
      params.set('status', value)
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

  const fetchClients = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      // Plan filters come through as status-adjacent in our filter UI
      if (['maintain', 'scale'].includes(statusFilter)) {
        params.set('plan', statusFilter)
      } else if (statusFilter !== 'all') {
        params.set('status', statusFilter)
      }
      const res = await fetch(apiPath(`/api/admin/clients?${params}`))
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json() as { organisations?: Organisation[] }
      setOrgs(data.organisations ?? [])
    } catch {
      setOrgs([])
    } finally {
      setLoading(false)
    }
  }, [search, statusFilter])

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

  const sortedOrgs = [...filteredOrgs].sort((a, b) => {
    if (sortParam === 'created') {
      return new Date(b.createdAt ?? '').getTime() - new Date(a.createdAt ?? '').getTime()
    }
    return (a.name ?? '').localeCompare(b.name ?? '')
  })

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Clients</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            {filteredOrgs.length > 0
              ? `${filteredOrgs.length} client${filteredOrgs.length !== 1 ? 's' : ''} (${filteredOrgs.filter(o => o.status === 'active').length} active)`
              : 'All client organisations and their current status'}
          </p>
        </div>
        {!isViewerImpersonation && (
          <TahiButton
            iconLeft={<Plus className="w-4 h-4" />}
            onClick={() => setDialogOpen(true)}
            size="md"
          >
            Add client
          </TahiButton>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-subtle)]" />
        <input
          type="text"
          placeholder="Search clients by name or website..."
          value={searchInput}
          onChange={e => handleSearchChange(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 text-sm bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg focus:outline-none focus:border-[var(--color-brand)] transition-colors placeholder:text-[var(--color-text-subtle)]"
        />
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide flex-1" style={{ WebkitOverflowScrolling: 'touch' }}>
          {STATUS_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors whitespace-nowrap flex-shrink-0 ${
                statusFilter === f.value
                  ? 'bg-[var(--color-brand)] text-white'
                  : 'bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-brand)] hover:text-[var(--color-brand-dark)]'
              }`}
            >
              {f.label}
            </button>
          ))}
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
