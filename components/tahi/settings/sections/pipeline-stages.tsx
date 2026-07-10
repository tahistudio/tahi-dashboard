'use client'

/*
 * Pipeline stages settings section.
 *
 * The stages of the sales pipeline: an ordered, colour-coded list the admin
 * can add to, rename, recolour, reorder and delete. Every action persists
 * immediately:
 *   - Add stage      POST /api/admin/pipeline/stages (then opens the editor)
 *   - Edit           PUT  /api/admin/pipeline/stages (full list, edited row patched in)
 *   - Reorder (drag) PUT  /api/admin/pipeline/stages (full list with positions)
 *   - Delete         DELETE /api/admin/pipeline/stages/[id]
 *     (server refuses core stages and stages that still contain deals;
 *      the refusal message surfaces as an error toast)
 *
 * IMPORTANT: the PUT endpoint reconciles the FULL stage list - rows with an
 * id update, rows without an id are created, and stored stages missing from
 * the payload are deleted (guarded server-side: core stages and stages with
 * deals are refused before any write). Every PUT from here must therefore
 * send the complete list, never a partial one.
 *
 * The deals kanban, forecast and probability model all read this table, so
 * edits here genuinely reshape the board.
 */

import { useRef, useState } from 'react'
import { Plus, GripVertical } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import {
  SectionShell,
  EditDialog,
  RowActions,
  EmptyRow,
  Toasts,
  useToasts,
} from '@/components/tahi/settings/primitives'

const DEFAULT_COLOR = '#5A824E'

interface ApiStage {
  id: string
  name: string
  colour: string | null
  position: number
  isDefault: number
  isClosedWon: number
  isClosedLost: number
}

interface StagesResponse {
  stages: ApiStage[]
}

