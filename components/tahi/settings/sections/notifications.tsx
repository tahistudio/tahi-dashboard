'use client'

import { useEffect, useState } from 'react'
import { apiPath } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import { SectionShell, Toggle } from '@/components/tahi/settings/primitives'

interface SettingsPayload {
  settings: Record<string, string | null>
}

/**
 * Notifications settings section.
 *
 * Email + Slack toggles persist to /api/admin/settings under the keys
 * notifications.email and notifications.slack. Email is shown to everyone;
 * Slack is admin-only. Defaults mirror the existing settings surface:
 * email is on unless explicitly 'false', Slack is off unless 'true'.
 */
export function NotificationsSection({ isAdmin }: { isAdmin?: boolean } = {}) {
  // Only admins can read /api/admin/settings; non-admins skip the fetch and
  // fall back to defaults so they never sit on a spinner.
  const { data, isLoading, mutate } = useResource<SettingsPayload>(
    isAdmin ? '/api/admin/settings' : null,
  )

  const [email, setEmail] = useState(true)
  const [slack, setSlack] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    const s = data?.settings
    if (!s) return
    setEmail(s['notifications.email'] !== 'false')
    setSlack(s['notifications.slack'] === 'true')
  }, [data])

  async function save(key: string, next: boolean, revert: (v: boolean) => void) {
    setSaving(key)
    try {
      const res = await fetch(apiPath('/api/admin/settings'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: next ? 'true' : 'false' }),
      })
      if (!res.ok) {
        revert(!next)
      } else {
        void mutate()
      }
    } catch {
      revert(!next)
    } finally {
      setSaving(null)
    }
  }

  function toggleEmail() {
    const next = !email
    setEmail(next)
    void save('notifications.email', next, setEmail)
  }

  function toggleSlack() {
    const next = !slack
    setSlack(next)
    void save('notifications.slack', next, setSlack)
  }

  const loading = isAdmin ? isLoading : false

  return (
    <SectionShell title="Notifications" lede="Where the studio reaches you.">
      <div className="set-card">
        <div className="set-row">
          <div className="sr-t">
            <b>Email notifications</b>
            <small>Request updates, messages, and invoices.</small>
          </div>
          <Toggle
            on={email}
            onClick={toggleEmail}
            ariaLabel="Toggle email notifications"
          />
        </div>
        {isAdmin && (
          <div className="set-row">
            <div className="sr-t">
              <b>Slack notifications</b>
              <small>Post activity to your connected Slack.</small>
            </div>
            <Toggle
              on={slack}
              onClick={toggleSlack}
              ariaLabel="Toggle Slack notifications"
            />
          </div>
        )}
      </div>
      {loading && (
        <p className="set-lede" style={{ marginTop: 12, marginBottom: 0 }}>
          Loading your preferences...
        </p>
      )}
      {saving && (
        <p className="set-lede" style={{ marginTop: 12, marginBottom: 0 }}>
          Saving...
        </p>
      )}
    </SectionShell>
  )
}
