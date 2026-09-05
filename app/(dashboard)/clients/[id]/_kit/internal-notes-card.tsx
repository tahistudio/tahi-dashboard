'use client'

/**
 * <InternalNotesCard>. Studio-only notes on the org. Never shown in the
 * client portal, which is why the head carries the Private badge.
 */

import { useState } from 'react'
import { Lock } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { Badge } from '@/components/tahi/badge'
import { Card } from '@/components/tahi/card'
import type { Organisation } from './types'

// ── Internal notes card (editable) ────────────────────────────────────────────

export function InternalNotesCard({ org, onUpdated }: { org: Organisation; onUpdated: () => void }) {
  const [editing, setEditing] = useState(false)
  const [notes, setNotes] = useState(org.internalNotes ?? '')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      await fetch(apiPath(`/api/admin/clients/${org.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ internalNotes: notes }),
      })
      onUpdated()
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <Card.Header style={{ marginBottom: 'var(--space-3)', alignItems: 'center' }}>
        <div className="flex items-center" style={{ gap: '0.5rem', minWidth: 0 }}>
          <Card.Title style={{ fontSize: 'var(--text-sm)' }}>Internal notes</Card.Title>
          <Badge
            tone="neutral"
            size="sm"
            leader="icon"
            icon={<Lock aria-hidden="true" />}
            title="Visible to the Tahi team only, never shown in the client portal"
          >
            Private
          </Badge>
        </div>
        <Card.Action>
        {!editing ? (
          <button
            onClick={() => setEditing(true)}
            className="tahi-focus-ring min-h-[2.75rem] md:min-h-[1.75rem] text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] flex-shrink-0"
          >
            Edit
          </button>
        ) : (
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={() => { setEditing(false); setNotes(org.internalNotes ?? '') }} className="tahi-focus-ring min-h-[2.75rem] md:min-h-[1.75rem] text-xs text-[var(--color-text-muted)]">Cancel</button>
            <button onClick={save} disabled={saving} className="tahi-focus-ring min-h-[2.75rem] md:min-h-[1.75rem] text-xs text-[var(--color-brand)] font-medium disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
        </Card.Action>
      </Card.Header>

      {editing ? (
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={4}
          placeholder="Private notes about this client..."
          className="w-full min-h-[5rem] px-3 py-2 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] resize-none"
          autoFocus
        />
      ) : (
        <p className="text-sm text-[var(--color-text-secondary)] whitespace-pre-wrap min-h-[2rem]">
          {notes || <span className="text-[var(--color-text-muted)] italic">No notes yet. Click Edit to add.</span>}
        </p>
      )}
    </Card>
  )
}
