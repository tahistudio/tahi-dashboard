'use client'

import { useEffect, useState } from 'react'
import { apiPath } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import { SectionShell, Toasts, Toggle, useToasts } from '@/components/tahi/settings/primitives'

/**
 * Notifications section (design parity: settings-app.jsx Notifications).
 *
 * Per-event rows with pill channel chips (.ntf-ch), backed by the real
 * notification_preferences table. Admins/team read + write their own rows via
 * /api/admin/notifications; clients via /api/portal/notifications. Each chip
 * toggles optimistically and reverts (with an error toast) if the PATCH fails.
 *
 * Quiet hours persists as a per-user row (eventType 'quiet_hours', channel
 * '*', default on). Send paths adopt it as they gain schedule awareness.
 */

type Channel = 'email' | 'in_app' | 'slack'

interface PrefRow {
  eventType: string
  channel: string
  enabled: boolean
}

interface PrefsPayload {
  preferences: PrefRow[]
}

/**
 * Fallback when a user has no stored row. Mirrors DEFAULT_ENABLED in
 * lib/notification-preferences.ts so the chips always show what the send
 * paths will actually do for an untouched preference.
 */
const DEFAULTS: Record<Channel, boolean> = { in_app: true, email: true, slack: false }

const QUIET_EVENT = 'quiet_hours'
const QUIET_KEY = QUIET_EVENT + '|*'

interface EventDef {
  event: string
  label: string
  desc: string
}

const NTF_TEAM: EventDef[] = [
  { event: 'request_created', label: 'Request assigned', desc: 'A request lands in your queue' },
  { event: 'request_status_changed', label: 'Request status changed', desc: 'Something you’re on moves stage' },
  { event: 'new_message', label: 'New message', desc: 'A client or teammate messages you' },
  { event: 'mention', label: 'Mentions', desc: 'Someone @tags you in a thread' },
  { event: 'invoice_paid', label: 'Invoice paid', desc: 'A client settles an invoice' },
  { event: 'invoice_overdue', label: 'Invoice overdue', desc: 'A client’s invoice passes its due date' },
  { event: 'weekly_digest', label: 'Weekly digest', desc: 'A Monday summary of the studio' },
]

const NTF_CLIENT: EventDef[] = [
  { event: 'request_status_changed', label: 'Request updates', desc: 'When your request changes status' },
  { event: 'new_message', label: 'New message', desc: 'When the studio replies to you' },
  { event: 'delivery_ready', label: 'Delivery ready', desc: 'When work is ready for your review' },
  { event: 'invoice_created', label: 'Invoice due', desc: 'When an invoice needs paying' },
  { event: 'weekly_summary', label: 'Weekly summary', desc: 'A Monday recap of your project' },
]

const TEAM_CHANNELS: { key: Channel; label: string }[] = [
  { key: 'email', label: 'Email' },
  { key: 'in_app', label: 'In-app' },
  { key: 'slack', label: 'Slack' },
]

// Slack is a shared team channel, so portal clients only pick email + in-app.
const CLIENT_CHANNELS = TEAM_CHANNELS.slice(0, 2)

function keyOf(event: string, channel: string): string {
  return event + '|' + channel
}

