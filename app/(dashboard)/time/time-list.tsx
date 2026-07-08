'use client'

import { useState, useCallback, useMemo } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import {
  Plus, Clock, RefreshCw, DollarSign, Timer, Download, ChevronDown, ChevronUp,
  Users, Trash2, Save, Search,
} from 'lucide-react'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'
import { EmptyState } from '@/components/tahi/empty-state'
import { SearchableSelect } from '@/components/tahi/searchable-select'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { DateRangePicker, type DateRange } from '@/components/tahi/date-range-picker'
import { Card } from '@/components/tahi/card'
import { Badge } from '@/components/tahi/badge'
import { Avatar } from '@/components/tahi/avatar'
import { Input } from '@/components/tahi/input'
import { TahiButton } from '@/components/tahi/tahi-button'
import { SlideOver } from '@/components/tahi/slide-over'
import { DataTable, type DataTableColumn } from '@/components/tahi/data-table'
import { FilterBar, type FilterDef, type ActiveFilter } from '@/components/tahi/filter-bar'
import { FeatureCard } from '@/components/tahi/feature-card'
import { BarChart, DonutChart, type BarDatum } from '@/components/tahi/chart'
import { apiPath } from '@/lib/api'
import { useToast } from '@/components/tahi/toast'

// ── Types ──────────────────────────────────────────────────────────────────

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

interface SelectOption {
  value: string
  label: string
  subtitle?: string
}

// ── Config ─────────────────────────────────────────────────────────────────

const VIEW_TABS = [
  { label: 'Entries', value: 'entries' },
  { label: 'By client', value: 'by_client' },
] as const

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr.includes('T') ? dateStr : dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch { return '--' }
}

function formatHours(h: number): string {
  return h.toFixed(1) + 'h'
}

// ── Log Time SlideOver ─────────────────────────────────────────────────────

