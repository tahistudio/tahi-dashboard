'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Plus, Clock, RefreshCw, DollarSign, Timer, Download, ChevronDown, ChevronUp, Users, Trash2 } from 'lucide-react'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'
import { EmptyState } from '@/components/tahi/empty-state'
import { SearchableSelect } from '@/components/tahi/searchable-select'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { DateRangePicker, type DateRange } from '@/components/tahi/date-range-picker'
import { apiPath } from '@/lib/api'
import { useToast } from '@/components/tahi/toast'

// ---- Types ----

interface TimeEntry {
  id: string
  orgId: string
  orgName: string | null
  requestId: string | null
  requestTitle: string | null
  teamMemberId: string
  teamMemberName: string | null
  hours: number
  billable: boolean | null
  notes: string | null
  date: string
  createdAt: string
}

interface TimeResponse {
  items: TimeEntry[]
  page: number
  limit: number
  totalHours: number
  billableHours: number
  entryCount: number
}

// ---- Config ----

const BILLABLE_TABS = [
  { label: 'All', value: 'all' },
  { label: 'Billable', value: '1' },
  { label: 'Non-billable', value: '0' },
]

const VIEW_TABS = [
  { label: 'Entries', value: 'entries' },
  { label: 'By Client', value: 'by_client' },
]

// ---- Helpers ----

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr.includes('T') ? dateStr : dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch { return '--' }
}

function formatHours(h: number): string {
  return h.toFixed(1) + 'h'
}

// ---- Log Time Modal ----

interface SelectOption {
  value: string
  label: string
  subtitle?: string
}

function LogTimeModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const { showToast } = useToast()
  const [orgId, setOrgId] = useState<string | null>(null)
  const [teamMemberId, setTeamMemberId] = useState<string | null>(null)
  const [requestId, setRequestId] = useState<string | null>(null)
  const [hours, setHours] = useState('')
  const [hourlyRate, setHourlyRate] = useState('')
  const [notes, setNotes] = useState('')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [billable, setBillable] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [clientOptions, setClientOptions] = useState<SelectOption[]>([])
  const [memberOptions, setMemberOptions] = useState<SelectOption[]>([])
  const [requestOptions, setRequestOptions] = useState<SelectOption[]>([])

  useEffect(() => {
    fetch(apiPath('/api/admin/clients'))
      .then(r => r.json() as Promise<{ organisations: Array<{ id: string; name: string }> }>)
      .then(data => {
        setClientOptions(
          (data.organisations ?? []).map(o => ({ value: o.id, label: o.name }))
        )
      })
      .catch(() => setClientOptions([]))

    fetch(apiPath('/api/admin/team'))
      .then(r => r.json() as Promise<{ items: Array<{ id: string; name: string; email: string }> }>)
      .then(data => {
        setMemberOptions(
          (data.items ?? []).map(m => ({ value: m.id, label: m.name, subtitle: m.email }))
        )
      })
      .catch(() => setMemberOptions([]))

    fetch(apiPath('/api/admin/requests?status=all'))
      .then(r => r.json() as Promise<{ requests: Array<{ id: string; title: string; orgName?: string | null }> }>)
      .then(data => {
        setRequestOptions(
          (data.requests ?? []).map(r => ({ value: r.id, label: r.title, subtitle: r.orgName ?? undefined }))
        )
      })
      .catch(() => setRequestOptions([]))
  }, [])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!orgId || !teamMemberId || !hours || !date) {
      setError('Client, team member, hours, and date are required.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await fetch(apiPath('/api/admin/time'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          teamMemberId,
          requestId: requestId || undefined,
          hours: parseFloat(hours),
          hourlyRate: hourlyRate ? parseFloat(hourlyRate) : undefined,
          notes: notes.trim() || undefined,
          date,
          billable,
        }),
      })
      if (!res.ok) {
        const json = await res.json() as { error?: string }
        setError(json.error ?? 'Failed to log time.')
        return
      }
      showToast('Time entry logged successfully')
      onCreated()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }, [orgId, teamMemberId, requestId, hours, hourlyRate, notes, date, billable, onCreated, showToast])

  const inputStyle = {
    padding: '0.5rem 0.75rem',
    borderRadius: '0.5rem',
    fontSize: '0.875rem',
    border: '1px solid var(--color-border)',
    outline: 'none',
    color: 'var(--color-text)',
    background: 'var(--color-bg)',
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="log-time-title"
      style={{
        position: 'fixed', inset: 0, zIndex: 70,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.4)',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{
          background: 'var(--color-bg)', borderRadius: '0.75rem', padding: '1.75rem',
          width: '100%', maxWidth: '30rem', maxHeight: '90vh', overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
        }}
      >
        <h2 id="log-time-title" className="text-lg font-bold" style={{ color: 'var(--color-text)', marginBottom: '1.25rem' }}>
          Log Time
        </h2>
        {error && (
          <div
            aria-live="polite"
            style={{ background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger)', borderRadius: '0.5rem', padding: '0.625rem 0.875rem', marginBottom: '1rem', color: 'var(--color-danger)', fontSize: '0.8125rem' }}
          >
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            <label style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--color-text)' }}>Client</label>
            <SearchableSelect
              options={clientOptions}
              value={orgId}
              onChange={setOrgId}
              placeholder="Select a client..."
              searchPlaceholder="Search clients..."
              allowClear
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            <label style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--color-text)' }}>Team Member</label>
            <SearchableSelect
              options={memberOptions}
              value={teamMemberId}
              onChange={setTeamMemberId}
              placeholder="Select a team member..."
              searchPlaceholder="Search team members..."
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            <label style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--color-text)' }}>Request (optional)</label>
            <SearchableSelect
              options={requestOptions}
              value={requestId}
              onChange={setRequestId}
              placeholder="None (internal time)"
              searchPlaceholder="Search requests..."
              allowClear
            />
          </div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', flex: 1 }}>
              <label htmlFor="lt-hours" style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--color-text)' }}>Hours</label>
              <input id="lt-hours" type="number" min="0.1" step="0.1" placeholder="0.0" value={hours} onChange={e => setHours(e.target.value)} required style={inputStyle} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', flex: 1 }}>
              <label htmlFor="lt-rate" style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--color-text)' }}>Rate ($/hr)</label>
              <input id="lt-rate" type="number" min="0" step="1" placeholder="e.g. 150" value={hourlyRate} onChange={e => setHourlyRate(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', flex: 1 }}>
              <label htmlFor="lt-date" style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--color-text)' }}>Date</label>
              <input id="lt-date" type="date" value={date} onChange={e => setDate(e.target.value)} required style={inputStyle} />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input
              id="lt-billable"
              type="checkbox"
              checked={billable}
              onChange={e => setBillable(e.target.checked)}
              style={{ width: '1rem', height: '1rem', accentColor: 'var(--color-brand)' }}
            />
            <label htmlFor="lt-billable" style={{ fontSize: '0.875rem', color: 'var(--color-text)' }}>Billable</label>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            <label htmlFor="lt-notes" style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--color-text)' }}>Notes</label>
            <textarea id="lt-notes" rows={3} placeholder="What did you work on?" value={notes} onChange={e => setNotes(e.target.value)} style={{ ...inputStyle, resize: 'vertical' as const }} />
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '0.5rem 1rem', borderRadius: '0.5rem', fontSize: '0.875rem', fontWeight: 500,
                border: '1px solid var(--color-border)', background: 'var(--color-bg)',
                color: 'var(--color-text)', cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                padding: '0.5rem 1.25rem', borderRadius: '0.5rem', fontSize: '0.875rem', fontWeight: 600,
                border: 'none', background: saving ? 'var(--color-text-subtle)' : 'var(--color-brand)',
                color: 'white', cursor: saving ? 'not-allowed' : 'pointer',
              }}
            >
              {saving ? 'Saving...' : 'Log Time'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---- Summary Card ----

function SummaryCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div
      style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-card)',
        padding: '1.5rem',
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
        flex: '1 1 200px',
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: '0 10px 0 10px',
          background: 'linear-gradient(135deg, var(--color-brand), var(--color-brand-dark))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div>
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: '0.125rem' }}>{label}</p>
        <p style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text)' }}>{value}</p>
      </div>
    </div>
  )
}