export function NotificationsSection({ isAdmin }: { isAdmin?: boolean } = {}) {
  const endpoint = isAdmin ? '/api/admin/notifications' : '/api/portal/notifications'
  const { data, isLoading, mutate } = useResource<PrefsPayload>(endpoint)
  const { toasts, toast } = useToasts()

  // Stored rows keyed `${eventType}|${channel}`. Absent keys fall back to
  // DEFAULTS via resolved(), so an empty store reads as "everything at default".
  const [state, setState] = useState<Record<string, boolean>>({})

  useEffect(() => {
    const rows = data?.preferences
    if (!rows) return
    const next: Record<string, boolean> = {}
    for (const r of rows) next[keyOf(r.eventType, r.channel)] = r.enabled
    setState(next)
  }, [data])

  const events = isAdmin ? NTF_TEAM : NTF_CLIENT
  const channels = isAdmin ? TEAM_CHANNELS : CLIENT_CHANNELS

  function resolved(event: string, channel: Channel): boolean {
    const k = keyOf(event, channel)
    return k in state ? state[k] : DEFAULTS[channel]
  }

  const quietOn = QUIET_KEY in state ? state[QUIET_KEY] : true

  async function patch(eventType: string, channel: string, enabled: boolean): Promise<boolean> {
    try {
      const res = await fetch(apiPath(endpoint), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: [{ eventType, channel, enabled }] }),
      })
      return res.ok
    } catch {
      return false
    }
  }

  async function toggleChip(event: string, channel: Channel) {
    const next = !resolved(event, channel)
    const prev = state
    setState({ ...state, [keyOf(event, channel)]: next })
    const ok = await patch(event, channel, next)
    if (!ok) {
      setState(prev)
      toast('Could not save that change', 'err')
    } else {
      void mutate()
    }
  }

  async function toggleQuiet() {
    const next = !quietOn
    const prev = state
    setState({ ...state, [QUIET_KEY]: next })
    const ok = await patch(QUIET_EVENT, '*', next)
    if (!ok) {
      setState(prev)
      toast('Could not save that change', 'err')
    } else {
      void mutate()
    }
  }

  const lede = 'Choose exactly what reaches you, and where. These preferences are yours alone.'

  if (isLoading && !data) {
    return (
      <SectionShell title="Notifications" lede={lede}>
        <div className="set-card ntf-card animate-pulse">
          {events.map((e, i) => (
            <div key={e.event} className="ntf-row" style={i ? { borderTop: '1px solid var(--border-subtle)' } : undefined}>
              <div className="ntf-t">
                <div style={{ height: 13, width: '34%', borderRadius: 6, background: 'var(--bg-tertiary)' }} />
                <div style={{ height: 11, width: '55%', borderRadius: 6, marginTop: 6, background: 'var(--bg-tertiary)' }} />
              </div>
              <div className="ntf-chs">
                {channels.map((c) => (
                  <div key={c.key} style={{ width: 76, height: 31, borderRadius: 999, background: 'var(--bg-tertiary)' }} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </SectionShell>
    )
  }

  return (
    <SectionShell title="Notifications" lede={lede}>
      <div className="set-card ntf-card">
        {events.map((e, i) => (
          <div key={e.event} className="ntf-row" style={i ? { borderTop: '1px solid var(--border-subtle)' } : undefined}>
            <div className="ntf-t">
              <b>{e.label}</b>
              <small>{e.desc}</small>
            </div>
            <div className="ntf-chs">
              {channels.map((c) => {
                const on = resolved(e.event, c.key)
                return (
                  <button
                    key={c.key}
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={e.label + ' via ' + c.label}
                    className={'ntf-ch' + (on ? ' on' : '')}
                    onClick={() => toggleChip(e.event, c.key)}
                  >
                    <span className="ntf-ch-dot" aria-hidden="true"></span>
                    {c.label}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="set-card" style={{ marginTop: 16 }}>
        <div className="set-row">
          <div className="sr-t">
            <b>Quiet hours</b>
            <small>Hold non-urgent notifications between 7pm and 8am. Mentions and overdue invoices still come through.</small>
          </div>
          <Toggle on={quietOn} onClick={toggleQuiet} ariaLabel="Toggle quiet hours" />
        </div>
      </div>
      <p className="set-lede" style={{ marginTop: 12, marginBottom: 0 }}>
        In-app preferences apply immediately; email and Slack preferences apply
        as each alert adopts them. Transactional emails such as receipts and
        contracts always send.
      </p>
      <Toasts toasts={toasts} />
    </SectionShell>
  )
}
