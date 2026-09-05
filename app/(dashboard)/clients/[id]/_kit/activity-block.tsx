'use client'

/**
 * <ActivityBlock>. One place on Overview for both halves of this client's
 * history, behind a two-way switch.
 *
 * Logged  = the CRM activities a human wrote down (calls, meetings, emails,
 *           notes), from /api/admin/activities.
 * System  = what the product recorded on its own, from the audit log.
 *
 * The audit half used to be its own tab pointed at /api/admin/audit-log, a
 * route that does not exist, so it rendered its empty state forever. It reads
 * the real route now: /api/admin/audit filtered to this organisation.
 *
 * The block shows the most recent six; View all opens the full history in a
 * slide-over so the page does not grow a fourteenth scroll region.
 */

import { useState } from 'react'
import useSWR from 'swr'
import { Activity as ActivityIcon, Loader2, Plus } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { ActivityItem, ActivityTimeline, type ActivityType } from '@/components/tahi/activity-timeline'
import { Badge } from '@/components/tahi/badge'
import { EmptyState } from '@/components/tahi/empty-state'
import { SegmentedControl } from '@/components/tahi/segmented-control'
import { SlideOver } from '@/components/tahi/slide-over'
import { TahiButton } from '@/components/tahi/tahi-button'
import { Block, InlineAction } from './chrome'

export interface CrmActivityRow {
  id: string
  type: string
  title: string
  description: string | null
  scheduledAt: string | null
  completedAt: string | null
  durationMinutes: number | null
  outcome: string | null
  createdAt: string
  createdByName: string | null
}

export interface AuditEntry {
  id: string
  action: string
  entityType: string | null
  entityId: string | null
  actorName?: string | null
  metadata: string | null
  createdAt: string
}

type Half = 'logged' | 'system'

const HALF_OPTIONS = [
  { value: 'logged' as const, label: 'Logged' },
  { value: 'system' as const, label: 'System' },
]

const ACTIVITY_TYPES = ['note', 'call', 'meeting', 'email', 'task'] as const

function shortDate(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })
}

