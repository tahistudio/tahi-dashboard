'use client'

/*
 * Pipeline stages settings section.
 *
 * The stages of the sales pipeline: an ordered, colour-coded list the admin can
 * rename and recolour. Self-contained: reads /api/admin/pipeline/stages and
 * writes the full array back with PUT (bulk update by id). Admin-only surface.
 *
 * Backend note: the PUT endpoint updates existing stage rows by id (name,
 * colour, position). It does not create or delete rows, so locally added rows
 * are held in the UI but only persist once the backend gains create support.
 */

import { useState } from 'react'
import { Plus, GripVertical } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import {
  SectionShell,
  EditDialog,
  RowActions,
  EmptyRow,
  useManaged,
} from '@/components/tahi/settings/primitives'

const DEFAULT_COLOR = '#5A824E'

interface ApiStage {
  id: string
  name: string
  colour: string | null
  position: number
}

interface StagesResponse {
  stages: ApiStage[]
}

// The managed row shape. `id` is the backend row id (undefined for rows added
// in the UI that have not yet been persisted).
interface StageRow extends Record<string, unknown> {
  id?: string
  name: string
  color: string
}

export function PipelineStagesSection(_props: { isAdmin?: boolean } = {}) {
  const { data, isLoading, mutate } = useResource<StagesResponse>(
    '/api/admin/pipeline/stages',
  )

  if (isLoading && !data) {
    return (
      <SectionShell title="Pipeline stages" lede="The stages of your sales pipeline.">
        <div className="set-card">
          <div
            className="lrow"
            style={{ color: 'var(--text-faint)', font: '500 13px Manrope' }}
          >
            Loading stages...
          </div>
        </div>
      </SectionShell>
    )
  }

  const initial: StageRow[] = (data?.stages ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    color: s.colour ?? DEFAULT_COLOR,
  }))

  return <PipelineStagesBody initial={initial} onSaved={mutate} />
}

function PipelineStagesBody({
  initial,
  onSaved,
}: {
  initial: StageRow[]
  onSaved: () => Promise<unknown>
}) {
  const L = useManaged<StageRow>(initial)
  const [ed, setEd] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  function addStage() {
    const id = L.add({ name: 'New stage', color: DEFAULT_COLOR })
    setDirty(true)
    setEd(id)
  }

  function removeStage(rowId: string) {
    L.remove(rowId)
    setDirty(true)
  }

  function patchStage(rowId: string, values: Record<string, string>) {
    L.patch(rowId, { name: values.name, color: values.color })
    setDirty(true)
    setEd(null)
  }

  async function save() {
    setSaving(true)
    try {
      // The PUT endpoint updates existing rows by id. Send display order as the
      // new position so renames, recolours and any reordering round-trip.
      const stages = L.rows
        .map((r, i) => ({ row: r, position: i }))
        .filter(({ row }) => Boolean(row.id))
        .map(({ row, position }) => ({
          id: row.id as string,
          name: row.name,
          colour: row.color,
          position,
        }))
      if (stages.length > 0) {
        await fetch(apiPath('/api/admin/pipeline/stages'), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stages }),
        })
        await onSaved()
      }
      setDirty(false)
    } finally {
      setSaving(false)
    }
  }

  const editing = ed ? L.rows.find((r) => r._id === ed) : undefined

  return (
    <SectionShell
      title="Pipeline stages"
      lede="The stages of your sales pipeline."
      action={
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="btn2" onClick={addStage}>
            <Plus size={15} />
            Add stage
          </button>
          <button
            type="button"
            className="btn1"
            onClick={() => void save()}
            disabled={!dirty || saving}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      }
    >
      <div className="set-card lrow-wrap">
        {L.rows.map((r, i) => (
          <div
            key={r._id}
            className={'lrow' + (r._new ? ' lrow-enter' : '')}
            style={i ? { borderTop: '1px solid var(--border-subtle)' } : undefined}
          >
            <span className="lrow-drag" aria-hidden="true">
              <GripVertical size={16} />
            </span>
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 4,
                background: r.color,
                flexShrink: 0,
              }}
            />
            <div className="lrow-t">
              <b>{r.name}</b>
            </div>
            <div className="lrow-r">
              <RowActions
                onEdit={() => setEd(r._id)}
                onDelete={() => removeStage(r._id)}
              />
            </div>
          </div>
        ))}
        {!L.rows.length && <EmptyRow text="No stages yet." />}
      </div>

      {ed && (
        <EditDialog
          heading="Edit stage"
          row={editing}
          fields={[
            { key: 'name', label: 'Stage name' },
            { key: 'color', label: 'Colour', type: 'color' },
          ]}
          onSave={(v) => patchStage(ed, v)}
          onClose={() => setEd(null)}
        />
      )}
    </SectionShell>
  )
}
