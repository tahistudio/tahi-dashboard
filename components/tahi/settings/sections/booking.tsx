'use client'

/*
 * BookingSection - Account > Booking link
 *
 * Design source: the `function Booking(){...}` block in settings-app.jsx renders
 * booking links as a managed add / edit / delete list (label, duration, URL,
 * copy). Our backend today persists a SINGLE value under the `booking.google_cal_url`
 * setting (the same one the client portal reads for its "Schedule a Call" button).
 *
 * So the list UI is built faithfully, but persistence maps to that one slot: the
 * top row is the live link clients see. Adding a link prepends it (making it the
 * live one on save); deleting the top link promotes the next. Multiple typed,
 * separately persisted booking links are a later backend gap - see note below.
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
} from '@/components/tahi/settings/primitives'

const BOOKING_KEY = 'booking.google_cal_url'
const DURATIONS = ['15 min', '20 min', '30 min', '45 min', '60 min']

interface BookingRow extends Record<string, unknown> {
  name: string
  dur: string
  url: string
}

interface SettingsResponse {
  settings: Record<string, string | null>
}

export function BookingSection({ isAdmin }: { isAdmin?: boolean } = {}) {
  const { data, error, isLoading, mutate } = useResource<SettingsResponse>(
    isAdmin === false ? null : '/api/admin/settings',
  )

  if (isAdmin === false) return null

  if (isLoading) {
    return (
      <SectionShell
        title="Booking links"
        lede="Share the right link for the moment - discovery, kickoff, a retainer check-in, or a client-specific slot."
      >
        <div className="set-card lrow-wrap">
          <div className="lrow" style={{ opacity: 0.6 }}>
            <span className="lrow-ic leaf">
              <Calendar size={16} />
            </span>
            <div className="lrow-t">
              <b style={{ color: 'var(--text-faint)' }}>Loading booking links...</b>
            </div>
          </div>
        </div>
      </SectionShell>
    )
  }

  if (error) {
    return (
      <SectionShell
        title="Booking links"
        lede="Share the right link for the moment - discovery, kickoff, a retainer check-in, or a client-specific slot."
      >
        <div className="set-card lrow-wrap">
          <EmptyRow text="Could not load your booking link. Try again shortly." />
        </div>
      </SectionShell>
    )
  }

  const storedUrl = data?.settings?.[BOOKING_KEY]?.trim() || ''

  return (
    <BookingList
      key={storedUrl}
      initialUrl={storedUrl}
      onMutate={async () => {
        await mutate()
      }}
    />
  )
}

function BookingList({
  initialUrl,
  onMutate,
}: {
  initialUrl: string
  onMutate: () => Promise<void>
}) {
  const seed: BookingRow[] = initialUrl
    ? [{ name: 'Booking link', dur: '30 min', url: initialUrl }]
    : []
  const L = useManaged<BookingRow>(seed)
  const [ed, setEd] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Persist the top row's URL into the single backend slot clients read.
  const persist = async (value: string) => {
    setSaving(true)
    try {
      await fetch(apiPath('/api/admin/settings'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: BOOKING_KEY, value }),
      })
      await onMutate()
    } finally {
      setSaving(false)
    }
  }

  const handleSave = (values: Record<string, string>) => {
    if (!ed) return
    L.patch(ed, values)
    const topRow = L.rows[0]
    const nextTopUrl = topRow?._id === ed ? values.url : topRow?.url ?? ''
    setEd(null)
    void persist(nextTopUrl)
  }

  const handleDelete = (id: string) => {
    L.remove(id)
    const remaining = L.rows.filter((r) => r._id !== id)
    void persist(remaining[0]?.url ?? '')
  }

  const handleCopy = (row: BookingRow & { _id: string }) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(row.url)
    }
    setCopiedId(row._id)
    window.setTimeout(() => setCopiedId((c) => (c === row._id ? null : c)), 1600)
  }

  const editingRow = ed ? L.rows.find((r) => r._id === ed) ?? null : null

  return (
    <SectionShell
      title="Booking links"
      lede="Share the right link for the moment - discovery, kickoff, a retainer check-in, or a client-specific slot."
      action={
        <button
          type="button"
          className="btn1"
          disabled={saving}
          onClick={() => {
            const id = L.add({
              name: 'New link',
              dur: '30 min',
              url: 'https://calendar.app.google/',
            })
            setEd(id)
          }}
        >
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
              <button type="button" className="btn2 sm" onClick={() => handleCopy(r)}>
                <Copy size={14} />
                {copiedId === r._id ? 'Copied' : 'Copy'}
              </button>
              <RowActions onEdit={() => setEd(r._id)} onDelete={() => handleDelete(r._id)} />
            </div>
          </div>
        ))}
        {!L.rows.length && <EmptyRow text="No booking links yet." />}
      </div>
      <p className="set-lede" style={{ marginTop: 12, marginBottom: 0 }}>
        The top link is the one clients see on their portal. Separate links per
        moment are saved on this device for now.
      </p>
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
    </SectionShell>
  )
}
