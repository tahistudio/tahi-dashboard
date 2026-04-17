'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  FileText, Plus, Search, RefreshCw, X, Trash2,
  Calendar, User, Building2,
} from 'lucide-react'
import { DateRangePicker, type DateRange } from '@/components/tahi/date-range-picker'
import { TahiButton } from '@/components/tahi/tahi-button'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'
import { EmptyState } from '@/components/tahi/empty-state'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { apiPath } from '@/lib/api'

// -- Types --

interface Contract {
  id: string
  orgId: string
  type: string
  name: string
  status: string
  storageKey: string
  signedStorageKey: string | null
  startDate: string | null
  expiryDate: string | null
  signatoryName: string | null
  signatoryEmail: string | null
  signedAt: string | null
  createdById: string
  createdAt: string
  updatedAt: string
}

interface OrgOption {
  id: string
  name: string
}

// -- Helpers --

const TYPE_LABELS: Record<string, string> = {
  nda: 'NDA',
  sla: 'SLA',
  msa: 'MSA',
  sow: 'SOW',
  other: 'Other',
}

const STATUS_STYLES: Record<string, { bg: string; color: string }> = {
  draft: { bg: 'var(--color-bg-tertiary)', color: 'var(--color-text-muted)' },
  sent: { bg: 'var(--color-info-bg)', color: 'var(--color-info)' },
  signed: { bg: 'var(--color-success-bg)', color: 'var(--color-success)' },
  expired: { bg: 'var(--color-warning-bg)', color: 'var(--color-warning)' },
  cancelled: { bg: 'var(--color-danger-bg)', color: 'var(--color-danger)' },
}

function formatDate(iso: string | null): string {
  if (!iso) return '-'
  try {
    return new Date(iso).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}

// -- Status Filter Tabs --

const STATUS_TABS = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'signed', label: 'Signed' },
  { value: 'expired', label: 'Expired' },
  { value: 'cancelled', label: 'Cancelled' },
]

// -- Create Contract Dialog --

