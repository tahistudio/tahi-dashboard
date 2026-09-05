'use client'

/** The client Activities tab: logged calls, meetings, emails and notes. */

import { useState } from 'react'
import useSWR from 'swr'
import { CalendarDays, Loader2, Plus } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { ActivityItem, ActivityTimeline, type ActivityType } from '@/components/tahi/activity-timeline'
import { Badge } from '@/components/tahi/badge'
import { Card } from '@/components/tahi/card'
import { EmptyState } from '@/components/tahi/empty-state'
import { SkeletonList } from '@/components/tahi/skeletons'
import { TahiButton } from '@/components/tahi/tahi-button'

// ── CRM Activities tab ────────────────────────────────────────────────────────

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

// Activity types + palette now live in the shared <ActivityTimeline> component
// (components/tahi/activity-timeline.tsx, ACTIVITY_TYPE_META).

export function CrmActivitiesTab({ clientId }: { clientId: string }) {
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ type: 'note', title: '', description: '' })

  const { data, isLoading: loading, mutate: fetchActivities } = useSWR<{ items: CrmActivityRow[] }>(
    `/api/admin/activities?orgId=${clientId}`,
  )
  const items = data?.items ?? []

  const handleSubmit = async () => {
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
      if (!res.ok) throw new Error('Failed')
      setForm({ type: 'note', title: '', description: '' })
      setShowForm(false)
      fetchActivities()
    } catch {
      // silent
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <SkeletonList rows={4} />
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-[var(--color-text)]">
          CRM Activities ({items.length})
        </h2>
        <TahiButton variant="primary" size="sm" onClick={() => setShowForm(!showForm)}>
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          Log Activity
        </TahiButton>
      </div>

      {/* Quick-add form */}
      {showForm && (
        <Card className="mb-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Type</label>
              <select
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm bg-[var(--color-bg)] text-[var(--color-text)]"
              >
                <option value="note">Note</option>
                <option value="call">Call</option>
                <option value="meeting">Meeting</option>
                <option value="email">Email</option>
                <option value="task">Task</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Title</label>
              <input
                type="text"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Activity title"
                className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm bg-[var(--color-bg)] text-[var(--color-text)]"
              />
            </div>
          </div>
          <div className="mb-3">
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Description (optional)</label>
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={2}
              placeholder="Add notes..."
              className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm bg-[var(--color-bg)] text-[var(--color-text)] resize-none"
            />
          </div>
          <div className="flex items-center gap-2 justify-end">
            <TahiButton variant="secondary" size="sm" onClick={() => setShowForm(false)}>
              Cancel
            </TahiButton>
            <TahiButton variant="primary" size="sm" onClick={handleSubmit} disabled={saving || !form.title.trim()}>
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
              Save
            </TahiButton>
          </div>
        </Card>
      )}

      {items.length === 0 ? (
        <EmptyState
          variant="inline"
          icon={<CalendarDays className="w-8 h-8" />}
          title="No CRM activities for this client yet"
        />
      ) : (
        <Card>
          <ActivityTimeline>
            {items.map(item => (
              <ActivityItem
                key={item.id}
                type={(item.type as ActivityType) ?? 'status'}
                title={
                  <span className="flex items-center gap-2">
                    <span>{item.title}</span>
                    <Badge size="sm" tone="neutral">{item.type}</Badge>
                  </span>
                }
                actor={item.createdByName ? `by ${item.createdByName}` : undefined}
                description={item.description ?? undefined}
                timestamp={new Date(item.createdAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}
              />
            ))}
          </ActivityTimeline>
        </Card>
      )}
    </div>
  )
}
