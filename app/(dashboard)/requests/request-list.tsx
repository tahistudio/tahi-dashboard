'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Inbox, RefreshCw, Filter, ChevronDown } from 'lucide-react'
import { RequestCard } from '@/components/tahi/request-card'
import { TahiButton } from '@/components/tahi/tahi-button'
import { NewRequestDialog } from '@/components/tahi/new-request-dialog'

const ADMIN_TABS = [
  { label: 'Active',       value: 'active' },
  { label: 'In review',    value: 'in_review' },
  { label: 'In progress',  value: 'in_progress' },
  { label: 'Client review',value: 'client_review' },
  { label: 'Delivered',    value: 'delivered' },
  { label: 'All',          value: 'all' },
]

const CLIENT_TABS = [
  { label: 'Active',    value: 'active' },
  { label: 'Delivered', value: 'delivered' },
  { label: 'All',       value: 'all' },
]

interface Request {
  id: string
  title: string
  status: string
  type: string
  category: string | null
  priority: string | null
  revisionCount: number | null
  scopeFlagged: boolean | null
  orgName?: string | null
  updatedAt: string | null
  createdAt: string | null
}

interface RequestListProps {
  isAdmin: boolean
}

export function RequestList({ isAdmin }: RequestListProps) {
  const [requests, setRequests] = useState<Request[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('active')
  const [dialogOpen, setDialogOpen] = useState(false)
  const tabs = isAdmin ? ADMIN_TABS : CLIENT_TABS

  const fetchRequests = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ status: activeTab })
      const endpoint = isAdmin ? '/api/admin/requests' : '/api/portal/requests'
      const res = await fetch(`${endpoint}?${params}`)
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json() as { requests?: Request[] }
      setRequests(data.requests ?? [])
    } catch {
      setRequests([])
    } finally {
      setLoading(false)
    }
  }, [activeTab, isAdmin])

  useEffect(() => { fetchRequests() }, [fetchRequests])

  return (
    <>
    <NewRequestDialog
      open={dialogOpen}
      onClose={() => { setDialogOpen(false); fetchRequests() }}
      isAdmin={isAdmin}
    />

    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Requests</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            {isAdmin
              ? 'All client requests across every active account.'
              : 'Your submitted requests and their current status.'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isAdmin && (
            <TahiButton variant="secondary" size="sm" iconLeft={<Filter className="w-3.5 h-3.5" />}>
              <span className="hidden sm:inline">Filter</span>
              <ChevronDown className="w-3 h-3 opacity-50" />
            </TahiButton>
          )}
          <TahiButton
            size="md"
            iconLeft={<Plus className="w-4 h-4" />}
            onClick={() => setDialogOpen(true)}
          >
            {isAdmin ? 'New request' : 'Submit request'}
          </TahiButton>
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex items-center gap-0.5 border-b border-[var(--color-border)] overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors flex-shrink-0 ${
              activeTab === tab.value
                ? 'border-[var(--color-brand)] text-[var(--color-brand-dark)]'
                : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
        {loading && (
          <RefreshCw className="w-3.5 h-3.5 text-[var(--color-text-subtle)] animate-spin ml-2 mb-2.5 flex-shrink-0" />
        )}
      </div>

      {/* List */}
      {!loading && requests.length === 0 ? (
        <EmptyState isAdmin={isAdmin} tab={activeTab} onNew={() => setDialogOpen(true)} />
      ) : (
        <div className="space-y-2">
          {requests.map(req => (
            <RequestCard
              key={req.id}
              id={req.id}
              title={req.title}
              status={req.status}
              type={req.type}
              category={req.category}
              priority={req.priority}
              revisionCount={req.revisionCount ?? 0}
              scopeFlagged={req.scopeFlagged}
              orgName={req.orgName}
              updatedAt={req.updatedAt}
              createdAt={req.createdAt}
              isAdmin={isAdmin}
            />
          ))}
        </div>
      )}
    </div>
    </>
  )
}

function EmptyState({ isAdmin, tab, onNew }: { isAdmin: boolean; tab: string; onNew: () => void }) {
  const isActiveTab = tab === 'active'

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div
        className="w-16 h-16 brand-gradient flex items-center justify-center mb-4"
        style={{ borderRadius: 'var(--radius-leaf)' }}
      >
        <Inbox className="w-8 h-8 text-white" />
      </div>
      <h3 className="text-base font-semibold text-[var(--color-text)] mb-2">
        {isActiveTab ? 'No active requests' : `No ${tab.replace('_', ' ')} requests`}
      </h3>
      <p className="text-sm text-[var(--color-text-muted)] max-w-sm">
        {isAdmin
          ? isActiveTab
            ? 'Active requests will appear here once clients start submitting work.'
            : `No requests in this status yet.`
          : isActiveTab
          ? "Submit your first request and we'll get to work."
          : "Nothing here yet."}
      </p>
      {!isAdmin && isActiveTab && (
        <TahiButton className="mt-5" iconLeft={<Plus className="w-4 h-4" />} onClick={onNew}>
          Submit a request
        </TahiButton>
      )}
    </div>
  )
}
