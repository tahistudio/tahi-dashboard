'use client'

import { Fragment, useEffect, useState } from 'react'
import { apiPath } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import { SectionShell, Toggle } from '@/components/tahi/settings/primitives'

type Channel = 'in_app' | 'email' | 'slack'

interface PrefRow {
  eventType: string
  channel: string
  enabled: boolean
}

interface PrefsPayload {
  preferences: PrefRow[]
}

/**
 * Per-channel default when a user has no stored row for that channel. Mirrors
 * DEFAULT_ENABLED in lib/notification-preferences.ts. In-app notifications are
 * gated by these prefs at send time today; email and Slack preferences are
 * stored and take effect on each send path as it adopts the check (so the UI
 * does not claim enforcement the backend does not yet deliver).
 */
const DEFAULTS: Record<Channel, boolean> = { in_app: true, email: true, slack: false }

const CHANNELS: { key: Channel; label: string; adminOnly?: boolean }[] = [
  { key: 'in_app', label: 'In-app' },
  { key: 'email', label: 'Email' },
  // Slack is a workspace/team channel, not surfaced to portal clients.
  { key: 'slack', label: 'Slack', adminOnly: true },
]

/**
 * Each toggle group maps to one or more concrete NotificationEventType values.
 * Toggling a group writes every event in the group for that channel, and the
 * group reads on only when all of its events are on, so the grid stays in sync
 * with the granular rows the send paths look up.
 */
const GROUPS: { key: string; label: string; desc: string; events: string[] }[] = [
  {
    key: 'requests',
    label: 'Requests',
    desc: 'Status changes and new requests.',
    events: ['request_status_changed', 'request_created'],
  },
  {
    key: 'messages',
    label: 'Messages',
    desc: 'New messages and mentions.',
    events: ['new_message'],
  },
  {
    key: 'invoices',
    label: 'Invoices',
    desc: 'New, paid, and overdue invoices.',
    events: ['invoice_created', 'invoice_paid', 'invoice_overdue'],
  },
  {
    key: 'announcements',
    label: 'Announcements',
    desc: 'Studio updates and broadcasts.',
    events: ['announcement_posted'],
  },
]

function keyOf(event: string, channel: Channel): string {
  return event + '|' + channel
}

/**
 * Notifications settings section.
 *
 * Per-event, per-channel preferences backed by the notification_preferences
 * table. Admins read/write their own team-member prefs via /api/admin/
 * notifications; clients read/write their own contact prefs via /api/portal/
 * notifications. Both endpoints are per-user, so the client tab persists (it no
 * longer PATCHes the admin-gated key/value store and silently 403s).
 */
export function NotificationsSection({ isAdmin }: { isAdmin?: boolean } = {}) {
  const endpoint = isAdmin ? '/api/admin/notifications' : '/api/portal/notifications'
  const { data, isLoading, mutate } = useResource<PrefsPayload>(endpoint)

  // Stored rows keyed `${eventType}|${channel}`. Absent keys fall back to
  // DEFAULTS via resolved(), so an empty store reads as "everything at default".
  const [state, setState] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    const rows = data?.preferences
    if (!rows) return
    const next: Record<string, boolean> = {}
    for (const r of rows) next[keyOf(r.eventType, r.channel as Channel)] = r.enabled
    setState(next)
  }, [data])

  const channels = CHANNELS.filter((c) => isAdmin || !c.adminOnly)

  function resolved(event: string, channel: Channel): boolean {
    const k = keyOf(event, channel)
    return k in state ? state[k] : DEFAULTS[channel]
  }

  function groupOn(events: string[], channel: Channel): boolean {
    return events.every((e) => resolved(e, channel))
  }

  async function toggleGroup(events: string[], channel: Channel) {
    const next = !groupOn(events, channel)
    const prev = state
    const optimistic = { ...state }
    for (const e of events) optimistic[keyOf(e, channel)] = next
    setState(optimistic)
    setError(false)
    setSaving(true)
    try {
      const res = await fetch(apiPath(endpoint), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updates: events.map((e) => ({ eventType: e, channel, enabled: next })),
        }),
      })
      if (!res.ok) {
        setState(prev)
        setError(true)
      } else {
        void mutate()
      }
    } catch {
      setState(prev)
      setError(true)
    } finally {
      setSaving(false)
    }
  }

  const cols = 'minmax(0, 1fr) repeat(' + channels.length + ', 64px)'

  return (
    <SectionShell title="Notifications" lede="Choose what reaches you, and where.">
      <div className="set-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: cols, alignItems: 'center' }}>
          {/* Column headers */}
          <div style={{ padding: '12px 16px' }} />
          {channels.map((c) => (
            <div
              key={c.key}
              style={{
                textAlign: 'center',
                font: '600 12px Manrope',
                color: 'var(--text-muted)',
                padding: '12px 4px',
              }}
            >
              {c.label}
            </div>
          ))}

          {/* One row per event group */}
          {GROUPS.map((g) => (
            <Fragment key={g.key}>
              <div style={{ padding: '14px 16px', borderTop: '1px solid var(--border-subtle)', minWidth: 0 }}>
                <b style={{ display: 'block', font: '600 14px Manrope', color: 'var(--text)' }}>{g.label}</b>
                <small style={{ display: 'block', marginTop: 2, font: '400 12.5px Manrope', color: 'var(--text-muted)' }}>{g.desc}</small>
              </div>
              {channels.map((c) => (
                <div
                  key={c.key}
                  style={{
                    display: 'flex',
                    justifyContent: 'center',
                    padding: '14px 4px',
                    borderTop: '1px solid var(--border-subtle)',
                  }}
                >
                  <Toggle
                    on={groupOn(g.events, c.key)}
                    onClick={() => toggleGroup(g.events, c.key)}
                    ariaLabel={g.label + ' ' + c.label + ' notifications'}
                  />
                </div>
              ))}
            </Fragment>
          ))}
        </div>
      </div>

      <p className="set-lede" style={{ marginTop: 12, marginBottom: 0 }}>
        In-app notifications take effect immediately. Email preferences are now
        enforced on the notification emails we send, starting with invoices; new
        request and message alerts are not emailed yet, so those email toggles
        save and will apply once those emails ship. Transactional emails such as
        contracts, receipts, and welcomes always send. Slack posts go to shared
        team channels, so they are not controlled per person.
      </p>
      {isLoading && (
        <p className="set-lede" style={{ marginTop: 12, marginBottom: 0 }}>
          Loading your preferences...
        </p>
      )}
      {saving && (
        <p className="set-lede" style={{ marginTop: 12, marginBottom: 0 }}>
          Saving...
        </p>
      )}
      {error && (
        <p
          className="set-lede"
          style={{ marginTop: 12, marginBottom: 0, color: 'var(--color-danger, #f87171)' }}
        >
          Could not save that change. Please try again.
        </p>
      )}
    </SectionShell>
  )
}