// The shell passes isAdmin, but this section is registered admin-only so the
// prop is not needed here (the stages API itself enforces admin auth).
export function PipelineStagesSection() {
  const { data, isLoading, mutate } = useResource<StagesResponse>('/api/admin/pipeline/stages')
  const { toasts, toast } = useToasts()

  // Local reorder preview while a drag is in flight; null = mirror the server.
  const [order, setOrder] = useState<ApiStage[] | null>(null)
  const [newId, setNewId] = useState<string | null>(null)
  const [ed, setEd] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const dragFrom = useRef<number | null>(null)

  const serverStages = data?.stages ?? []
  const stages = order ?? serverStages
  const editing = ed ? stages.find((s) => s.id === ed) : undefined

  async function addStage() {
    if (adding) return
    setAdding(true)
    try {
      const res = await fetch(apiPath('/api/admin/pipeline/stages'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New stage', colour: DEFAULT_COLOR }),
      })
      if (!res.ok) throw new Error('create failed')
      const json = (await res.json()) as { stage?: ApiStage }
      await mutate()
      if (json.stage) {
        setNewId(json.stage.id)
        setEd(json.stage.id)
      }
    } catch {
      toast('Could not add the stage. Try again.', 'err')
    } finally {
      setAdding(false)
    }
  }

  async function saveStage(id: string, v: Record<string, string>) {
    setEd(null)
    try {
      // Reconciling PUT: always send the complete list so editing one row can
      // never drop the others. The edited row carries the new name/colour;
      // every row carries its position so the current order round-trips.
      const payload = stages.map((s, i) =>
        s.id === id
          ? { id: s.id, name: v.name.trim() || 'Untitled stage', colour: v.color || DEFAULT_COLOR, position: i }
          : { id: s.id, position: i },
      )
      const res = await fetch(apiPath('/api/admin/pipeline/stages'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stages: payload }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null
        toast(j?.error ?? 'Could not save the stage. Try again.', 'err')
        return
      }
      await mutate()
    } catch {
      toast('Could not save the stage. Try again.', 'err')
    }
  }

  async function deleteStage(id: string) {
    try {
      const res = await fetch(apiPath(`/api/admin/pipeline/stages/${id}`), { method: 'DELETE' })
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null
        toast(j?.error ?? 'Could not delete the stage.', 'err')
        return
      }
      await mutate()
    } catch {
      toast('Could not delete the stage.', 'err')
    }
  }

  function handleDragStart(i: number) {
    dragFrom.current = i
    setOrder(serverStages.slice())
  }

  function handleDragEnter(i: number) {
    const from = dragFrom.current
    if (from == null || from === i) return
    setOrder((prev) => {
      const rows = (prev ?? serverStages).slice()
      const [moved] = rows.splice(from, 1)
      rows.splice(i, 0, moved)
      return rows
    })
    dragFrom.current = i
  }

  async function handleDragEnd() {
    dragFrom.current = null
    const next = order
    if (!next) return
    const changed = next.some((s, i) => s.id !== serverStages[i]?.id)
    if (!changed) {
      setOrder(null)
      return
    }
    try {
      // Full list required by the reconciling PUT - `next` always holds every
      // stage, so no row can be interpreted as deleted.
      const res = await fetch(apiPath('/api/admin/pipeline/stages'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stages: next.map((s, i) => ({ id: s.id, position: i })) }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null
        toast(j?.error ?? 'Could not save the new order.', 'err')
      }
    } catch {
      toast('Could not save the new order.', 'err')
    }
    await mutate()
    setOrder(null)
  }

  if (isLoading && !data) {
    return (
      <SectionShell
        title="Pipeline stages"
        lede="The stages of your sales pipeline."
        action={
          <button type="button" className="btn1" disabled>
            <Plus size={15} />
            Add stage
          </button>
        }
      >
        <div className="set-card lrow-wrap animate-pulse">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="lrow"
              style={i ? { borderTop: '1px solid var(--border-subtle)' } : undefined}
            >
              <span style={{ width: 16, height: 16, borderRadius: 4, background: 'var(--color-bg-tertiary)', flexShrink: 0 }} />
              <span style={{ width: 12, height: 12, borderRadius: 4, background: 'var(--color-bg-tertiary)', flexShrink: 0 }} />
              <div style={{ height: 14, width: 120, borderRadius: 6, background: 'var(--color-bg-tertiary)' }} />
            </div>
          ))}
        </div>
      </SectionShell>
    )
  }

  return (
    <SectionShell
      title="Pipeline stages"
      lede="The stages of your sales pipeline."
      action={
        <button type="button" className="btn1" onClick={() => void addStage()} disabled={adding}>
          <Plus size={15} />
          Add stage
        </button>
      }
    >
      <div className="set-card lrow-wrap">
        {stages.map((s, i) => (
          <div
            key={s.id}
            className={'lrow' + (s.id === newId ? ' lrow-enter' : '')}
            style={i ? { borderTop: '1px solid var(--border-subtle)' } : undefined}
            draggable
            onDragStart={() => handleDragStart(i)}
            onDragEnter={() => handleDragEnter(i)}
            onDragOver={(e) => e.preventDefault()}
            onDragEnd={() => void handleDragEnd()}
          >
            <span className="lrow-drag" aria-hidden="true">
              <GripVertical size={16} />
            </span>
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 4,
                background: s.colour ?? DEFAULT_COLOR,
                flexShrink: 0,
              }}
            />
            <div className="lrow-t">
              <b>{s.name}</b>
            </div>
            <div className="lrow-r">
              <RowActions onEdit={() => setEd(s.id)} onDelete={() => void deleteStage(s.id)} />
            </div>
          </div>
        ))}
        {!stages.length && <EmptyRow text="No stages yet." />}
      </div>

      {ed && editing && (
        <EditDialog
          heading="Edit stage"
          row={{ name: editing.name, color: editing.colour ?? DEFAULT_COLOR }}
          fields={[
            { key: 'name', label: 'Stage name' },
            { key: 'color', label: 'Colour', type: 'color' },
          ]}
          onSave={(v) => void saveStage(ed, v)}
          onClose={() => setEd(null)}
        />
      )}
      <Toasts toasts={toasts} />
    </SectionShell>
  )
}