function LogTimeSlideOver({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
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

  // All three lists are fetched only when the slide-over is open.
  // SWR caches them globally so re-opening is instant.
  const { data: clientsData } = useSWR<{ organisations: Array<{ id: string; name: string }> }>(
    open ? '/api/admin/clients' : null
  )
  const { data: teamData } = useSWR<{ items: Array<{ id: string; name: string; email: string }> }>(
    open ? '/api/admin/team' : null
  )
  const { data: requestsData } = useSWR<{ requests: Array<{ id: string; title: string; orgName?: string | null }> }>(
    open ? '/api/admin/requests?status=all' : null
  )

  const clientOptions: SelectOption[] = (clientsData?.organisations ?? []).map(o => ({ value: o.id, label: o.name }))
  const memberOptions: SelectOption[] = (teamData?.items ?? []).map(m => ({ value: m.id, label: m.name, subtitle: m.email }))
  const requestOptions: SelectOption[] = (requestsData?.requests ?? []).map(r => ({ value: r.id, label: r.title, subtitle: r.orgName ?? undefined }))

  const handleSubmit = useCallback(async () => {
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
      // Reset form
      setOrgId(null)
      setTeamMemberId(null)
      setRequestId(null)
      setHours('')
      setHourlyRate('')
      setNotes('')
      setBillable(true)
      onCreated()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }, [orgId, teamMemberId, requestId, hours, hourlyRate, notes, date, billable, onCreated, showToast])

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '0.625rem',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--color-text-subtle)',
    marginBottom: '0.3125rem',
  }

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      icon={<Clock size={15} />}
      title="Log time"
      subtitle="Record hours against a client and (optionally) a request."
      maxWidth="48rem"
    >
      <SlideOver.Body>
        {error && (
          <div
            aria-live="polite"
            style={{
              background: 'var(--color-danger-bg)',
              border: '1px solid var(--color-danger)',
              borderRadius: 'var(--radius-md)',
              padding: '0.625rem 0.875rem',
              marginBottom: '0.875rem',
              color: 'var(--color-danger)',
              fontSize: '0.8125rem',
            }}
          >
            {error}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          <div>
            <label style={labelStyle} htmlFor="lt-client">Client</label>
            <SearchableSelect
              options={clientOptions}
              value={orgId}
              onChange={setOrgId}
              placeholder="Select a client..."
              searchPlaceholder="Search clients..."
              allowClear
            />
          </div>
          <div>
            <label style={labelStyle} htmlFor="lt-member">Team member</label>
            <SearchableSelect
              options={memberOptions}
              value={teamMemberId}
              onChange={setTeamMemberId}
              placeholder="Select a team member..."
              searchPlaceholder="Search team members..."
            />
          </div>
          <div>
            <label style={labelStyle} htmlFor="lt-request">Request <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400, color: 'var(--color-text-subtle)' }}>· optional</span></label>
            <SearchableSelect
              options={requestOptions}
              value={requestId}
              onChange={setRequestId}
              placeholder="None (internal time)"
              searchPlaceholder="Search requests..."
              allowClear
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.75rem' }}>
            <div>
              <label style={labelStyle} htmlFor="lt-hours">Hours</label>
              <Input
                id="lt-hours"
                type="number"
                min="0.1"
                step="0.1"
                placeholder="0.0"
                value={hours}
                onChange={e => setHours(e.target.value)}
                required
              />
            </div>
            <div>
              <label style={labelStyle} htmlFor="lt-rate">Rate ($/hr)</label>
              <Input
                id="lt-rate"
                type="number"
                min="0"
                step="1"
                placeholder="e.g. 150"
                value={hourlyRate}
                onChange={e => setHourlyRate(e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle} htmlFor="lt-date">Date</label>
              <Input
                id="lt-date"
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                required
              />
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
            <label htmlFor="lt-billable" style={{ fontSize: '0.8125rem', color: 'var(--color-text)' }}>Billable</label>
          </div>
          <div>
            <label style={labelStyle} htmlFor="lt-notes">Notes</label>
            <textarea
              id="lt-notes"
              rows={3}
              placeholder="What did you work on?"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              style={{
                width: '100%',
                padding: 'var(--space-1-5) var(--space-3)',
                fontSize: 'var(--text-sm)',
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--color-text)',
                outline: 'none',
                resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />
          </div>
        </div>
      </SlideOver.Body>
      <SlideOver.Footer>
        <TahiButton variant="secondary" size="sm" onClick={onClose}>
          Cancel
        </TahiButton>
        <div style={{ flex: 1 }} />
        <TahiButton
          size="sm"
          onClick={handleSubmit}
          disabled={saving}
          iconLeft={saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
        >
          {saving ? 'Saving...' : 'Log time'}
        </TahiButton>
      </SlideOver.Footer>
    </SlideOver>
  )
}

// ── Summary Card ───────────────────────────────────────────────────────────

function SummaryCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card padding="md" style={{ flex: '1 1 12rem', display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
      <div
        aria-hidden="true"
        style={{
          width: '2.5rem',
          height: '2.5rem',
          borderRadius: 'var(--radius-leaf-sm)',
          background: 'linear-gradient(135deg, var(--color-brand-light), var(--color-brand-dark))',
          color: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div>
        <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', margin: 0 }}>{label}</p>
        <p style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text)', margin: '0.125rem 0 0' }}>{value}</p>
      </div>
    </Card>
  )
}

// ── By Client View ─────────────────────────────────────────────────────────

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
  groups.sort((a, b) => b.totalHours - a.totalHours)

  if (loading) {
    return (
      <Card padding="none">
        <LoadingSkeleton rows={5} height={56} />
      </Card>
    )
  }

  if (error) {
    return (
      <Card padding="lg" style={{ textAlign: 'center' }}>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', marginBottom: '0.75rem' }}>
          Failed to load time entries.
        </p>
        <TahiButton variant="secondary" size="sm" onClick={onRetry} iconLeft={<RefreshCw className="w-3.5 h-3.5" />}>
          Retry
        </TahiButton>
      </Card>
    )
  }

  if (groups.length === 0) {
    return (
      <Card padding="none">
        <EmptyState
          icon={<Users className="w-6 h-6" />}
          title="No time entries yet"
          description="Log your first time entry to start tracking hours by client."
        />
      </Card>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {groups.map(group => {
        const isExpanded = expandedOrg === group.orgId
        return (
          <Card key={group.orgId} padding="none" style={{ overflow: 'hidden' }}>
            <button
              onClick={() => setExpandedOrg(isExpanded ? null : group.orgId)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.875rem 1.125rem',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'background-color 120ms ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              aria-expanded={isExpanded}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1, minWidth: 0 }}>
                <Avatar name={group.orgName} size="sm" tooltip={false} />
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {group.orgName}
                  </p>
                  <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', margin: '0.125rem 0 0' }}>
                    {group.entries.length} {group.entries.length === 1 ? 'entry' : 'entries'}
                  </p>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>
                    {formatHours(group.totalHours)}
                  </p>
                  <p style={{ fontSize: '0.625rem', color: 'var(--color-text-subtle)', margin: '0.125rem 0 0', textTransform: 'uppercase', letterSpacing: '0.04em' }}>total</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-success)', margin: 0 }}>
                    {formatHours(group.billableHours)}
                  </p>
                  <p style={{ fontSize: '0.625rem', color: 'var(--color-text-subtle)', margin: '0.125rem 0 0', textTransform: 'uppercase', letterSpacing: '0.04em' }}>billable</p>
                </div>
                {isExpanded ? (
                  <ChevronUp size={16} aria-hidden="true" style={{ color: 'var(--color-text-subtle)' }} />
                ) : (
                  <ChevronDown size={16} aria-hidden="true" style={{ color: 'var(--color-text-subtle)' }} />
                )}
              </div>
            </button>

            {isExpanded && (
              <div style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
                <div className="h-scroll">
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 500 }}>
                    <thead>
                      <tr style={{ background: 'var(--color-bg-secondary)' }}>
                        {['Date', 'Team member', 'Request', 'Hours', 'Billable', 'Notes'].map(h => (
                          <th
                            key={h}
                            style={{
                              padding: '0.5rem 1rem', textAlign: 'left', fontSize: '0.6875rem',
                              fontWeight: 600, color: 'var(--color-text-subtle)',
                              textTransform: 'uppercase', letterSpacing: '0.06em',
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
                          <td style={{ padding: '0.625rem 1rem', fontSize: '0.8125rem', color: 'var(--color-text)' }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                              <Avatar name={entry.teamMemberName ?? 'Unknown'} size={22} tooltip />
                              <span style={{ fontWeight: 500 }}>{entry.teamMemberName ?? 'Unknown'}</span>
                            </div>
                          </td>
                          <td style={{ padding: '0.625rem 1rem', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                            {entry.requestId && entry.requestTitle ? (
                              <Link href={`/requests/${entry.requestId}`} style={{ color: 'var(--color-text-active)', textDecoration: 'underline', textDecorationStyle: 'dotted', textDecorationColor: 'var(--color-brand-100)', textUnderlineOffset: '0.1875rem' }}>
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
                            <Badge
                              tone={entry.billable ? 'positive' : 'neutral'}
                              variant="soft"
                              size="sm"
                              leader={false}
                            >
                              {entry.billable ? 'Yes' : 'No'}
                            </Badge>
                          </td>
                          <td style={{ padding: '0.625rem 1rem', fontSize: '0.8125rem', color: 'var(--color-text-muted)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {entry.notes ?? '--'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Card>
        )
      })}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────

export function TimeList() {
  const [showModal, setShowModal] = useState(false)
  const [viewTab, setViewTab] = useState<'entries' | 'by_client'>('entries')
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [dateRange, setDateRange] = useState<DateRange>({ from: null, to: null })
  const [search, setSearch] = useState('')

  // FilterBar state — billable + client + team member.
  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([])

  // Resolve the billable filter chip into the API query value ('all'|'1'|'0').
  const billableTab: string = useMemo(() => {
    const f = activeFilters.find(a => a.id === 'billable')
    return f?.value ?? 'all'
  }, [activeFilters])

  // Client + team member filter values (multiselect, applied client-side).
  const selectedClients = useMemo(() => {
    const f = activeFilters.find(a => a.id === 'client')
    return new Set(f?.values ?? [])
  }, [activeFilters])
  const selectedMembers = useMemo(() => {
    const f = activeFilters.find(a => a.id === 'member')
    return new Set(f?.values ?? [])
  }, [activeFilters])

  // Key encodes the billable filter so each view caches separately;
  // keepPreviousData (global default) shows old rows while revalidating.
  const timeKey = billableTab !== 'all' ? `/api/admin/time?billable=${billableTab}` : '/api/admin/time'
  const { data: timeData, isLoading: loading, error: fetchError, mutate } = useSWR<TimeResponse>(timeKey)

  const entries = timeData?.items ?? []
  const totalHours = timeData?.totalHours ?? 0
  const billableHours = timeData?.billableHours ?? 0

  // Client-side filter: date range + search + client + member.
  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase()
    return entries.filter(e => {
      if (dateRange.from && dateRange.to) {
        const d = new Date(e.date ?? e.createdAt).getTime()
        if (d < dateRange.from.getTime() || d > dateRange.to.getTime()) return false
      }
      if (selectedClients.size > 0 && !selectedClients.has(e.orgId)) return false
      if (selectedMembers.size > 0 && !selectedMembers.has(e.teamMemberId)) return false
      if (q) {
        const hay = `${e.orgName ?? ''} ${e.teamMemberName ?? ''} ${e.requestTitle ?? ''} ${e.notes ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [entries, dateRange, search, selectedClients, selectedMembers])
  const entryCount = timeData?.entryCount ?? 0
  const error = !!fetchError

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    const res = await fetch(apiPath(`/api/admin/time/${deleteTarget}`), { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to delete')
    setDeleteTarget(null)
    await mutate()
  }, [deleteTarget, mutate])

  const handleCreated = useCallback(() => {
    setShowModal(false)
    void mutate()
  }, [mutate])

  // Filter defs derived from the loaded entries so chip options reflect
  // what's actually in the dataset. Recomputed on every refresh.
  const filterDefs: FilterDef[] = useMemo(() => {
    const clientOpts = Array.from(
      new Map(entries.map(e => [e.orgId, e.orgName ?? 'Unknown'])).entries()
    ).map(([value, label]) => ({ value, label }))
    const memberOpts = Array.from(
      new Map(entries.map(e => [e.teamMemberId, e.teamMemberName ?? 'Unknown'])).entries()
    ).map(([value, label]) => ({ value, label }))
    return [
      {
        id: 'billable',
        label: 'Billable',
        kind: 'select',
        options: [
          { value: 'all', label: 'All' },
          { value: '1', label: 'Billable', tone: 'positive' },
          { value: '0', label: 'Non-billable', tone: 'neutral' },
        ],
      },
      { id: 'client', label: 'Client',      kind: 'multiselect', options: clientOpts },
      { id: 'member', label: 'Team member', kind: 'multiselect', options: memberOpts },
    ]
  }, [entries])

  // DataTable columns for the entries view.
  const columns: DataTableColumn<TimeEntry>[] = useMemo(() => [
    {
      key: 'date',
      header: 'Date',
      sortable: true,
      sortValue: r => r.date,
      width: '8.5rem',
      render: r => (
        <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
          {formatDate(r.date)}
        </span>
      ),
    },
    {
      key: 'member',
      header: 'Team member',
      sortable: true,
      sortValue: r => (r.teamMemberName ?? '').toLowerCase(),
      minWidth: '11rem',
      render: r => (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
          <Avatar name={r.teamMemberName ?? 'Unknown'} size={22} tooltip />
          <span style={{ fontWeight: 500, color: 'var(--color-text)' }}>{r.teamMemberName ?? 'Unknown'}</span>
        </div>
      ),
    },
    {
      key: 'client',
      header: 'Client',
      sortable: true,
      sortValue: r => (r.orgName ?? '').toLowerCase(),
      minWidth: '11rem',
      render: r => (
        <span style={{ color: 'var(--color-text)' }}>{r.orgName ?? 'Unknown'}</span>
      ),
    },
    {
      key: 'request',
      header: 'Request',
      minWidth: '12rem',
      link: {
        href: r => (r.requestId ? `/requests/${r.requestId}` : undefined),
      },
      render: r => (r.requestId && r.requestTitle ? r.requestTitle : '--'),
    },
    {
      key: 'hours',
      header: 'Hours',
      sortable: true,
      sortValue: r => r.hours,
      width: '5.5rem',
      align: 'right',
      render: r => (
        <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{formatHours(r.hours)}</span>
      ),
    },
    {
      key: 'billable',
      header: 'Billable',
      sortable: true,
      sortValue: r => (r.billable ? 1 : 0),
      width: '7rem',
      render: r => (
        <Badge
          tone={r.billable ? 'positive' : 'neutral'}
          variant="soft"
          size="sm"
          leader={false}
        >
          {r.billable ? 'Billable' : 'Non-billable'}
        </Badge>
      ),
    },
    {
      key: 'notes',
      header: 'Notes',
      minWidth: '14rem',
      muted: true,
      render: r => (
        <span style={{ display: 'inline-block', maxWidth: '18rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
          {r.notes ?? '--'}
        </span>
      ),
    },
  ], [])

  const handleExport = () => {
    const link = document.createElement('a')
    link.href = apiPath('/api/admin/export/time')
    link.download = 'time-entries.csv'
    link.click()
  }

  // Hours-by-member bar chart data. Aggregates the filtered entry list
  // so the chart tracks the active filters (date range, client etc).
  // Capped at the top 8 contributors to keep the bars legible.
  const hoursByMember: readonly BarDatum[] = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of filteredEntries) {
      const name = e.teamMemberName ?? 'Unknown'
      map.set(name, (map.get(name) ?? 0) + e.hours)
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([label, value]) => ({ label, value: Math.round(value * 10) / 10 }))
  }, [filteredEntries])

  // Billable vs non-billable split for the donut. Uses the filtered set
  // so the donut updates when the user narrows the view.
  const billableSplit = useMemo(() => {
    let billable = 0
    let nonBillable = 0
    for (const e of filteredEntries) {
      if (e.billable) billable += e.hours
      else nonBillable += e.hours
    }
    return {
      billable: Math.round(billable * 10) / 10,
      nonBillable: Math.round(nonBillable * 10) / 10,
      total: Math.round((billable + nonBillable) * 10) / 10,
    }
  }, [filteredEntries])

  // "This week" tile: top contributor + billable percentage. Computed
  // from the filtered set so it respects the active date range.
  const summaryHero = useMemo(() => {
    const topName = hoursByMember[0]?.label ?? null
    const topHours = hoursByMember[0]?.value ?? 0
    const billablePct = billableSplit.total > 0
      ? Math.round((billableSplit.billable / billableSplit.total) * 100)
      : 0
    return { topName, topHours, billablePct }
  }, [hoursByMember, billableSplit])

  return (
    <div style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '14rem' }}>
          <h1 style={{
            margin: 0,
            fontSize: '1.5rem',
            fontWeight: 700,
            color: 'var(--color-text)',
            letterSpacing: '-0.015em',
          }}>Time tracking</h1>
          <p style={{
            margin: '0.25rem 0 0',
            fontSize: '0.875rem',
            color: 'var(--color-text-muted)',
            lineHeight: 1.5,
          }}>
            Log and review hours across all clients and requests.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <TahiButton
            variant="secondary"
            size="sm"
            onClick={handleExport}
            iconLeft={<Download className="w-3.5 h-3.5" />}
          >
            Export CSV
          </TahiButton>
          <TahiButton
            size="sm"
            onClick={() => setShowModal(true)}
            iconLeft={<Plus className="w-3.5 h-3.5" />}
          >
            Log time
          </TahiButton>
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <SummaryCard
          icon={<Timer size={18} aria-hidden="true" />}
          label="Total hours"
          value={formatHours(totalHours)}
        />
        <SummaryCard
          icon={<DollarSign size={18} aria-hidden="true" />}
          label="Billable hours"
          value={formatHours(billableHours)}
        />
        <SummaryCard
          icon={<Clock size={18} aria-hidden="true" />}
          label="Entries"
          value={String(entryCount)}
        />
      </div>

      {/* Insight row: hero tile + bar chart + donut. All driven by the
          filtered entries so the user can scope by date or client and
          see the visuals update in step. Skipped while the first fetch
          is in flight to avoid empty-chart flash. */}
      {!loading && !error && filteredEntries.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr) minmax(0, 1fr)',
            gap: '0.875rem',
          }}
          className="time-insight-grid"
        >
          <style>{`
            @media (max-width: 64rem) {
              .time-insight-grid { grid-template-columns: 1fr !important; }
            }
          `}</style>

          <FeatureCard variant="forest" padding="lg">
            <FeatureCard.Eyebrow>This view</FeatureCard.Eyebrow>
            <FeatureCard.Title>
              {formatHours(billableSplit.total)} logged
            </FeatureCard.Title>
            <FeatureCard.Description>
              {summaryHero.billablePct}% billable.
              {summaryHero.topName
                ? ` Top contributor is ${summaryHero.topName} with ${formatHours(summaryHero.topHours)}.`
                : ''}
            </FeatureCard.Description>
          </FeatureCard>

          <Card padding="lg">
            <div style={{ fontSize: '0.625rem', fontWeight: 700, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.75rem' }}>
              Hours by team member
            </div>
            {hoursByMember.length > 0 ? (
              <BarChart
                data={hoursByMember}
                variant="pill"
                height={200}
                formatValue={(v) => `${v}h`}
                ariaLabel="Hours logged by team member"
              />
            ) : (
              <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', margin: 0 }}>
                No entries in the current view.
              </p>
            )}
          </Card>

          <Card padding="lg">
            <div style={{ fontSize: '0.625rem', fontWeight: 700, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.75rem' }}>
              Billable mix
            </div>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <DonutChart
                segments={[
                  { label: 'Billable', value: billableSplit.billable },
                  { label: 'Non-billable', value: billableSplit.nonBillable },
                ]}
                size={172}
                centreLabel="Billable"
                centreValue={`${summaryHero.billablePct}%`}
                ariaLabel="Billable versus non-billable hours"
              />
            </div>
          </Card>
        </div>
      )}

      {/* View tabs */}
      <div role="tablist" aria-label="Time view" style={{ display: 'flex', gap: '0.25rem' }}>
        {VIEW_TABS.map(tab => {
          const isActive = viewTab === tab.value
          return (
            <button
              key={tab.value}
              role="tab"
              aria-selected={isActive}
              onClick={() => setViewTab(tab.value)}
              style={{
                padding: '0.4375rem 0.875rem',
                fontSize: '0.8125rem',
                fontWeight: isActive ? 600 : 500,
                color: isActive ? '#ffffff' : 'var(--color-text-muted)',
                background: isActive ? 'var(--color-brand)' : 'var(--color-bg)',
                border: `1px solid ${isActive ? 'var(--color-brand)' : 'var(--color-border)'}`,
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                transition: 'background-color 150ms ease, color 150ms ease, border-color 150ms ease',
              }}
              onMouseEnter={e => {
                if (isActive) return
                e.currentTarget.style.background = 'var(--color-bg-secondary)'
                e.currentTarget.style.color = 'var(--color-text)'
              }}
              onMouseLeave={e => {
                if (isActive) return
                e.currentTarget.style.background = 'var(--color-bg)'
                e.currentTarget.style.color = 'var(--color-text-muted)'
              }}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Filter row: search + chips + date range */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
        <FilterBar
          filters={filterDefs}
          active={activeFilters}
          onChange={setActiveFilters}
          search={{
            value: search,
            onChange: setSearch,
            placeholder: 'Search client, member, request or notes',
          }}
          size="sm"
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <DateRangePicker value={dateRange} onChange={setDateRange} label="Entry date" />
        </div>
      </div>

      {/* Body */}
      {viewTab === 'by_client' ? (
        <ByClientView
          entries={filteredEntries}
          loading={loading}
          error={error}
          onRetry={() => void mutate()}
        />
      ) : (
        <Card padding="none">
          {error ? (
            <div style={{ padding: '2.5rem 1.5rem', textAlign: 'center' }}>
              <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', marginBottom: '0.75rem' }}>
                Failed to load time entries.
              </p>
              <TahiButton variant="secondary" size="sm" onClick={() => void mutate()} iconLeft={<RefreshCw className="w-3.5 h-3.5" />}>
                Retry
              </TahiButton>
            </div>
          ) : (
            <DataTable<TimeEntry>
              ariaLabel="Time entries"
              columns={columns}
              rows={filteredEntries}
              getRowId={r => r.id}
              defaultSort={{ key: 'date', dir: 'desc' }}
              loading={loading}
              empty={
                <EmptyState
                  icon={<Clock className="w-6 h-6" />}
                  title={entries.length === 0 ? 'No time entries yet' : 'No matches'}
                  description={entries.length === 0
                    ? 'Log your first time entry to start tracking hours.'
                    : 'Try clearing a filter, search term, or date range.'}
                  action={
                    entries.length === 0 ? (
                      <TahiButton size="sm" onClick={() => setShowModal(true)} iconLeft={<Plus className="w-3.5 h-3.5" />}>
                        Log time
                      </TahiButton>
                    ) : undefined
                  }
                />
              }
              rowActions={(r) => [
                ...(r.requestId
                  ? [{
                      label: 'Open request',
                      icon: <Search size={14} />,
                      onClick: () => { window.location.href = `/requests/${r.requestId}` },
                    }]
                  : []),
                {
                  label: 'Delete',
                  icon: <Trash2 size={14} />,
                  tone: 'danger' as const,
                  onClick: () => setDeleteTarget(r.id),
                },
              ]}
            />
          )}
        </Card>
      )}

      {/* Log Time SlideOver */}
      <LogTimeSlideOver
        open={showModal}
        onClose={() => setShowModal(false)}
        onCreated={handleCreated}
      />

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete time entry"
        description="This time entry will be permanently removed. This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Mobile bottom nav spacer */}
      <div className="h-28 md:hidden" aria-hidden="true" />
    </div>
  )
}
