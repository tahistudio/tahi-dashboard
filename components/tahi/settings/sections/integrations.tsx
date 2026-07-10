'use client'

import { Plug } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import { SectionShell } from '@/components/tahi/settings/primitives'

/**
 * Integrations settings section.
 *
 * A card grid of the workspace's connected apps. Connect state is read from
 * /api/admin/integrations/status (env-var truth for Stripe, Slack, MailerLite,
 * Xero) plus /api/admin/integrations/google/status (OAuth truth for Google
 * Workspace from the integrations table). HubSpot ships built-in, so it always
 * reads as available. The Connect chip is a live link for the services with a
 * real connect flow (Xero OAuth, Google OAuth); the env-key services surface
 * status only, matching the design. Admin-only surface.
 */

interface ServiceStatus {
  configured?: boolean
  webhookConfigured?: boolean
}

interface StatusPayload {
  stripe?: ServiceStatus
  resend?: ServiceStatus
  xero?: ServiceStatus
  slack?: ServiceStatus
  mailerlite?: ServiceStatus
}

interface GoogleStatusPayload {
  connected?: boolean
  configured?: boolean
}

type StatusKey = keyof StatusPayload

interface IntegrationRow {
  name: string
  // The key into the status payload; null means the state comes from elsewhere
  // (Google OAuth status) or is fixed (built-in).
  key: StatusKey | null
  builtIn?: boolean
  google?: boolean
  // Real connect flow to start when the service is not connected.
  connectUrl?: string
}

const INTEGRATIONS: IntegrationRow[] = [
  { name: 'Stripe', key: 'stripe' },
  { name: 'Xero', key: 'xero', connectUrl: '/api/admin/integrations/xero/connect' },
  { name: 'Google Workspace', key: null, google: true, connectUrl: '/api/admin/integrations/google/start' },
  { name: 'Slack', key: 'slack' },
  { name: 'HubSpot', key: null, builtIn: true },
  { name: 'MailerLite', key: 'mailerlite' },
]

export function IntegrationsSection({ isAdmin }: { isAdmin?: boolean } = {}) {
  // Admin-only surface: non-admins skip the fetch and never sit on a spinner.
  const shouldFetch = isAdmin !== false
  const { data, isLoading } = useResource<StatusPayload>(
    shouldFetch ? '/api/admin/integrations/status' : null,
  )
  const { data: google, isLoading: googleLoading } = useResource<GoogleStatusPayload>(
    shouldFetch ? '/api/admin/integrations/google/status' : null,
  )

  const loading = shouldFetch ? isLoading || googleLoading : false

  function stateFor(row: IntegrationRow): { label: string; connected: boolean } {
    if (row.builtIn) return { label: 'Built-in', connected: true }
    if (row.google) {
      const connected = google?.connected === true
      return { label: connected ? 'Connected' : 'Not connected', connected }
    }
    const connected = row.key ? data?.[row.key]?.configured === true : false
    return { label: connected ? 'Connected' : 'Not connected', connected }
  }

  return (
    <SectionShell title="Integrations" lede="Connected apps that move money and data.">
      {loading ? (
        <div className="card-grid2">
          {INTEGRATIONS.map((row) => (
            <div key={row.name} className="set-card">
              <div className="set-row">
                <span className="lrow-ic leaf">
                  <Plug size={18} />
                </span>
                <div className="sr-t">
                  <b>{row.name}</b>
                  <small>Checking status...</small>
                </div>
                <span
                  className="animate-pulse"
                  style={{ display: 'block', height: 20, width: 74, borderRadius: 999, background: 'var(--border-subtle)', flexShrink: 0 }}
                  aria-hidden="true"
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card-grid2">
          {INTEGRATIONS.map((row) => {
            const { label, connected } = stateFor(row)
            const chipLabel = row.builtIn ? 'Built-in' : connected ? 'Connected' : 'Connect'
            const chipClass = 'chip ' + (connected ? 'brand' : 'outline')
            return (
              <div key={row.name} className="set-card">
                <div className="set-row">
                  <span className="lrow-ic leaf">
                    <Plug size={18} />
                  </span>
                  <div className="sr-t">
                    <b>{row.name}</b>
                    <small>{label}</small>
                  </div>
                  {!connected && row.connectUrl ? (
                    <a
                      className={chipClass}
                      style={{ textDecoration: 'none' }}
                      href={apiPath(row.connectUrl)}
                      aria-label={`Connect ${row.name}`}
                    >
                      {chipLabel}
                    </a>
                  ) : (
                    <span className={chipClass}>{chipLabel}</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </SectionShell>
  )
}
