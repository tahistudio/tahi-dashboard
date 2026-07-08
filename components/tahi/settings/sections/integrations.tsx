'use client'

import { Plug } from 'lucide-react'
import { useResource } from '@/lib/use-resource'
import { SectionShell } from '@/components/tahi/settings/primitives'

/**
 * Integrations settings section.
 *
 * A card grid of the workspace's connected apps. Connect state is read from
 * /api/admin/integrations/status, which reports whether each service has its
 * credentials configured (stripe, xero, slack, mailerlite). HubSpot ships
 * built-in, so it always reads as available. Real connect flows live on their
 * own routes (Google, Buffer, Xero); the others surface status only, matching
 * the design. Admin-only surface.
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

type StatusKey = keyof StatusPayload

interface IntegrationRow {
  name: string
  // The key into the status payload; null means the state is fixed (built-in).
  key: StatusKey | null
  builtIn?: boolean
}

const INTEGRATIONS: IntegrationRow[] = [
  { name: 'Stripe', key: 'stripe' },
  { name: 'Xero', key: 'xero' },
  { name: 'Google Workspace', key: null },
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

  const loading = shouldFetch ? isLoading : false

  function stateFor(row: IntegrationRow): { label: string; connected: boolean } {
    if (row.builtIn) return { label: 'Built-in', connected: true }
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
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card-grid2">
          {INTEGRATIONS.map((row) => {
            const { label, connected } = stateFor(row)
            const chipLabel = row.builtIn ? 'Built-in' : connected ? 'Connected' : 'Connect'
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
                  <span className={'chip ' + (connected ? 'brand' : 'outline')}>{chipLabel}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </SectionShell>
  )
}