function CreateContractDialog({
  orgs,
  onClose,
  onCreated,
}: {
  orgs: OrgOption[]
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState('msa')
  const [orgId, setOrgId] = useState('')
  const [status, setStatus] = useState('draft')
  const [startDate, setStartDate] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [signatoryName, setSignatoryName] = useState('')
  const [signatoryEmail, setSignatoryEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Contract name is required'); return }
    if (!orgId) { setError('Please select an organisation'); return }

    setSaving(true)
    setError('')

    try {
      const res = await fetch(apiPath('/api/admin/contracts'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          type,
          orgId,
          status,
          storageKey: `contracts/${crypto.randomUUID()}`,
          startDate: startDate || null,
          expiryDate: expiryDate || null,
          signatoryName: signatoryName.trim() || null,
          signatoryEmail: signatoryEmail.trim() || null,
        }),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        throw new Error(data.error ?? 'Failed to create contract')
      }
      onCreated()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create')
    } finally {
      setSaving(false)
    }
  }

  const inputCn = 'w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]'

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div
        className="bg-[var(--color-bg)] rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-contract-title"
      >
        <div className="flex items-center justify-between px-6 pt-6 pb-2">
          <h2 id="create-contract-title" className="text-lg font-bold text-[var(--color-text)]">
            New Contract
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 pb-6 space-y-4">
          {error && (
            <div
              className="text-sm px-3 py-2 rounded-lg"
              role="alert"
              style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger)' }}
            >
              {error}
            </div>
          )}

          <div>
            <label htmlFor="contract-name" className="block text-sm font-medium text-[var(--color-text)] mb-1">
              Name <span style={{ color: 'var(--color-danger)' }}>*</span>
            </label>
            <input
              id="contract-name"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className={inputCn}
              placeholder="e.g. Master Services Agreement"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="contract-type" className="block text-sm font-medium text-[var(--color-text)] mb-1">
                Type
              </label>
              <select id="contract-type" value={type} onChange={e => setType(e.target.value)} className={inputCn}>
                <option value="nda">NDA</option>
                <option value="sla">SLA</option>
                <option value="msa">MSA</option>
                <option value="sow">SOW</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div>
              <label htmlFor="contract-status" className="block text-sm font-medium text-[var(--color-text)] mb-1">
                Status
              </label>
              <select id="contract-status" value={status} onChange={e => setStatus(e.target.value)} className={inputCn}>
                <option value="draft">Draft</option>
                <option value="sent">Sent</option>
                <option value="signed">Signed</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="contract-org" className="block text-sm font-medium text-[var(--color-text)] mb-1">
              Organisation <span style={{ color: 'var(--color-danger)' }}>*</span>
            </label>
            <select id="contract-org" value={orgId} onChange={e => setOrgId(e.target.value)} className={inputCn}>
              <option value="">Select an organisation...</option>
              {orgs.map(org => (
                <option key={org.id} value={org.id}>{org.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="contract-start" className="block text-sm font-medium text-[var(--color-text)] mb-1">
                Start Date
              </label>
              <input id="contract-start" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={inputCn} />
            </div>
            <div>
              <label htmlFor="contract-expiry" className="block text-sm font-medium text-[var(--color-text)] mb-1">
                Expiry Date
              </label>
              <input id="contract-expiry" type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} className={inputCn} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="contract-signatory-name" className="block text-sm font-medium text-[var(--color-text)] mb-1">
                Signatory Name
              </label>
              <input
                id="contract-signatory-name"
                type="text"
                value={signatoryName}
                onChange={e => setSignatoryName(e.target.value)}
                className={inputCn}
                placeholder="John Doe"
              />
            </div>
            <div>
              <label htmlFor="contract-signatory-email" className="block text-sm font-medium text-[var(--color-text)] mb-1">
                Signatory Email
              </label>
              <input
                id="contract-signatory-email"
                type="email"
                value={signatoryEmail}
                onChange={e => setSignatoryEmail(e.target.value)}
                className={inputCn}
                placeholder="john@example.com"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <TahiButton variant="secondary" type="button" onClick={onClose}>Cancel</TahiButton>
            <TahiButton type="submit" loading={saving}>Create Contract</TahiButton>
          </div>
        </form>
      </div>
    </div>
  )
}

// -- Main Component --

export function ContractsContent() {
  const [contracts, setContracts] = useState<Contract[]>([])
  const [orgs, setOrgs] = useState<OrgOption[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [deleteContract, setDeleteContract] = useState<Contract | null>(null)
  const [editContract, setEditContract] = useState<Contract | null>(null)
  const [dateRange, setDateRange] = useState<DateRange>({ from: null, to: null })
  const [typeFilter, setTypeFilter] = useState('all')
  const [editStatus, setEditStatus] = useState('')
  const [updatingStatus, setUpdatingStatus] = useState(false)

  const fetchContracts = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiPath('/api/admin/contracts'))
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json() as { items: Contract[] }
      setContracts(data.items ?? [])
    } catch {
      setContracts([])
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchOrgs = useCallback(async () => {
    try {
      const res = await fetch(apiPath('/api/admin/clients'))
      if (!res.ok) return
      const data = await res.json() as { clients: OrgOption[] }
      setOrgs(data.clients ?? [])
    } catch {
      // silent
    }
  }, [])

  useEffect(() => {
    fetchContracts()
    fetchOrgs()
  }, [fetchContracts, fetchOrgs])

  const handleDelete = useCallback(async () => {
    if (!deleteContract) return
    const res = await fetch(apiPath(`/api/admin/contracts/${deleteContract.id}`), { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to delete')
    setDeleteContract(null)
    fetchContracts()
  }, [deleteContract, fetchContracts])

  const handleStatusUpdate = useCallback(async () => {
    if (!editContract) return
    setUpdatingStatus(true)
    try {
      const res = await fetch(apiPath(`/api/admin/contracts/${editContract.id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: editStatus }),
      })
      if (!res.ok) throw new Error('Failed to update')
      setEditContract(null)
      fetchContracts()
    } catch {
      // silent
    } finally {
      setUpdatingStatus(false)
    }
  }, [editContract, editStatus, fetchContracts])

  // Get org name from orgs list
  const orgName = useCallback((orgId: string) => {
    return orgs.find(o => o.id === orgId)?.name ?? 'Unknown'
  }, [orgs])

  // Filter contracts
  const filtered = contracts.filter(c => {
    if (statusFilter !== 'all' && c.status !== statusFilter) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      if (!c.name.toLowerCase().includes(q) && !orgName(c.orgId).toLowerCase().includes(q) && !c.type.toLowerCase().includes(q)) return false
    }
    if (dateRange.from && dateRange.to && c.expiryDate) {
      const d = new Date(c.expiryDate).getTime()
      if (d < dateRange.from.getTime() || d > dateRange.to.getTime()) return false
    }
    if (typeFilter !== 'all' && c.type !== typeFilter) return false
    return true
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Contracts</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            Track NDAs, SLAs, MSAs, and SOWs across all clients.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TahiButton variant="secondary" size="sm" onClick={fetchContracts} iconLeft={<RefreshCw className="w-3.5 h-3.5" />}>
            Refresh
          </TahiButton>
          <TahiButton size="sm" onClick={() => setShowCreateDialog(true)} iconLeft={<Plus className="w-3.5 h-3.5" />}>
            New Contract
          </TahiButton>
        </div>
      </div>

      {/* Search + Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-subtle)]"
            style={{ width: '0.875rem', height: '0.875rem' }}
          />
          <input
            type="text"
            placeholder="Search contracts..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] pl-9 pr-3 py-2 text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {STATUS_TABS.map(tab => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
              style={{
                background: statusFilter === tab.value ? 'var(--color-brand)' : 'var(--color-bg-tertiary)',
                color: statusFilter === tab.value ? 'white' : 'var(--color-text-muted)',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <DateRangePicker value={dateRange} onChange={setDateRange} label="Expiry date" />
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="appearance-none focus:outline-none"
          style={{
            padding: '0.4375rem 2rem 0.4375rem 0.75rem',
            fontSize: '0.8125rem',
            border: '1px solid var(--color-border)',
            borderRadius: '0.5rem',
            color: typeFilter !== 'all' ? 'var(--color-brand-dark)' : 'var(--color-text-muted)',
            background: typeFilter !== 'all' ? 'var(--color-brand-50)' : 'var(--color-bg)',
            cursor: 'pointer',
          }}
        >
          <option value="all">All Types</option>
          <option value="nda">NDA</option>
          <option value="sla">SLA</option>
          <option value="msa">MSA</option>
          <option value="sow">SOW</option>
          <option value="other">Other</option>
        </select>
      </div>

      {/* Content */}
      {loading ? (
        <LoadingSkeleton rows={6} />
      ) : filtered.length === 0 ? (
        contracts.length === 0 ? (
          <EmptyState
            icon={<FileText className="w-8 h-8 text-white" />}
            title="No contracts yet"
            description="Create your first contract to track agreements with clients."
            ctaLabel="New Contract"
            onCtaClick={() => setShowCreateDialog(true)}
          />
        ) : (
          <div className="text-center py-12">
            <p className="text-sm text-[var(--color-text-muted)]">No contracts match your filters.</p>
          </div>
        )
      ) : (
        <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)]">Name</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)]">Type</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)] hidden md:table-cell">Organisation</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)]">Status</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)] hidden lg:table-cell">Expiry</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)] hidden lg:table-cell">Signatory</th>
                <th className="text-right px-4 py-3 font-medium text-[var(--color-text-muted)]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(contract => {
                const sty = STATUS_STYLES[contract.status] ?? STATUS_STYLES.draft
                return (
                  <tr
                    key={contract.id}
                    className="border-b border-[var(--color-border-subtle)] last:border-0 hover:bg-[var(--color-bg-secondary)] transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-[var(--color-text)]">{contract.name}</div>
                      <div className="text-xs text-[var(--color-text-subtle)] mt-0.5 md:hidden">
                        {orgName(contract.orgId)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="text-xs font-medium px-2 py-0.5 rounded-full"
                        style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text-muted)' }}
                      >
                        {TYPE_LABELS[contract.type] ?? contract.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)] hidden md:table-cell">
                      <div className="flex items-center gap-1.5">
                        <Building2 className="w-3.5 h-3.5 flex-shrink-0" />
                        {orgName(contract.orgId)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => { setEditContract(contract); setEditStatus(contract.status) }}
                        className="text-xs font-medium px-2 py-0.5 rounded-full cursor-pointer hover:opacity-80 transition-opacity"
                        style={{ background: sty.bg, color: sty.color }}
                      >
                        {contract.status.charAt(0).toUpperCase() + contract.status.slice(1)}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)] hidden lg:table-cell">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
                        {formatDate(contract.expiryDate)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)] hidden lg:table-cell">
                      {contract.signatoryName ? (
                        <div className="flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 flex-shrink-0" />
                          {contract.signatoryName}
                        </div>
                      ) : '-'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setDeleteContract(contract)}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-[var(--color-text-subtle)] hover:text-red-500 transition-colors"
                          aria-label="Delete contract"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create dialog */}
      {showCreateDialog && (
        <CreateContractDialog
          orgs={orgs}
          onClose={() => setShowCreateDialog(false)}
          onCreated={fetchContracts}
        />
      )}

      {/* Status edit dialog */}
      {editContract && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="bg-[var(--color-bg)] rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
            <h3 className="text-lg font-bold text-[var(--color-text)] mb-4">Update Status</h3>
            <p className="text-sm text-[var(--color-text-muted)] mb-3">{editContract.name}</p>
            <select
              value={editStatus}
              onChange={e => setEditStatus(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
            >
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
              <option value="signed">Signed</option>
              <option value="expired">Expired</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <div className="flex justify-end gap-2">
              <TahiButton variant="secondary" size="sm" onClick={() => setEditContract(null)}>Cancel</TahiButton>
              <TahiButton size="sm" onClick={handleStatusUpdate} loading={updatingStatus}>Update</TahiButton>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteContract}
        title="Delete contract"
        description={deleteContract ? `Are you sure you want to delete "${deleteContract.name}"? This cannot be undone.` : ''}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteContract(null)}
      />
    </div>
  )
}
