'use client'

/**
 * KanbanColumnsSection - the board columns clients and the team see on the
 * requests board. Global by default (orgId null); a client override replaces
 * the global set for that client's board.
 *
 * Data is real: GET /api/admin/kanban-columns returns { columns, inherited }
 * (inherited = a client with no override rows is showing the global set).
 * Writes go through POST (create / clone-for-client / seed defaults), PATCH
 * /[id] (edit), PATCH on the collection (bulk reorder) and DELETE /[id].
 *
 * Copy-on-write: any mutation made in Per-client mode while the client is
 * still inheriting the global set first clones the global columns for that
 * client, then applies the change to the clone - the global board is never
 * mutated from a client view.
 *
 * Reorder is real HTML5 drag and drop: rows reorder live while dragging and
 * positions persist through the bulk PATCH on drop.
 *
 * Admin-only. Rendered inside the settings shell which already gates on admin.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { GripVertical, Plus } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import {
  SectionShell,
  PerClientHeader,
  EditDialog,
  RowActions,
  EmptyRow,
  Chip,
  Toasts,
  useToasts,
} from '@/components/tahi/settings/primitives'

interface KanbanColumn {
  id: string
  orgId: string | null
  label: string
  statusValue: string
  colour: string | null
  position: number
  isDefault: number
}

interface ColumnsResponse {
  columns: KanbanColumn[]
  inherited?: boolean
}

interface ClientsResponse {
  organisations: Array<{ id: string; name: string }>
}

type Mode = 'global' | 'client'

const DEFAULT_COLOUR = '#5A824E'

export function KanbanColumnsSection(_props: { isAdmin?: boolean } = {}) {
  const [mode, setMode] = useState<Mode>('global')
  const [orgId, setOrgId] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [newId, setNewId] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [cols, setCols] = useState<KanbanColumn[]>([])
  const newTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { toasts, toast } = useToasts()

  useEffect(() => () => {
    if (newTimer.current) clearTimeout(newTimer.current)
  }, [])

  const { data: clientsData } = useResource<ClientsResponse>(
    mode === 'client' ? '/api/admin/clients' : null,
  )
  const clients = useMemo(() => clientsData?.organisations ?? [], [clientsData])
  const clientName = clients.find(c => c.id === orgId)?.name ?? ''

  // Default the client selection to the first org once the list loads.
  useEffect(() => {
    if (mode === 'client' && !orgId && clients.length > 0) {
      setOrgId(clients[0].id)
    }
  }, [mode, orgId, clients])

  const listUrl =
    mode === 'global'
      ? '/api/admin/kanban-columns'
      : orgId
        ? `/api/admin/kanban-columns?orgId=${orgId}`
        : null

  const { data, isLoading, mutate } = useResource<ColumnsResponse>(listUrl)
  const inherited = mode === 'client' && data?.inherited === true
  const waiting = isLoading || (mode === 'client' && !clientsData)

  // Local copy of the fetched order so drag can reorder live before persisting.
  useEffect(() => {
    setCols(data?.columns ?? [])
  }, [data])

  function markNew(id: string) {
    setNewId(id)
    if (newTimer.current) clearTimeout(newTimer.current)
    newTimer.current = setTimeout(() => setNewId(null), 1400)
  }

  // Copy-on-write: clone the global set for this client, returning a
  // statusValue -> cloned-row-id map so a pending change can be re-targeted.
  async function cloneForClient(): Promise<Map<string, string>> {
    const res = await fetch(apiPath('/api/admin/kanban-columns'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cloneFromGlobal: true, orgId }),
    })
    if (!res.ok) throw new Error('Failed to customise for this client')
    const json = (await res.json()) as { columns: KanbanColumn[] }
    return new Map(json.columns.map(c => [c.statusValue, c.id]))
  }

  async function createColumn() {
    if (busy) return
    if (mode === 'client' && !orgId) return
    setBusy(true)
    try {
      if (mode === 'client' && inherited) await cloneForClient()
      const res = await fetch(apiPath('/api/admin/kanban-columns'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: mode === 'client' ? orgId : null,
          label: 'New column',
          colour: DEFAULT_COLOUR,
          position: cols.length,
        }),
      })
      if (!res.ok) throw new Error('Failed to create column')
      const json = (await res.json()) as { id: string }
      markNew(json.id)
      await mutate()
      setEditId(json.id)
    } catch {
      toast('Could not add the column', 'err')
      await mutate()
    } finally {
      setBusy(false)
    }
  }

  async function seedDefaults() {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(apiPath('/api/admin/kanban-columns'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seedDefaults: true }),
      })
      if (!res.ok) throw new Error('Failed to seed columns')
      await mutate()
    } catch {
      toast('Could not install the default board', 'err')
    } finally {
      setBusy(false)
    }
  }

  async function saveColumn(id: string, values: Record<string, string>) {
    const label = values.name?.trim() || 'Untitled column'
    const src = cols.find(c => c.id === id)
    setEditId(null)
    try {
      let targetId = id
      if (mode === 'client' && inherited) {
        const map = await cloneForClient()
        const cloneId = src ? map.get(src.statusValue) : undefined
        if (!cloneId) throw new Error('Clone mapping failed')
        targetId = cloneId
      }
      const res = await fetch(apiPath(`/api/admin/kanban-columns/${targetId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, colour: values.color || DEFAULT_COLOUR }),
      })
      if (!res.ok) throw new Error('Failed to save column')
    } catch {
      toast('Could not save the column', 'err')
    } finally {
      await mutate()
    }
  }

  async function deleteColumn(id: string) {
    const src = cols.find(c => c.id === id)
    setConfirmId(null)
    try {
      let targetId = id
      if (mode === 'client' && inherited) {
        const map = await cloneForClient()
        const cloneId = src ? map.get(src.statusValue) : undefined
        if (!cloneId) throw new Error('Clone mapping failed')
        targetId = cloneId
      }
      const res = await fetch(apiPath(`/api/admin/kanban-columns/${targetId}`), {
        method: 'DELETE',
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null
        toast(json?.error ?? 'Could not delete the column', 'err')
      }
    } catch {
      toast('Could not delete the column', 'err')
    } finally {
      await mutate()
    }
  }

  // -- drag reorder --

  function moveTo(overId: string) {
    if (!dragId || dragId === overId) return
    setCols(prev => {
      const from = prev.findIndex(c => c.id === dragId)
      const to = prev.findIndex(c => c.id === overId)
      if (from < 0 || to < 0 || from === to) return prev
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  async function persistOrder() {
    const server = data?.columns ?? []
    const changed =
      cols.length === server.length &&
      cols.some((c, i) => c.id !== server[i]?.id)
    if (!changed) return
    try {
      let positions = cols.map((c, i) => ({ id: c.id, position: i }))
      if (mode === 'client' && inherited) {
        const map = await cloneForClient()
        positions = cols.map((c, i) => ({
          id: map.get(c.statusValue) ?? c.id,
          position: i,
        }))
      }
      const res = await fetch(apiPath('/api/admin/kanban-columns'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positions }),
      })
      if (!res.ok) throw new Error('Failed to reorder')
      await mutate()
    } catch {
      toast('Could not save the new order', 'err')
      await mutate()
    }
  }

  const editing = editId ? cols.find(c => c.id === editId) : null
  const confirming = confirmId ? cols.find(c => c.id === confirmId) ?? null : null

  return (
    <SectionShell
      title="Kanban columns"
      lede="The board columns clients and the team see. Global by default; override per client."
      action={
        <button type="button" className="btn1" onClick={createColumn} disabled={busy}>
          <Plus size={15} />
          Add column
        </button>
      }
    >
      <PerClientHeader
        mode={mode}
        setMode={v => setMode(v as Mode)}
        client={clientName}
        setClient={name => {
          const hit = clients.find(c => c.name === name)
          if (hit) setOrgId(hit.id)
        }}
        clients={clients.map(c => c.name)}
      />

      <div className="set-card lrow-wrap">
        {waiting ? (
          <SkeletonRows />
        ) : mode === 'client' && clients.length === 0 ? (
          <EmptyRow text="No clients yet - add a client first." />
        ) : cols.length === 0 ? (
          <>
            <EmptyRow text="No columns yet." />
            {mode === 'global' && (
              <div className="lrow" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <button type="button" className="btn2 sm" onClick={seedDefaults} disabled={busy}>
                  Install the default board
                </button>
              </div>
            )}
          </>
        ) : (
          cols.map((r, i) => (
            <div
              key={r.id}
              className={'lrow' + (r.id === newId ? ' lrow-enter' : '')}
              style={{
                ...(i ? { borderTop: '1px solid var(--border-subtle)' } : null),
                ...(dragId === r.id ? { opacity: 0.45 } : null),
              }}
              draggable
              onDragStart={e => {
                setDragId(r.id)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', r.id)
              }}
              onDragOver={e => {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                moveTo(r.id)
              }}
              onDrop={e => e.preventDefault()}
              onDragEnd={() => {
                setDragId(null)
                void persistOrder()
              }}
            >
              <span className="lrow-drag" aria-hidden="true">
                <GripVertical size={16} />
              </span>
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 4,
                  background: r.colour || DEFAULT_COLOUR,
                  flexShrink: 0,
                }}
              />
              <div className="lrow-t">
                <b>{r.label}</b>
              </div>
              <div className="lrow-r">
                {mode === 'client' && (
                  <Chip tone="neutral">{inherited ? 'Global' : 'Override'}</Chip>
                )}
                <RowActions
                  onEdit={() => setEditId(r.id)}
                  onDelete={() => setConfirmId(r.id)}
                />
              </div>
            </div>
          ))
        )}
      </div>

      {editId && editing && (
        <EditDialog
          heading="Edit column"
          row={{ name: editing.label, color: editing.colour ?? DEFAULT_COLOUR }}
          fields={[
            { key: 'name', label: 'Column name' },
            { key: 'color', label: 'Colour', type: 'color' },
          ]}
          onSave={v => saveColumn(editId, v)}
          onClose={() => setEditId(null)}
        />
      )}

      {confirming && (
        <ConfirmDialog
          heading="Delete this column?"
          body={`"${confirming.label}" will be removed${mode === 'client' ? " from this client's board" : ' from the board'}. Requests already in it are not deleted, but you may need to move them.`}
          confirmLabel="Delete"
          onConfirm={() => deleteColumn(confirming.id)}
          onClose={() => setConfirmId(null)}
        />
      )}

      <Toasts toasts={toasts} />
    </SectionShell>
  )
}

// -- Loading skeleton (animate-pulse blocks in the row chrome) --

function SkeletonRows() {
  return (
    <>
      {[0, 1, 2, 3].map(i => (
        <div
          key={i}
          className="lrow"
          style={i ? { borderTop: '1px solid var(--border-subtle)' } : undefined}
          aria-hidden="true"
        >
          <span
            className="animate-pulse"
            style={{
              width: 12,
              height: 12,
              borderRadius: 4,
              background: 'var(--bg-tertiary)',
              flexShrink: 0,
            }}
          />
          <div className="lrow-t animate-pulse">
            <span
              style={{
                display: 'block',
                width: 120,
                maxWidth: '50%',
                height: 12,
                borderRadius: 6,
                background: 'var(--bg-tertiary)',
              }}
            />
          </div>
        </div>
      ))}
    </>
  )
}

// -- Delete confirmation (uses the shared .dlg chrome) --

function ConfirmDialog({
  heading,
  body,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  heading: string
  body: string
  confirmLabel: string
  onConfirm: () => void
  onClose: () => void
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="dlg-backdrop" onClick={onClose}>
      <div
        className="dlg"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={heading}
      >
        <h3>{heading}</h3>
        <p className="dlg-warn" style={{ margin: 0 }}>{body}</p>
        <div className="dlg-foot">
          <button type="button" className="btn2" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn1"
            style={{ background: 'var(--danger-fill)' }}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