/** Turn `client.health.updated` into `Client health updated`. */
function humaniseAction(action: string): string {
  const words = action.replace(/[._-]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export const CLIENT_ACTIVITIES_KEY = (clientId: string) => `/api/admin/activities?orgId=${clientId}`
export const CLIENT_AUDIT_KEY = (clientId: string) =>
  `/api/admin/audit?entityType=organisation&entityId=${clientId}&resolveNames=1`

export function ActivityBlock({
  clientId,
  orgName,
  writeDisabled,
}: {
  clientId: string
  orgName: string
  writeDisabled: boolean
}) {
  const [half, setHalf] = useState<Half>('logged')
  const [showAll, setShowAll] = useState(false)
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ type: 'note', title: '', description: '' })

  const { data: logged, isLoading: loggedLoading, mutate: reloadLogged } =
    useSWR<{ items: CrmActivityRow[] }>(CLIENT_ACTIVITIES_KEY(clientId))
  const { data: system, isLoading: systemLoading } =
    useSWR<{ items: AuditEntry[] }>(CLIENT_AUDIT_KEY(clientId))

  const loggedItems = logged?.items ?? []
  const systemItems = system?.items ?? []
  const items = half === 'logged' ? loggedItems : systemItems
  const loading = half === 'logged' ? loggedLoading : systemLoading

  async function submit() {
    if (!form.title.trim()) return
    setSaving(true)
    try {
      const res = await fetch(apiPath('/api/admin/activities'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: form.type,
          title: form.title.trim(),
          description: form.description.trim() || undefined,
          orgId: clientId,
        }),
      })
      if (!res.ok) return
      setForm({ type: 'note', title: '', description: '' })
      setAdding(false)
      await reloadLogged()
    } finally {
      setSaving(false)
    }
  }

  function renderTimeline(rows: (CrmActivityRow | AuditEntry)[]) {
    if (loading) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }} aria-hidden="true">
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className="animate-pulse"
              style={{ height: '2.5rem', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-secondary)' }}
            />
          ))}
        </div>
      )
    }
    if (rows.length === 0) {
      return (
        <EmptyState
          variant="inline"
          icon={<ActivityIcon className="w-8 h-8" />}
          title={half === 'logged' ? 'Nothing logged yet' : 'No recorded changes yet'}
          description={half === 'logged'
            ? `Log the calls, emails and notes that do not live anywhere else, so the next person picking up ${orgName} can see them.`
            : 'Edits to this client will show up here as they happen.'}
          ctaLabel={half === 'logged' && !writeDisabled ? 'Log an activity' : undefined}
          onCtaClick={half === 'logged' && !writeDisabled ? () => setAdding(true) : undefined}
        />
      )
    }
    return (
      <ActivityTimeline>
        {rows.map(row => (
          'action' in row ? (
            <ActivityItem
              key={row.id}
              type="status"
              title={humaniseAction(row.action)}
              actor={row.actorName ? `by ${row.actorName}` : undefined}
              timestamp={shortDate(row.createdAt)}
            />
          ) : (
            <ActivityItem
              key={row.id}
              type={(row.type as ActivityType) ?? 'status'}
              title={
                <span className="flex items-center" style={{ gap: '0.5rem' }}>
                  <span>{row.title}</span>
                  <Badge size="sm" tone="neutral">{row.type}</Badge>
                </span>
              }
              actor={row.createdByName ? `by ${row.createdByName}` : undefined}
              description={row.description ?? undefined}
              timestamp={shortDate(row.createdAt)}
            />
          )
        ))}
      </ActivityTimeline>
    )
  }

  return (
    <>
      <Block
        icon={<ActivityIcon className="w-3.5 h-3.5" />}
        title="Activity"
        count={items.length}
        action={<InlineAction onClick={() => setShowAll(true)}>View all</InlineAction>}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '0.25rem' }}>
          <div className="flex items-center flex-wrap" style={{ gap: '0.5rem' }}>
            <SegmentedControl
              ariaLabel="Activity source"
              value={half}
              onChange={setHalf}
              options={HALF_OPTIONS}
              size="sm"
            />
            {half === 'logged' && !writeDisabled && (
              <TahiButton
                variant="ghost"
                size="sm"
                onClick={() => setAdding(v => !v)}
                iconLeft={<Plus className="w-3.5 h-3.5" />}
              >
                Log activity
              </TahiButton>
            )}
          </div>

          {half === 'logged' && adding && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
                padding: '0.75rem',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border-subtle)',
                background: 'var(--color-bg-secondary)',
              }}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: '0.5rem' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>Type</span>
                  <select
                    value={form.type}
                    onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                    className="tahi-focus-ring min-h-[2.75rem] md:min-h-[2.25rem]"
                    style={{
                      padding: '0 0.625rem',
                      borderRadius: 'var(--radius-input)',
                      border: '1px solid var(--color-border)',
                      background: 'var(--color-bg)',
                      color: 'var(--color-text)',
                      fontSize: '0.8125rem',
                    }}
                  >
                    {ACTIVITY_TYPES.map(t => (
                      <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                    ))}
                  </select>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>Title</span>
                  <input
                    value={form.title}
                    onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    placeholder="Quarterly review call"
                    className="tahi-focus-ring min-h-[2.75rem] md:min-h-[2.25rem]"
                    style={{
                      padding: '0 0.625rem',
                      borderRadius: 'var(--radius-input)',
                      border: '1px solid var(--color-border)',
                      background: 'var(--color-bg)',
                      color: 'var(--color-text)',
                      fontSize: '0.8125rem',
                    }}
                  />
                </label>
              </div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
                  What happened (optional)
                </span>
                <textarea
                  rows={2}
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="tahi-focus-ring"
                  style={{
                    padding: '0.5rem 0.625rem',
                    borderRadius: 'var(--radius-input)',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg)',
                    color: 'var(--color-text)',
                    fontSize: '0.8125rem',
                    resize: 'vertical',
                  }}
                />
              </label>
              <div className="flex items-center justify-end" style={{ gap: '0.5rem' }}>
                <TahiButton variant="secondary" size="sm" onClick={() => setAdding(false)}>Cancel</TahiButton>
                <TahiButton variant="primary" size="sm" onClick={submit} disabled={saving || !form.title.trim()}>
                  {saving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" aria-hidden="true" /> : null}
                  Save
                </TahiButton>
              </div>
            </div>
          )}

          {renderTimeline(items.slice(0, 6))}
        </div>
      </Block>

      <SlideOver
        open={showAll}
        onClose={() => setShowAll(false)}
        title={`${half === 'logged' ? 'Logged activity' : 'System activity'} for ${orgName}`}
      >
        <SlideOver.Body>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <SegmentedControl
              ariaLabel="Activity source"
              value={half}
              onChange={setHalf}
              options={HALF_OPTIONS}
              size="sm"
            />
            {renderTimeline(items)}
          </div>
        </SlideOver.Body>
      </SlideOver>
    </>
  )
}
