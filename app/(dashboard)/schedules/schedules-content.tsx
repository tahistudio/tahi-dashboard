'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, Calendar, ExternalLink, Search } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { PageHeader } from '@/components/tahi/page-header'
import { useToast } from '@/components/tahi/toast'

interface ScheduleListItem {
  id: string
  orgId: string | null
  dealId: string | null
  title: string
  subtitle: string | null
  preparedFor: string | null
  effectiveDate: string | null
  targetLaunchDate: string | null
  numberOfWeeks: number
  status: 'draft' | 'shared' | 'archived'
  publicShareToken: string | null
  createdAt: string
  updatedAt: string
  orgName: string | null
  dealTitle: string | null
}

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  draft: { bg: 'var(--color-bg-tertiary)', fg: 'var(--color-text-muted)', label: 'Draft' },
  shared: { bg: 'var(--color-brand-50)', fg: 'var(--color-brand-dark)', label: 'Shared' },
  archived: { bg: 'var(--color-bg-secondary)', fg: 'var(--color-text-subtle)', label: 'Archived' },
}

export function SchedulesContent() {
  const router = useRouter()
  const { showToast } = useToast()
  const [items, setItems] = useState<ScheduleListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiPath('/api/admin/schedules'))
      if (!res.ok) throw new Error('Failed')
      const data = await res.json() as { items: ScheduleListItem[] }
      setItems(data.items ?? [])
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchAll() }, [fetchAll])

  const filtered = items.filter(s => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      s.title.toLowerCase().includes(q) ||
      (s.orgName ?? '').toLowerCase().includes(q) ||
      (s.dealTitle ?? '').toLowerCase().includes(q) ||
      (s.preparedFor ?? '').toLowerCase().includes(q)
    )
  })

  async function handleCreate() {
    setCreating(true)
    try {
      const res = await fetch(apiPath('/api/admin/schedules'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'New project schedule',
          subtitle: 'PROJECT SCHEDULE, GANTT',
          numberOfWeeks: 12,
        }),
      })
      const data = await res.json() as { id?: string }
      if (res.ok && data.id) {
        router.push(`/schedules/${data.id}`)
      } else {
        showToast('Failed to create schedule', 'error')
      }
    } catch {
      showToast('Failed to create schedule', 'error')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <PageHeader
        title="Schedules"
        subtitle="Project gantts and timelines you can share with clients"
      >
        <button
          onClick={handleCreate}
          disabled={creating}
          className="inline-flex items-center font-medium hover:-translate-y-px"
          style={{
            padding: 'var(--space-2) var(--space-4)',
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            background: 'var(--color-brand)',
            color: 'white',
            border: 'none',
            borderRadius: 'var(--radius-leaf-sm)',
            gap: 'var(--space-1-5)',
            transition: 'background-color 150ms ease, box-shadow 150ms ease, transform 150ms ease',
            height: '2.25rem',
            cursor: creating ? 'not-allowed' : 'pointer',
            opacity: creating ? 0.6 : 1,
          }}
          onMouseEnter={e => {
            if (!creating) {
              e.currentTarget.style.background = 'var(--color-brand-dark)'
              e.currentTarget.style.boxShadow = '0 4px 14px rgba(90,130,78,0.4)'
            }
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'var(--color-brand)'
            e.currentTarget.style.boxShadow = 'none'
          }}
        >
          <Plus size={15} aria-hidden="true" />
          {creating ? 'Creating…' : 'New schedule'}
        </button>
      </PageHeader>

      {/* Search */}
      <div className="relative" style={{ maxWidth: '24rem' }}>
        <Search
          size={14}
          style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-subtle)', pointerEvents: 'none' }}
          aria-hidden="true"
        />
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by title, client or deal…"
          style={{
            width: '100%',
            padding: '0.5rem 0.75rem 0.5rem 2.25rem',
            fontSize: '0.875rem',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-bg)',
            color: 'var(--color-text)',
          }}
        />
      </div>

      {/* List */}
      {loading ? (
        <div className="flex flex-col gap-2">
          {[1, 2, 3].map(i => (
            <div
              key={i}
              className="animate-pulse rounded-lg"
              style={{ height: '5rem', background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-subtle)' }}
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center rounded-xl"
          style={{ padding: '3rem 2rem', border: '1px dashed var(--color-border)', background: 'var(--color-bg)' }}
        >
          <div
            className="flex items-center justify-center"
            style={{ width: '3rem', height: '3rem', borderRadius: 'var(--radius-leaf)', background: 'var(--color-brand-50)', color: 'var(--color-brand)', marginBottom: '1rem' }}
          >
            <Calendar size={20} aria-hidden="true" />
          </div>
          <h3 className="font-semibold" style={{ fontSize: '1rem', color: 'var(--color-text)', marginBottom: '0.25rem' }}>
            {search.trim() ? 'No schedules match your search' : 'No schedules yet'}
          </h3>
          <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
            {search.trim() ? 'Try a different keyword' : 'Create one to map a project timeline you can share with clients.'}
          </p>
          {!search.trim() && (
            <button
              onClick={handleCreate}
              disabled={creating}
              className="inline-flex items-center font-medium"
              style={{
                padding: 'var(--space-2) var(--space-4)',
                fontSize: '0.875rem',
                fontWeight: 600,
                background: 'var(--color-brand)',
                color: 'white',
                border: 'none',
                borderRadius: 'var(--radius-leaf-sm)',
                gap: 'var(--space-1-5)',
                cursor: creating ? 'not-allowed' : 'pointer',
              }}
            >
              <Plus size={15} />
              New schedule
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col" style={{ gap: '0.5rem' }}>
          {filtered.map(s => {
            const tone = STATUS_STYLE[s.status] ?? STATUS_STYLE.draft
            return (
              <Link
                key={s.id}
                href={`/schedules/${s.id}`}
                className="block rounded-xl transition-colors"
                style={{
                  padding: '1rem 1.25rem',
                  border: '1px solid var(--color-border-subtle)',
                  background: 'var(--color-bg)',
                  textDecoration: 'none',
                  color: 'inherit',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'var(--color-border)'
                  e.currentTarget.style.background = 'var(--color-bg-secondary)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'var(--color-border-subtle)'
                  e.currentTarget.style.background = 'var(--color-bg)'
                }}
              >
                <div className="flex items-center justify-between" style={{ gap: '1rem' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="flex items-center" style={{ gap: '0.5rem', marginBottom: '0.25rem' }}>
                      <h3 className="font-semibold truncate" style={{ fontSize: '0.9375rem', color: 'var(--color-text)' }}>
                        {s.title}
                      </h3>
                      <span
                        style={{
                          padding: '0.125rem 0.5rem',
                          fontSize: '0.6875rem',
                          fontWeight: 600,
                          background: tone.bg,
                          color: tone.fg,
                          borderRadius: 'var(--radius-full)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.03em',
                          flexShrink: 0,
                        }}
                      >
                        {tone.label}
                      </span>
                    </div>
                    <div className="flex items-center" style={{ gap: '0.75rem', fontSize: '0.75rem', color: 'var(--color-text-subtle)', flexWrap: 'wrap' }}>
                      {s.orgName && <span>{s.orgName}</span>}
                      {s.dealTitle && <span>· {s.dealTitle}</span>}
                      <span>· {s.numberOfWeeks} weeks</span>
                      {s.targetLaunchDate && (
                        <span>· launches {new Date(s.targetLaunchDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                      )}
                    </div>
                  </div>
                  {s.publicShareToken && (
                    <ExternalLink size={14} style={{ color: 'var(--color-text-subtle)', flexShrink: 0 }} aria-hidden="true" />
                  )}
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
