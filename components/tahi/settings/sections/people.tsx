'use client'

/**
 * People (client portal). The client's own teammates and their permission
 * level, with invite + edit. Shown under the client Organization group.
 *
 * Scaffold: rows are local (useManaged) and invites are optimistic. Persisting
 * these needs a portal contacts + invite endpoint (create contact, send Clerk
 * org invitation). Flagged, not wired.
 */

import { useState } from 'react'
import { Plus } from 'lucide-react'
import {
  SectionShell, useManaged, EditDialog, RowActions, EmptyRow, Chip,
  type Field, type ChipTone,
} from '@/components/tahi/settings/primitives'

const LEVELS = ['Owner', 'Admin', 'Member', 'Viewer']

interface Person extends Record<string, unknown> {
  name: string
  email: string
  level: string
  status: string
}

function initialsOf(name: string): string {
  const parts = (name || '').split(/\s+/).filter(Boolean)
  return parts.map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?'
}

function levelTone(level: string): ChipTone {
  if (level === 'Owner') return 'brand'
  if (level === 'Admin') return 'info'
  return 'neutral'
}

const FIELDS: Field[] = [
  { key: 'name', label: 'Full name' },
  { key: 'email', label: 'Email address', ph: 'name@company.com' },
  { key: 'level', label: 'Permission level', type: 'select', opts: LEVELS, help: 'Owners manage billing and everyone. Admins manage people and settings. Members work day-to-day. Viewers read only.' },
]

export function PeopleSection() {
  const people = useManaged<Person>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)

  return (
    <SectionShell
      title="People"
      lede="Invite teammates into your workspace and set what each can do."
      action={<button className="btn1" type="button" onClick={() => setInviting(true)}><Plus size={15} aria-hidden="true" />Invite teammate</button>}
    >
      <div className="set-card lrow-wrap">
        {people.rows.map((r, i) => (
          <div key={r._id} className={r._new ? 'lrow lrow-enter' : 'lrow'} style={i ? { borderTop: '1px solid var(--border-subtle)' } : undefined}>
            <span className="subj-av" style={{ width: 34, height: 34, fontSize: 12 }}>{initialsOf(r.name)}</span>
            <div className="lrow-t"><b>{r.name}</b><small>{r.email}</small></div>
            <div className="lrow-r">
              {r.status === 'Pending' && <Chip tone="neutral">Pending invite</Chip>}
              <Chip tone={levelTone(r.level)}>{r.level}</Chip>
              <RowActions onEdit={() => setEditing(r._id)} onDelete={() => people.remove(r._id)} />
            </div>
          </div>
        ))}
        {!people.rows.length && <EmptyRow text="No teammates yet. Invite someone to get started." />}
      </div>

      {inviting && (
        <EditDialog
          heading="Invite teammate"
          fields={FIELDS}
          row={{ level: 'Member' }}
          onSave={(v) => { if (v.name || v.email) people.add({ name: v.name, email: v.email, level: v.level || 'Member', status: 'Pending' }); setInviting(false) }}
          onClose={() => setInviting(false)}
        />
      )}
      {editing && (
        <EditDialog
          heading="Edit teammate"
          fields={FIELDS}
          row={people.rows.find((r) => r._id === editing)}
          onSave={(v) => { people.patch(editing, v); setEditing(null) }}
          onClose={() => setEditing(null)}
        />
      )}
    </SectionShell>
  )
}
