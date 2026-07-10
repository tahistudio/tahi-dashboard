'use client'

/**
 * WebhooksSection - registered outbound webhook endpoints. Each endpoint has a
 * URL, a set of workspace events to deliver, and an active switch.
 *
 * Data is real: it reads /api/admin/webhooks (GET -> { endpoints }) and writes
 * through POST (register), PATCH (in-place edit + active toggle, preserving the
 * endpoint id, secret and delivery history) and DELETE (?id=).
 *
 * Delivery is live: lib/events.ts emitDomainEvent calls lib/webhooks.ts
 * fireWebhook from the request / invoice / client routes, so endpoints
 * registered here receive signed deliveries as events happen.
 *
 * Admin-only. Rendered inside the settings shell which already gates on admin.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Webhook, Plus } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import {
  SectionShell,
  EditDialog,
  RowActions,
  EmptyRow,
  Toggle,
} from '@/components/tahi/settings/primitives'

interface WebhookEndpoint {
  id: string
  url: string
  secret: string
  events: string[]
  active: boolean
  createdAt: string
}

interface EndpointsResponse {
  endpoints: WebhookEndpoint[]
}

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

function portalTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light'
  const scoped = document.querySelector('.ash')?.getAttribute('data-theme')
  if (scoped === 'dark' || scoped === 'light') return scoped
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

/* Small confirm dialog in the design's .dlg language, so a one-tap delete
   cannot irreversibly drop an endpoint and its signing secret. */
