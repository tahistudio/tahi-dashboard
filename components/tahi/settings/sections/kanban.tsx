'use client'

/**
 * KanbanColumnsSection - the board columns clients and the team see on the
 * requests board. Global by default (orgId null); a client override replaces the
 * global set for that client's board.
 *
 * Data is real: it reads /api/admin/kanban-columns (GET, optional ?orgId=) and
 * writes through POST (create), PATCH /[id] (edit) and DELETE /[id]. The colour
 * swatch and drag handle come from the settings CSS. Reorder is UI-affordance
 * only for now; position is set on create and left as-is on edit.
 *
 * Admin-only. Rendered inside the settings shell which already gates on admin.
 */

import { useEffect, useState } from 'react'
import { GripVertical, Plus } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import {
  SectionShell,
  Seg,
  EditDialog,
  RowActions,
  EmptyRow,
} from '@/components/tahi/settings/primitives'

interface KanbanColumn extends Record<string, unknown> {
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
}

interface ClientsResponse {
  organisations: Array<{ id: string; name: string }>
}

type Mode = 'global' | 'client'

const DEFAULT_COLOUR = '#5A824E'

// Slugify a label into a requests.status value: "In Review" -> "in-review".
function toStatusValue(label: string): string {
  return (
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'new-column'
  )
}

export function KanbanColumnsSection(_props: { isAdmin?: boolean } = {}) {
  const [mode, setMode] = useState<Mode>('global')
  const [orgId, setOrgId] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const { data: clientsData } = useResource<ClientsResponse>(
    mode === 'client' ? '/api/admin/clients' : null,
  )
  const clients = clientsData?.organisations ?? []

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
  const rows = data?.columns ?? []

  async function createColumn() {
    if (busy) return
    setBusy(true)
    try {
      const label = 'New column'
      const res = await fetch(apiPath('/api/admin/kanban-columns'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: mode === 'client' ? orgId : null,
          label,
          statusValue: toStatusValue(label),
          colour: DEFAULT_COLOUR,
          position: rows.length,
        }),
      })
      if (!res.ok) throw new Error('Failed to create column')
      const json = (await res.json()) as { id: string }
      await mutate()
      setEditId(json.id)
    } catch {
      await mutate()
    } finally {
      setBusy(false)
    }
  }

  async function saveColumn(id: string, values: Record<string, string>) {
    const label = values.label?.trim()
    try {
      const res = await fetch(apiPath(`/api/admin/kanban-columns/${id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label,
          statusValue: values.statusValue?.trim() || (label ? toStatusValue(label) : undefined),
          colour: values.colour || DEFAULT_COLOUR,
        }),
      })
      if (!res.ok) throw new Error('Failed to save column')
    } finally {
      setEditId(null)
      await mutate()
    }
  }

  async function deleteColumn(id: string) {
    try {
      const res = await fetch(apiPath(`/api/admin/kanban-columns/${id}`), {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to delete column')
    } finally {
      await mutate()
    }
  }

  const editing = editId ? rows.find(r => r.id === editId) : null

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
      <div className="set-card" style={{ marginBottom: 16 }}>
        <div className="set-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
          <div className="sr-t">
            <b>Applies to</b>
            <small>
              {mode === 'global'
                ? 'These columns apply to every client.'
                : 'Overrides just this client; others keep the global set.'}
            </small>
          </div>
          <div className="ctl-line">
            <Seg
              aria="Scope"
              value={mode}
              onChange={v => setMode(v as Mode)}
              opts={[
                ['global', 'All clients'],
                ['client', 'Per client'],
              ]}
            />
            {mode === 'client' && (
              <select
                className="set-input"
                style={{ maxWidth: 240 }}
                value={orgId}
                onChange={e => setOrgId(e.target.value)}
                aria-label="Client"
                disabled={clients.length === 0}
              >
                {clients.length === 0 ? (
                  <option value="">No clients yet</option>
                ) : (
                  clients.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))
                )}
              </select>
            )}
          </div>
        </div>
      </div>

      <div className="set-card lrow-wrap">
        {isLoading ? (
          <EmptyRow text="Loading columns..." />
        ) : rows.length === 0 ? (
          <EmptyRow text="No columns yet." />
        ) : (
          rows.map((r, i) => (
            <div
              key={r.id}
              className="lrow"
              style={i ? { borderTop: '1px solid var(--border-subtle)' } : undefined}
            >
              <span className="lrow-drag">
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
                <small>{r.statusValue}</small>
              </div>
              <div className="lrow-r">
                <RowActions onEdit={() => setEditId(r.id)} onDelete={() => deleteColumn(r.id)} />
              </div>
            </div>
          ))
        )}
      </div>

      {editId && editing && (
        <EditDialog
          heading="Edit column"
          row={editing}
          fields={[
            { key: 'label', label: 'Column name' },
            {
              key: 'statusValue',
              label: 'Status value',
              help: 'Maps to the request status this column shows. Lower-case, hyphenated.',
            },
            { key: 'colour', label: 'Colour', type: 'color' },
          ]}
          onSave={v => saveColumn(editId, v)}
          onClose={() => setEditId(null)}
        />
      )}
    </SectionShell>
  )
}
