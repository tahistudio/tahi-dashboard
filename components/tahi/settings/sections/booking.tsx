'use client'

/*
 * BookingSection - Account > Booking link
 *
 * Design source: the `function Booking(){...}` block in settings-app.jsx:
 * booking links as a managed add / edit / delete list (label, duration, URL,
 * copy) with the lrow-enter insert animation and the shared EditDialog.
 *
 * Persistence is real and complete: the whole list is stored as JSON under
 * the `booking.links` settings key ([{name,dur,url}]), and the top row's URL
 * is mirrored into the legacy `booking.google_cal_url` key in the same save
 * so the client portal's "Schedule a Call" button (which reads that key via
 * /api/portal/settings/booking) always points at the top link.
 */

import { useState } from 'react'
import { Calendar, Copy, Plus } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import {
  SectionShell,
  useManaged,
  EditDialog,
  RowActions,
  EmptyRow,
  Toasts,
  useToasts,
} from '@/components/tahi/settings/primitives'

const LINKS_KEY = 'booking.links'
const LEGACY_URL_KEY = 'booking.google_cal_url'
const DURATIONS = ['15 min', '20 min', '30 min', '45 min', '60 min']
const LEDE =
  'Share the right link for the moment - discovery, kickoff, a retainer check-in, or a client-specific slot.'

interface BookingRow extends Record<string, unknown> {
  name: string
  dur: string
  url: string
}

interface SettingsResponse {
  settings: Record<string, string | null>
}

function parseLinks(raw: string | null | undefined): BookingRow[] | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    const rows: BookingRow[] = []
    for (const item of parsed) {
      if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>
        rows.push({
          name: typeof o.name === 'string' ? o.name : 'Booking link',
          dur: typeof o.dur === 'string' ? o.dur : '30 min',
          url: typeof o.url === 'string' ? o.url : '',
        })
      }
    }
    return rows
  } catch {
    return null
  }
}

export function BookingSection({ isAdmin }: { isAdmin?: boolean } = {}) {
  const { data, error, isLoading, mutate } = useResource<SettingsResponse>(
    isAdmin === false ? null : '/api/admin/settings',
  )

  if (isAdmin === false) return null

  if (isLoading) {
    return (
      <SectionShell title="Booking links" lede={LEDE}>
        <div className="set-card lrow-wrap">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="lrow"
              style={i ? { borderTop: '1px solid var(--border-subtle)' } : undefined}
            >
              <div
                className="animate-pulse"
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: '0 .625rem 0 .625rem',
                  background: 'var(--bg-tertiary)',
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  className="animate-pulse"
                  style={{
                    height: 13,
                    width: '34%',
                    borderRadius: 6,
                    background: 'var(--bg-tertiary)',
                  }}
                />
                <div
                  className="animate-pulse"
                  style={{
                    height: 11,
                    width: '58%',
                    borderRadius: 6,
                    background: 'var(--bg-tertiary)',
                    marginTop: 6,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </SectionShell>
    )
  }

  if (error) {
    return (
      <SectionShell title="Booking links" lede={LEDE}>
        <div className="set-card lrow-wrap">
          <EmptyRow text="Could not load your booking links. Try again shortly." />
        </div>
      </SectionShell>
    )
  }

  // Prefer the full persisted list; fall back to the legacy single-URL key
  // (pre-list installs) so an existing live link still shows up.
  const parsed = parseLinks(data?.settings?.[LINKS_KEY])
  const legacyUrl = data?.settings?.[LEGACY_URL_KEY]?.trim() || ''
  const initialRows: BookingRow[] =
    parsed ?? (legacyUrl ? [{ name: 'Booking link', dur: '30 min', url: legacyUrl }] : [])

  return (
    <BookingList
      initialRows={initialRows}
      onMutate={async () => {
        await mutate()
      }}
    />
  )
}

function BookingList({
  initialRows,
  onMutate,
}: {
  initialRows: BookingRow[]
  onMutate: () => Promise<void>
}) {
  const L = useManaged<BookingRow>(initialRows)
  const [ed, setEd] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { toasts, toast } = useToasts()

  // Persist the full list (booking.links) and mirror the top row's URL into
  // the legacy key the portal reads. Both writes go through the existing
  // single-key PATCH contract.
  const persist = async (rows: BookingRow[]) => {
    setSaving(true)
    try {
      const links = rows.map((r) => ({ name: r.name, dur: r.dur, url: r.url }))
      const patch = (key: string, value: string) =>
        fetch(apiPath('/api/admin/settings'), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, value }),
        })
      const [a, b] = await Promise.all([
        patch(LINKS_KEY, JSON.stringify(links)),
        patch(LEGACY_URL_KEY, links[0]?.url ?? ''),
      ])
      if (!a.ok || !b.ok) throw new Error('save failed')
      await onMutate()
    } catch {
      toast('Could not save booking links', 'err')
    } finally {
      setSaving(false)
    }
  }

  const handleAdd = () => {
    const row: BookingRow = { name: 'New link', dur: '30 min', url: 'https://calendar.app.google/' }
    const snapshot = L.rows
    const id = L.add(row)
    setEd(id)
    void persist([row, ...snapshot])
  }

  const handleSave = (values: Record<string, string>) => {
    if (!ed) return
    const patch: Partial<BookingRow> = {
      name: values.name,
      dur: values.dur,
      url: values.url,
    }
    const next = L.rows.map((r) => (r._id === ed ? { ...r, ...patch } : r))
    L.patch(ed, patch)
    setEd(null)
    void persist(next)
  }

  const handleDelete = (id: string) => {
    const next = L.rows.filter((r) => r._id !== id)
    L.remove(id)
    void persist(next)
  }

  const handleCopy = (url: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard
        .writeText(url)
        .then(() => toast('Link copied'))
        .catch(() => toast('Could not copy link', 'err'))
    } else {
      toast('Could not copy link', 'err')
    }
  }

  const editingRow = ed ? L.rows.find((r) => r._id === ed) ?? null : null

  return (
    <SectionShell
      title="Booking links"
      lede={LEDE}
      action={
        <button type="button" className="btn1" disabled={saving} onClick={handleAdd}>
          <Plus size={15} />
          New link
        </button>
      }
    >
      <div className="set-card lrow-wrap">
        {L.rows.map((r, i) => (
          <div
            key={r._id}
            className={'lrow' + (r._new ? ' lrow-enter' : '')}
            style={i ? { borderTop: '1px solid var(--border-subtle)' } : undefined}
          >
            <span className="lrow-ic leaf">
              <Calendar size={16} />
            </span>
            <div className="lrow-t">
              <b>
                {r.name}{' '}
                <span style={{ color: 'var(--text-faint)', fontWeight: 500 }}>· {r.dur}</span>
              </b>
              <small style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{r.url}</small>
            </div>
            <div className="lrow-r">
              <button type="button" className="btn2 sm" onClick={() => handleCopy(r.url)}>
                <Copy size={14} />
                Copy
              </button>
              <RowActions onEdit={() => setEd(r._id)} onDelete={() => handleDelete(r._id)} />
            </div>
          </div>
        ))}
        {!L.rows.length && <EmptyRow text="No booking links yet." />}
      </div>
      {editingRow && (
        <EditDialog
          heading="Edit booking link"
          row={editingRow}
          fields={[
            { key: 'name', label: 'Label' },
            { key: 'dur', label: 'Duration', type: 'select', opts: DURATIONS },
            { key: 'url', label: 'Calendar URL' },
          ]}
          onSave={handleSave}
          onClose={() => setEd(null)}
        />
      )}
      <Toasts toasts={toasts} />
    </SectionShell>
  )
}