// ---- By Client View ----

interface ClientGroup {
  orgId: string
  orgName: string
  totalHours: number
  billableHours: number
  entries: TimeEntry[]
}

function ByClientView({
  entries,
  loading,
  error,
  onRetry,
}: {
  entries: TimeEntry[]
  loading: boolean
  error: boolean
  onRetry: () => void
}) {
  const [expandedOrg, setExpandedOrg] = useState<string | null>(null)

  // Group entries by client
  const groups: ClientGroup[] = []
  const groupMap = new Map<string, ClientGroup>()

  for (const entry of entries) {
    const existing = groupMap.get(entry.orgId)
    if (existing) {
      existing.totalHours += entry.hours
      if (entry.billable) existing.billableHours += entry.hours
      existing.entries.push(entry)
    } else {
      const group: ClientGroup = {
        orgId: entry.orgId,
        orgName: entry.orgName ?? 'Unknown',
        totalHours: entry.hours,
        billableHours: entry.billable ? entry.hours : 0,
        entries: [entry],
      }
      groupMap.set(entry.orgId, group)
      groups.push(group)
    }
  }

  // Sort by total hours descending
  groups.sort((a, b) => b.totalHours - a.totalHours)

  if (loading) {
    return <LoadingSkeleton rows={5} height={56} />
  }

  if (error) {
    return (
      <div
        style={{ padding: '3rem 1.5rem', textAlign: 'center', color: 'var(--color-text-muted)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}
      >
        <p className="text-sm">Failed to load time entries.</p>
        <button
          onClick={onRetry}
          className="flex items-center gap-2 text-sm font-medium hover:opacity-80 transition-opacity"
          style={{ color: 'var(--color-brand)', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          <RefreshCw style={{ width: 14, height: 14 }} aria-hidden="true" />
          Retry
        </button>
      </div>
    )
  }

  if (groups.length === 0) {
    return (
      <EmptyState
        icon={<Users style={{ width: 28, height: 28, color: 'white' }} aria-hidden="true" />}
        title="No time entries yet"
        description="Log your first time entry to start tracking hours by client."
      />
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {groups.map(group => {
        const isExpanded = expandedOrg === group.orgId
        return (
          <div
            key={group.orgId}
            style={{
              background: 'var(--color-bg)',
              borderRadius: 'var(--radius-card)',
              border: '1px solid var(--color-border)',
              overflow: 'hidden',
            }}
          >
            <button
              onClick={() => setExpandedOrg(isExpanded ? null : group.orgId)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '1rem 1.25rem',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '0 8px 0 8px',
                    background: 'linear-gradient(135deg, var(--color-brand), var(--color-brand-dark))',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Users style={{ width: 16, height: 16, color: 'white' }} aria-hidden="true" />
                </div>
                <div>
                  <p style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text)' }}>
                    {group.orgName}
                  </p>
                  <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                    {group.entries.length} {group.entries.length === 1 ? 'entry' : 'entries'}
                  </p>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--color-text)' }}>
                    {formatHours(group.totalHours)}
                  </p>
                  <p style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)' }}>total</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-success)' }}>
                    {formatHours(group.billableHours)}
                  </p>
                  <p style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)' }}>billable</p>
                </div>
                {isExpanded ? (
                  <ChevronUp style={{ width: 16, height: 16, color: 'var(--color-text-subtle)' }} />
                ) : (
                  <ChevronDown style={{ width: 16, height: 16, color: 'var(--color-text-subtle)' }} />
                )}
              </div>
            </button>

            {isExpanded && (
              <div style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 500 }}>
                    <thead>
                      <tr style={{ background: 'var(--color-bg-secondary)' }}>
                        {['Date', 'Team Member', 'Request', 'Hours', 'Billable', 'Notes'].map(h => (
                          <th
                            key={h}
                            style={{
                              padding: '0.5rem 1rem', textAlign: 'left', fontSize: '0.6875rem',
                              fontWeight: 600, color: 'var(--color-text-muted)',
                              textTransform: 'uppercase', letterSpacing: '0.04em',
                            }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {group.entries.map((entry, i) => (
                        <tr
                          key={entry.id}
                          style={{
                            borderBottom: i < group.entries.length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
                          }}
                        >
                          <td style={{ padding: '0.625rem 1rem', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                            {formatDate(entry.date)}
                          </td>
                          <td style={{ padding: '0.625rem 1rem', fontSize: '0.8125rem', fontWeight: 500, color: 'var(--color-text)' }}>
                            {entry.teamMemberName ?? 'Unknown'}
                          </td>
                          <td style={{ padding: '0.625rem 1rem', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                            {entry.requestId && entry.requestTitle ? (
                              <Link href={`/requests/${entry.requestId}`} style={{ color: 'var(--color-brand)', textDecoration: 'none' }}>
                                {entry.requestTitle}
                              </Link>
                            ) : (
                              '--'
                            )}
                          </td>
                          <td style={{ padding: '0.625rem 1rem', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)' }}>
                            {formatHours(entry.hours)}
                          </td>
                          <td style={{ padding: '0.625rem 1rem' }}>
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                padding: '0.125rem 0.5rem',
                                borderRadius: 99,
                                fontSize: '0.75rem',
                                fontWeight: 500,
                                background: entry.billable ? 'var(--color-success-bg)' : 'var(--status-draft-bg)',
                                color: entry.billable ? 'var(--color-success)' : 'var(--color-text-muted)',
                              }}
                            >
                              {entry.billable ? 'Yes' : 'No'}
                            </span>
                          </td>
                          <td style={{ padding: '0.625rem 1rem', fontSize: '0.8125rem', color: 'var(--color-text-muted)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {entry.notes ?? '--'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ---- Main Component ----

export function TimeList() {
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [billableTab, setBillableTab] = useState('all')
  const [showModal, setShowModal] = useState(false)
  const [viewTab, setViewTab] = useState('entries')
  const [totalHours, setTotalHours] = useState(0)
  const [billableHours, setBillableHours] = useState(0)
  const [entryCount, setEntryCount] = useState(0)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [dateRange, setDateRange] = useState<DateRange>({ from: null, to: null })

  // Client-side date filter
  const filteredEntries = entries.filter(e => {
    if (!dateRange.from || !dateRange.to) return true
    const d = new Date(e.date ?? e.createdAt).getTime()
    return d >= dateRange.from.getTime() && d <= dateRange.to.getTime()
  })

  const fetchEntries = useCallback(async (billable: string) => {
    setLoading(true)
    setError(false)
    try {
      const params = new URLSearchParams()
      if (billable !== 'all') params.set('billable', billable)
      const url = apiPath(`/api/admin/time${params.toString() ? '?' + params.toString() : ''}`)
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed')
      const json = await res.json() as TimeResponse
      setEntries(json.items ?? [])
      setTotalHours(json.totalHours ?? 0)
      setBillableHours(json.billableHours ?? 0)
      setEntryCount(json.entryCount ?? 0)
    } catch {
      setError(true)
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [])

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    const res = await fetch(apiPath(`/api/admin/time/${deleteTarget}`), { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to delete')
    setDeleteTarget(null)
    fetchEntries(billableTab).catch(() => {})
  }, [deleteTarget, billableTab, fetchEntries])

  useEffect(() => {
    fetchEntries(billableTab).catch(() => {})
  }, [billableTab, fetchEntries])

  const handleCreated = useCallback(() => {
    setShowModal(false)
    fetchEntries(billableTab).catch(() => {})
  }, [billableTab, fetchEntries])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)', margin: 0 }}>Time Tracking</h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
            Log and review hours across all clients and requests.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button
            onClick={() => {
              const link = document.createElement('a')
              link.href = apiPath('/api/admin/export/time')
              link.download = 'time-entries.csv'
              link.click()
            }}
            className="flex items-center gap-2 text-sm font-medium transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2"
            style={{
              padding: '0.625rem 1.125rem',
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: '0.5rem',
              cursor: 'pointer',
              color: 'var(--color-text)',
              minHeight: 44,
            }}
          >
            <Download style={{ width: 16, height: 16 }} aria-hidden="true" />
            Export CSV
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2"
            style={{
              padding: '0.625rem 1.125rem',
              background: 'var(--color-brand)',
              border: 'none',
              borderRadius: '0 10px 0 10px',
              cursor: 'pointer',
              color: 'white',
              minHeight: 44,
            }}
          >
            <Plus style={{ width: 16, height: 16 }} aria-hidden="true" />
            Log Time
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <SummaryCard
          icon={<Timer style={{ width: 22, height: 22, color: 'white' }} />}
          label="Total Hours"
          value={formatHours(totalHours)}
        />
        <SummaryCard
          icon={<DollarSign style={{ width: 22, height: 22, color: 'white' }} />}
          label="Billable Hours"
          value={formatHours(billableHours)}
        />
        <SummaryCard
          icon={<Clock style={{ width: 22, height: 22, color: 'white' }} />}
          label="Entries"
          value={String(entryCount)}
        />
      </div>

      {/* View Tabs */}
      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          {VIEW_TABS.map(tab => (
            <button
              key={tab.value}
              onClick={() => setViewTab(tab.value)}
              style={{
                padding: '0.5rem 0.875rem',
                fontSize: '0.8125rem',
                fontWeight: viewTab === tab.value ? 600 : 400,
                color: viewTab === tab.value ? 'white' : 'var(--color-text-muted)',
                background: viewTab === tab.value ? 'var(--color-brand)' : 'var(--color-bg-secondary)',
                border: viewTab === tab.value ? '1px solid var(--color-brand)' : '1px solid var(--color-border)',
                borderRadius: '0.5rem',
                cursor: 'pointer',
                minHeight: 36,
                transition: 'all 0.15s',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Filter Tabs */}
      <div style={{ display: 'flex', gap: '0.25rem', borderBottom: '1px solid var(--color-border)', paddingBottom: 0 }}>
        {BILLABLE_TABS.map(tab => (
          <button
            key={tab.value}
            onClick={() => setBillableTab(tab.value)}
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.8125rem',
              fontWeight: billableTab === tab.value ? 600 : 400,
              color: billableTab === tab.value ? 'var(--color-brand)' : 'var(--color-text-muted)',
              background: 'none',
              border: 'none',
              borderBottom: billableTab === tab.value ? '2px solid var(--color-brand)' : '2px solid transparent',
              cursor: 'pointer',
              marginBottom: -1,
              minHeight: 44,
              transition: 'color 0.15s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Date filter */}
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <DateRangePicker value={dateRange} onChange={setDateRange} label="Entry date" />
      </div>

      {/* By Client View */}
      {viewTab === 'by_client' && (
        <ByClientView entries={filteredEntries} loading={loading} error={error} onRetry={() => fetchEntries(billableTab).catch(() => {})} />
      )}

      {/* Table */}
      {viewTab === 'entries' && (
      <div
        style={{
          background: 'var(--color-bg)',
          borderRadius: 'var(--radius-card)',
          border: '1px solid var(--color-border)',
          overflow: 'hidden',
        }}
      >
        {loading ? (
          <LoadingSkeleton rows={5} height={56} />
        ) : error ? (
          <div
            style={{ padding: '3rem 1.5rem', textAlign: 'center', color: 'var(--color-text-muted)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}
          >
            <p className="text-sm">Failed to load time entries.</p>
            <button
              onClick={() => fetchEntries(billableTab).catch(() => {})}
              className="flex items-center gap-2 text-sm font-medium hover:opacity-80 transition-opacity"
              style={{ color: 'var(--color-brand)', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              <RefreshCw style={{ width: 14, height: 14 }} aria-hidden="true" />
              Retry
            </button>
          </div>
        ) : filteredEntries.length === 0 ? (
          <EmptyState
            icon={<Clock style={{ width: 28, height: 28, color: 'white' }} aria-hidden="true" />}
            title="No time entries yet"
            description="Log your first time entry to start tracking hours."
            ctaLabel="Log Time"
            onCtaClick={() => setShowModal(true)}
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
              <thead>
                <tr style={{ background: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border)' }}>
                  {['Date', 'Team Member', 'Client', 'Request', 'Hours', 'Billable', 'Notes', ''].map(h => (
                    <th
                      key={h}
                      style={{
                        padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.75rem',
                        fontWeight: 600, color: 'var(--color-text-muted)',
                        textTransform: 'uppercase', letterSpacing: '0.04em',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((entry, i) => (
                  <tr
                    key={entry.id}
                    style={{
                      borderBottom: i < entries.length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLTableRowElement).style.background = 'var(--color-bg-secondary)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background = '' }}
                  >
                    <td style={{ padding: '0.875rem 1rem', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                      {formatDate(entry.date)}
                    </td>
                    <td style={{ padding: '0.875rem 1rem', fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text)' }}>
                      {entry.teamMemberName ?? 'Unknown'}
                    </td>
                    <td style={{ padding: '0.875rem 1rem', fontSize: '0.875rem', color: 'var(--color-text)' }}>
                      {entry.orgName ?? 'Unknown'}
                    </td>
                    <td style={{ padding: '0.875rem 1rem', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                      {entry.requestId && entry.requestTitle ? (
                        <Link href={`/requests/${entry.requestId}`} style={{ color: 'var(--color-brand)', textDecoration: 'none' }}>
                          {entry.requestTitle}
                        </Link>
                      ) : (
                        '--'
                      )}
                    </td>
                    <td style={{ padding: '0.875rem 1rem', fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text)' }}>
                      {formatHours(entry.hours)}
                    </td>
                    <td style={{ padding: '0.875rem 1rem' }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          padding: '0.125rem 0.5rem',
                          borderRadius: 99,
                          fontSize: '0.75rem',
                          fontWeight: 500,
                          background: entry.billable ? 'var(--color-success-bg)' : 'var(--status-draft-bg)',
                          color: entry.billable ? 'var(--color-success)' : 'var(--color-text-muted)',
                        }}
                      >
                        {entry.billable ? 'Billable' : 'Non-billable'}
                      </span>
                    </td>
                    <td style={{ padding: '0.875rem 1rem', fontSize: '0.8125rem', color: 'var(--color-text-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {entry.notes ?? '--'}
                    </td>
                    <td style={{ padding: '0.875rem 0.5rem', width: '2.5rem' }}>
                      <button
                        onClick={() => setDeleteTarget(entry.id)}
                        className="p-1.5 rounded-lg hover:bg-[var(--color-danger-bg)] text-[var(--color-text-subtle)] hover:text-[var(--color-danger)] transition-colors"
                        aria-label="Delete time entry"
                        style={{ border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        <Trash2 style={{ width: '0.875rem', height: '0.875rem' }} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      )}

      {/* Log Time Modal */}
      {showModal && (
        <LogTimeModal
          onClose={() => setShowModal(false)}
          onCreated={handleCreated}
        />
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete time entry"
        description="This time entry will be permanently removed. This action cannot be undone."
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Mobile bottom nav spacer */}
      <div className="h-28 md:hidden" aria-hidden="true" />
    </div>
  )
}
