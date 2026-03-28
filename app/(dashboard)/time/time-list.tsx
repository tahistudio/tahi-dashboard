'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Plus, Clock, RefreshCw, DollarSign, Timer } from 'lucide-react'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'
import { EmptyState } from '@/components/tahi/empty-state'
import { apiPath } from '@/lib/api'

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

function LogTimeModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const [orgId, setOrgId] = useState('')
  const [teamMemberId, setTeamMemberId] = useState('')
  const [requestId, setRequestId] = useState('')
  const [hours, setHours] = useState('')
  const [notes, setNotes] = useState('')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [billable, setBillable] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!orgId.trim() || !teamMemberId.trim() || !hours || !date) {
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
          orgId: orgId.trim(),
          teamMemberId: teamMemberId.trim(),
          requestId: requestId.trim() || undefined,
          hours: parseFloat(hours),
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
      onCreated()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }, [orgId, teamMemberId, requestId, hours, notes, date, billable, onCreated])

  const inputStyle = {
    padding: '8px 12px',
    borderRadius: 8,
    fontSize: 14,
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
        position: 'fixed', inset: 0, zIndex: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.4)',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{
          background: 'white', borderRadius: 12, padding: 28,
          width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
        }}
      >
        <h2 id="log-time-title" className="text-lg font-bold" style={{ color: 'var(--color-text)', marginBottom: 20 }}>
          Log Time
        </h2>
        {error && (
          <div
            aria-live="polite"
            style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', marginBottom: 16, color: '#dc2626', fontSize: 13 }}
          >
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label htmlFor="lt-org-id" style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>Client ID</label>
            <input id="lt-org-id" type="text" placeholder="Organisation ID" value={orgId} onChange={e => setOrgId(e.target.value)} required style={inputStyle} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label htmlFor="lt-member-id" style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>Team Member ID</label>
            <input id="lt-member-id" type="text" placeholder="Team member ID" value={teamMemberId} onChange={e => setTeamMemberId(e.target.value)} required style={inputStyle} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label htmlFor="lt-request-id" style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>Request ID (optional)</label>
            <input id="lt-request-id" type="text" placeholder="Link to a request" value={requestId} onChange={e => setRequestId(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
              <label htmlFor="lt-hours" style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>Hours</label>
              <input id="lt-hours" type="number" min="0.1" step="0.1" placeholder="0.0" value={hours} onChange={e => setHours(e.target.value)} required style={inputStyle} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
              <label htmlFor="lt-date" style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>Date</label>
              <input id="lt-date" type="date" value={date} onChange={e => setDate(e.target.value)} required style={inputStyle} />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              id="lt-billable"
              type="checkbox"
              checked={billable}
              onChange={e => setBillable(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: '#5A824E' }}
            />
            <label htmlFor="lt-billable" style={{ fontSize: 14, color: 'var(--color-text)' }}>Billable</label>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label htmlFor="lt-notes" style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>Notes</label>
            <textarea id="lt-notes" rows={3} placeholder="What did you work on?" value={notes} onChange={e => setNotes(e.target.value)} style={{ ...inputStyle, resize: 'vertical' as const }} />
          </div>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 4 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '8px 16px', borderRadius: 8, fontSize: 14, fontWeight: 500,
                border: '1px solid var(--color-border)', background: 'white',
                color: 'var(--color-text)', cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                padding: '8px 20px', borderRadius: 8, fontSize: 14, fontWeight: 600,
                border: 'none', background: saving ? '#9ca3af' : '#5A824E',
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
        background: 'white',
        border: '1px solid var(--color-border)',
        borderRadius: 12,
        padding: '20px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        flex: '1 1 200px',
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: '0 10px 0 10px',
          background: 'linear-gradient(135deg, #5A824E, #425F39)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 2 }}>{label}</p>
        <p style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text)' }}>{value}</p>
      </div>
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
  const [totalHours, setTotalHours] = useState(0)
  const [billableHours, setBillableHours] = useState(0)
  const [entryCount, setEntryCount] = useState(0)

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

  useEffect(() => {
    fetchEntries(billableTab).catch(() => {})
  }, [billableTab, fetchEntries])

  const handleCreated = useCallback(() => {
    setShowModal(false)
    fetchEntries(billableTab).catch(() => {})
  }, [billableTab, fetchEntries])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)', margin: 0 }}>Time Tracking</h1>
          <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginTop: 4 }}>
            Log and review hours across all clients and requests.
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2"
          style={{
            padding: '10px 18px',
            background: '#5A824E',
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

      {/* Summary Cards */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
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

      {/* Filter Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--color-border)', paddingBottom: 0 }}>
        {BILLABLE_TABS.map(tab => (
          <button
            key={tab.value}
            onClick={() => setBillableTab(tab.value)}
            style={{
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: billableTab === tab.value ? 600 : 400,
              color: billableTab === tab.value ? '#5A824E' : 'var(--color-text-muted)',
              background: 'none',
              border: 'none',
              borderBottom: billableTab === tab.value ? '2px solid #5A824E' : '2px solid transparent',
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

      {/* Table */}
      <div
        style={{
          background: 'white',
          borderRadius: 12,
          border: '1px solid var(--color-border)',
          overflow: 'hidden',
        }}
      >
        {loading ? (
          <LoadingSkeleton rows={5} height={56} />
        ) : error ? (
          <div
            style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--color-text-muted)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}
          >
            <p className="text-sm">Failed to load time entries.</p>
            <button
              onClick={() => fetchEntries(billableTab).catch(() => {})}
              className="flex items-center gap-2 text-sm font-medium hover:opacity-80 transition-opacity"
              style={{ color: '#5A824E', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              <RefreshCw style={{ width: 14, height: 14 }} aria-hidden="true" />
              Retry
            </button>
          </div>
        ) : entries.length === 0 ? (
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
                  {['Date', 'Team Member', 'Client', 'Request', 'Hours', 'Billable', 'Notes'].map(h => (
                    <th
                      key={h}
                      style={{
                        padding: '12px 16px', textAlign: 'left', fontSize: 12,
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
                {entries.map((entry, i) => (
                  <tr
                    key={entry.id}
                    style={{
                      borderBottom: i < entries.length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLTableRowElement).style.background = 'var(--color-bg-secondary)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background = '' }}
                  >
                    <td style={{ padding: '14px 16px', fontSize: 13, color: 'var(--color-text-muted)' }}>
                      {formatDate(entry.date)}
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 14, fontWeight: 500, color: 'var(--color-text)' }}>
                      {entry.teamMemberName ?? 'Unknown'}
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 14, color: 'var(--color-text)' }}>
                      {entry.orgName ?? 'Unknown'}
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 13, color: 'var(--color-text-muted)' }}>
                      {entry.requestId && entry.requestTitle ? (
                        <Link href={`/requests/${entry.requestId}`} style={{ color: '#5A824E', textDecoration: 'none' }}>
                          {entry.requestTitle}
                        </Link>
                      ) : (
                        '--'
                      )}
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
                      {formatHours(entry.hours)}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          padding: '2px 8px',
                          borderRadius: 99,
                          fontSize: 12,
                          fontWeight: 500,
                          background: entry.billable ? '#f0fdf4' : '#f3f4f6',
                          color: entry.billable ? '#16a34a' : '#6b7280',
                        }}
                      >
                        {entry.billable ? 'Billable' : 'Non-billable'}
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 13, color: 'var(--color-text-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {entry.notes ?? '--'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Log Time Modal */}
      {showModal && (
        <LogTimeModal
          onClose={() => setShowModal(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  )
}