function ConfirmDialog({
  heading,
  body,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  heading: string
  body: ReactNode
  confirmLabel: string
  onConfirm: () => void
  onClose: () => void
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (!mounted || typeof document === 'undefined') return null
  return createPortal(
    <div className="tahi-portal" data-theme={portalTheme()}>
      <div className="dlg-backdrop" onClick={onClose}>
        <div
          className="dlg"
          onClick={e => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label={heading}
        >
          <h3>{heading}</h3>
          <p className="dlg-warn" style={{ marginTop: 0 }}>
            {body}
          </p>
          <div className="dlg-foot">
            <button type="button" className="btn2" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn1" onClick={onConfirm}>
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function SkeletonRow({ withBorder }: { withBorder: boolean }) {
  return (
    <div
      className="lrow"
      style={withBorder ? { borderTop: '1px solid var(--border-subtle)' } : undefined}
      aria-hidden="true"
    >
      <span className="lrow-ic leaf" style={{ opacity: 0.4 }}>
        <Webhook size={16} />
      </span>
      <div className="lrow-t">
        <span
          className="animate-pulse"
          style={{ display: 'block', height: 12, width: 190, borderRadius: 6, background: 'var(--border-subtle)' }}
        />
        <span
          className="animate-pulse"
          style={{ display: 'block', height: 9, width: 120, borderRadius: 6, background: 'var(--border-subtle)', marginTop: 7 }}
        />
      </div>
      <div className="lrow-r">
        <span
          className="animate-pulse"
          style={{ display: 'block', height: 20, width: 56, borderRadius: 999, background: 'var(--border-subtle)' }}
        />
      </div>
    </div>
  )
}

export function WebhooksSection(_props: { isAdmin?: boolean } = {}) {
  const [editId, setEditId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // The last endpoint created this session, so its row gets the insert animation.
  const [justAddedId, setJustAddedId] = useState<string | null>(null)

  const { data, isLoading, mutate } = useResource<EndpointsResponse>('/api/admin/webhooks')
  const rows = (data?.endpoints ?? [])
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))

  async function createEndpoint(values: Record<string, string>) {
    const url = values.url?.trim()
    const events = parseEvents(values.ev ?? '')
    // Nothing valid to save: keep the dialog open rather than silently discard.
    if (busy || !url || url === 'https://' || events.length === 0) return
    setBusy(true)
    try {
      const res = await fetch(apiPath('/api/admin/webhooks'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, secret: newSecret(), events }),
      })
      if (res.ok) {
        const json = (await res.json()) as { endpoint?: WebhookEndpoint }
        if (json.endpoint?.id) setJustAddedId(json.endpoint.id)
      }
    } finally {
      setAdding(false)
      setBusy(false)
      await mutate()
    }
  }

  async function saveEndpoint(id: string, values: Record<string, string>) {
    const url = values.url?.trim()
    const events = parseEvents(values.ev ?? '')
    // Nothing valid to save: keep the dialog open rather than silently discard.
    if (!url || events.length === 0) return
    try {
      await fetch(apiPath('/api/admin/webhooks'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, url, events }),
      })
    } finally {
      setEditId(null)
      await mutate()
    }
  }

  async function toggleEndpoint(endpoint: WebhookEndpoint) {
    // Optimistically flip, then confirm with a revalidate.
    await mutate(
      current =>
        current
          ? {
              endpoints: current.endpoints.map(e =>
                e.id === endpoint.id ? { ...e, active: !endpoint.active } : e,
              ),
            }
          : current,
      false,
    )
    try {
      await fetch(apiPath('/api/admin/webhooks'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: endpoint.id, active: !endpoint.active }),
      })
    } finally {
      await mutate()
    }
  }

  async function deleteEndpoint(id: string) {
    setDeleteId(null)
    try {
      await fetch(apiPath(`/api/admin/webhooks?id=${encodeURIComponent(id)}`), {
        method: 'DELETE',
      })
    } finally {
      await mutate()
    }
  }

  const editing = editId ? rows.find(r => r.id === editId) : null
  const deleting = deleteId ? rows.find(r => r.id === deleteId) : null

  return (
    <SectionShell
      title="Webhooks"
      lede="Send workspace events to an external endpoint."
      action={
        <button type="button" className="btn1" onClick={() => setAdding(true)} disabled={busy}>
          <Plus size={15} />
          Add endpoint
        </button>
      }
    >
      <div className="set-card lrow-wrap">
        {isLoading ? (
          [0, 1].map(i => <SkeletonRow key={i} withBorder={i > 0} />)
        ) : rows.length === 0 ? (
          <EmptyRow text="No endpoints yet." />
        ) : (
          rows.map((r, i) => (
            <div
              key={r.id}
              className={'lrow' + (r.id === justAddedId ? ' lrow-enter' : '')}
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
                <span className={'chip ' + (r.active ? 'brand' : 'outline')}>
                  {r.active ? 'Active' : 'Paused'}
                </span>
                <Toggle
                  on={r.active}
                  onClick={() => void toggleEndpoint(r)}
                  ariaLabel={r.active ? 'Pause endpoint' : 'Activate endpoint'}
                />
                <RowActions onEdit={() => setEditId(r.id)} onDelete={() => setDeleteId(r.id)} />
              </div>
            </div>
          ))
        )}
      </div>

      {adding && (
        <EditDialog
          heading="Add endpoint"
          row={{ url: 'https://', ev: 'request.created' }}
          fields={[
            { key: 'url', label: 'Endpoint URL' },
            { key: 'ev', label: 'Events' },
          ]}
          onSave={v => void createEndpoint(v)}
          onClose={() => setAdding(false)}
        />
      )}

      {editId && editing && (
        <EditDialog
          heading="Edit endpoint"
          row={{ url: editing.url, ev: editing.events.join(', ') }}
          fields={[
            { key: 'url', label: 'Endpoint URL' },
            { key: 'ev', label: 'Events' },
          ]}
          onSave={v => void saveEndpoint(editId, v)}
          onClose={() => setEditId(null)}
        />
      )}

      {deleteId && deleting && (
        <ConfirmDialog
          heading="Remove endpoint?"
          body={
            <>
              Deliveries to <b style={{ fontFamily: 'ui-monospace,monospace', fontSize: 12.5 }}>{deleting.url}</b>{' '}
              stop immediately and its signing secret is discarded. This cannot be undone.
            </>
          }
          confirmLabel="Remove"
          onConfirm={() => void deleteEndpoint(deleteId)}
          onClose={() => setDeleteId(null)}
        />
      )}
    </SectionShell>
  )
}
