'use client'

/**
 * WebhooksSection - registered outbound webhook endpoints. Each endpoint has a
 * URL and a set of workspace events that should be delivered to it.
 *
 * Data is real: it reads /api/admin/webhooks (GET -> { endpoints }) and writes
 * through POST (register) and DELETE (?id=). The registration API has no PATCH,
 * so an edit is applied as register-new-then-remove-old, carrying the same
 * signing secret across so the endpoint keeps verifying deliveries.
 *
 * Note: outbound delivery does not fire yet (backend gap). This section manages
 * the endpoint records only; nothing is sent until delivery is wired up.
 *
 * Admin-only. Rendered inside the settings shell which already gates on admin.
 */

import { useState } from 'react'
import { Webhook, Plus } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import {
  SectionShell,
  EditDialog,
  RowActions,
  EmptyRow,
  Chip,
} from '@/components/tahi/settings/primitives'

interface WebhookEndpoint {
  id: string
  url: string
  secret: string
  events: string[]
  createdAt: string
}

interface EndpointsResponse {
  endpoints: WebhookEndpoint[]
}

const DEFAULT_URL = 'https://example.com/webhook'
const DEFAULT_EVENTS = ['request.created']

// Split a free-text events field ("a.b, c.d") into a clean, de-duped list.
function parseEvents(raw: string): string[] {
  const seen = new Set<string>()
  return raw
    .split(/[,\n]/)
    .map(e => e.trim())
    .filter(e => {
      if (!e || seen.has(e)) return false
      seen.add(e)
      return true
    })
}

function newSecret(): string {
  return 'whsec_' + crypto.randomUUID().replace(/-/g, '')
}

export function WebhooksSection(_props: { isAdmin?: boolean } = {}) {
  const [editId, setEditId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const { data, isLoading, mutate } = useResource<EndpointsResponse>('/api/admin/webhooks')
  const rows = data?.endpoints ?? []

  async function registerEndpoint(
    endpoint: { url: string; secret: string; events: string[] },
  ): Promise<string | null> {
    const res = await fetch(apiPath('/api/admin/webhooks'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(endpoint),
    })
    if (!res.ok) return null
    const json = (await res.json()) as { endpoint?: WebhookEndpoint }
    return json.endpoint?.id ?? null
  }

  async function removeEndpoint(id: string): Promise<void> {
    await fetch(apiPath(`/api/admin/webhooks?id=${encodeURIComponent(id)}`), {
      method: 'DELETE',
    })
  }

  async function addEndpoint() {
    if (busy) return
    setBusy(true)
    try {
      const id = await registerEndpoint({
        url: DEFAULT_URL,
        secret: newSecret(),
        events: DEFAULT_EVENTS,
      })
      await mutate()
      if (id) setEditId(id)
    } finally {
      setBusy(false)
    }
  }

  // No PATCH on the registration API: recreate with the same secret, then drop
  // the old record. Keep the old one if the recreate fails.
  async function saveEndpoint(id: string, values: Record<string, string>) {
    const existing = rows.find(r => r.id === id)
    const url = values.url?.trim()
    const events = parseEvents(values.events ?? '')
    if (!existing || !url || events.length === 0) {
      setEditId(null)
      return
    }
    try {
      const newId = await registerEndpoint({ url, secret: existing.secret, events })
      if (newId) await removeEndpoint(id)
    } finally {
      setEditId(null)
      await mutate()
    }
  }

  async function deleteEndpoint(id: string) {
    try {
      await removeEndpoint(id)
    } finally {
      await mutate()
    }
  }

  const editing = editId ? rows.find(r => r.id === editId) : null

  return (
    <SectionShell
      title="Webhooks"
      lede="Send workspace events to an external endpoint. Delivery is not live yet; endpoints registered here are stored ready for when it is."
      action={
        <button type="button" className="btn1" onClick={addEndpoint} disabled={busy}>
          <Plus size={15} />
          Add endpoint
        </button>
      }
    >
      <div className="set-card lrow-wrap">
        {isLoading ? (
          <EmptyRow text="Loading endpoints..." />
        ) : rows.length === 0 ? (
          <EmptyRow text="No endpoints yet." />
        ) : (
          rows.map((r, i) => (
            <div
              key={r.id}
              className="lrow"
              style={i ? { borderTop: '1px solid var(--border-subtle)' } : undefined}
            >
              <span className="lrow-ic leaf">
                <Webhook size={16} />
              </span>
              <div className="lrow-t">
                <b style={{ fontFamily: 'ui-monospace,monospace', fontSize: 12.5 }}>{r.url}</b>
                <small>{r.events.join(', ')}</small>
              </div>
              <div className="lrow-r">
                <Chip tone="brand">Active</Chip>
                <RowActions onEdit={() => setEditId(r.id)} onDelete={() => deleteEndpoint(r.id)} />
              </div>
            </div>
          ))
        )}
      </div>

      {editId && editing && (
        <EditDialog
          heading="Edit endpoint"
          row={{ url: editing.url, events: editing.events.join(', ') }}
          fields={[
            { key: 'url', label: 'Endpoint URL', ph: 'https://' },
            {
              key: 'events',
              label: 'Events',
              help: 'Comma-separated event names, e.g. request.created, invoice.paid',
            },
          ]}
          onSave={v => saveEndpoint(editId, v)}
          onClose={() => setEditId(null)}
        />
      )}
    </SectionShell>
  )
}
