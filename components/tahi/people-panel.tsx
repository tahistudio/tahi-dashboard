'use client'

/**
 * <PeoplePanel> — sidebar block on a request detail page. Shows the people
 * attached to this request broken into three role slots:
 *
 *   PM         single team member, can be reassigned
 *   Assignees  many team members, add + remove inline
 *   Followers  many contacts from the request's client org + optionally
 *              other team members who want updates
 *
 * Each role has its own picker that calls POST /participants with the
 * appropriate role. Removal calls DELETE on the row id.
 *
 * The caller owns the participants list (so the parent page can refetch the
 * request after mutations and keep a single source of truth).
 */

import React, { useEffect, useMemo, useState } from 'react'
import { Plus, X, Loader2, UserCog, Users, Eye } from 'lucide-react'
import { Card } from '@/components/tahi/card'
import { SearchableSelect } from '@/components/tahi/searchable-select'
import { apiPath } from '@/lib/api'

export interface Participant {
  id: string               // requestParticipants.id (row id, used for DELETE)
  participantId: string    // teamMember.id or contact.id
  participantType: 'team_member' | 'contact'
  role: 'pm' | 'assignee' | 'follower'
  name: string | null
  avatar: string | null
  email: string | null
  addedAt: string
}

interface TeamMemberOption { id: string; name: string }
interface ContactOption { id: string; name: string; email: string | null }

interface PeoplePanelProps {
  requestId: string
  orgId: string
  participants: Participant[]
  onChange: () => void
  isAdmin: boolean
}

// Tiny avatar cell — reused by each row.
function Avatar({ name, avatar }: { name: string | null; avatar: string | null }) {
  if (avatar) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={avatar} alt="" style={{ width: '1.5rem', height: '1.5rem', borderRadius: '9999px', objectFit: 'cover' }} />
  }
  const initials = (name ?? '?')
    .split(' ')
    .map(s => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: '1.5rem', height: '1.5rem',
        borderRadius: '9999px',
        background: 'var(--color-brand-50)',
        color: 'var(--color-brand)',
        fontSize: '0.625rem', fontWeight: 600,
        flexShrink: 0,
      }}
    >{initials}</span>
  )
}

function RoleHeader({ icon, label, count }: { icon: React.ReactNode; label: string; count: number }) {
  return (
    <div className="flex items-center" style={{ gap: '0.5rem', marginBottom: '0.5rem' }}>
      <span style={{ color: 'var(--color-text-subtle)' }} aria-hidden="true">{icon}</span>
      <h4
        style={{
          fontSize: '0.6875rem',
          fontWeight: 600,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: 'var(--color-text-muted)',
          margin: 0,
          flex: 1,
        }}
      >{label}</h4>
      {count > 0 && (
        <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>{count}</span>
      )}
    </div>
  )
}

function Row({
  p,
  onRemove,
  removing,
  canRemove,
}: {
  p: Participant
  onRemove: () => void
  removing: boolean
  canRemove: boolean
}) {
  return (
    <div
      className="flex items-center"
      style={{
        gap: '0.5rem',
        padding: '0.3125rem 0',
        minHeight: '1.875rem',
      }}
    >
      <Avatar name={p.name} avatar={p.avatar} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          className="truncate"
          style={{ fontSize: '0.8125rem', color: 'var(--color-text)', margin: 0, lineHeight: 1.3 }}
        >
          {p.name ?? 'Unknown'}
        </p>
        {p.email && (
          <p
            className="truncate"
            style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)', margin: 0, lineHeight: 1.2 }}
          >
            {p.email}
          </p>
        )}
      </div>
      {canRemove && (
        <button
          type="button"
          onClick={onRemove}
          disabled={removing}
          aria-label={`Remove ${p.name ?? 'participant'}`}
          style={{
            width: '1.5rem', height: '1.5rem',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 'var(--radius-sm)',
            background: 'transparent',
            border: 'none',
            color: 'var(--color-text-subtle)',
            cursor: removing ? 'not-allowed' : 'pointer',
            flexShrink: 0,
          }}
          onMouseEnter={e => {
            if (!removing) {
              e.currentTarget.style.background = 'var(--color-danger-bg)'
              e.currentTarget.style.color = 'var(--color-danger)'
            }
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--color-text-subtle)'
          }}
        >
          {removing ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
        </button>
      )}
    </div>
  )
}

export function PeoplePanel({ requestId, orgId, participants, onChange, isAdmin }: PeoplePanelProps) {
  const [teamMembers, setTeamMembers] = useState<TeamMemberOption[]>([])
  const [contacts, setContacts] = useState<ContactOption[]>([])
  const [adding, setAdding] = useState<'pm' | 'assignee' | 'follower' | null>(null)
  const [addingValue, setAddingValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)

  useEffect(() => {
    if (!isAdmin) return
    fetch(apiPath('/api/admin/team-members'))
      .then(r => r.json() as Promise<{ items: TeamMemberOption[] }>)
      .then(d => setTeamMembers(d.items ?? []))
      .catch(() => setTeamMembers([]))
  }, [isAdmin])

  useEffect(() => {
    if (!isAdmin || !orgId) return
    fetch(apiPath(`/api/admin/clients/${orgId}/contacts`))
      .then(r => r.json() as Promise<{ contacts?: Array<{ id: string; name: string; email: string | null }> }>)
      .then(d => setContacts((d.contacts ?? []).map(c => ({ id: c.id, name: c.name, email: c.email }))))
      .catch(() => setContacts([]))
  }, [isAdmin, orgId])

  const pm = participants.find(p => p.role === 'pm') ?? null
  const assignees = participants.filter(p => p.role === 'assignee')
  const followers = participants.filter(p => p.role === 'follower')

  // IDs already in a given role — used to filter the add picker so we don't
  // offer people who are already on the request in that role.
  const assigneeIds = useMemo(() => new Set(assignees.map(p => p.participantId)), [assignees])
  const followerIds = useMemo(() => new Set(followers.map(p => p.participantId)), [followers])

  async function addParticipant(
    role: 'pm' | 'assignee' | 'follower',
    participantId: string,
    participantType: 'team_member' | 'contact',
  ) {
    if (!participantId) return
    setSaving(true)
    try {
      const res = await fetch(apiPath(`/api/admin/requests/${requestId}/participants`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId, participantType, role }),
      })
      if (res.ok) {
        setAdding(null)
        setAddingValue('')
        onChange()
      }
    } finally {
      setSaving(false)
    }
  }

  async function removeParticipant(rowId: string) {
    setRemovingId(rowId)
    try {
      const res = await fetch(apiPath(`/api/admin/requests/${requestId}/participants/${rowId}`), {
        method: 'DELETE',
      })
      if (res.ok) onChange()
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <Card padding="none" style={{ overflow: 'hidden' }}>
      <div
        style={{
          padding: '0.75rem 1rem',
          borderBottom: '1px solid var(--color-border-subtle)',
        }}
      >
        <h3
          className="text-xs font-semibold uppercase"
          style={{ color: 'var(--color-text-muted)', letterSpacing: '0.04em', margin: 0 }}
        >
          People
        </h3>
      </div>

      <div style={{ padding: '0.875rem 1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {/* PM slot */}
        <section aria-label="Project manager">
          <RoleHeader icon={<UserCog size={12} />} label="Project manager" count={pm ? 1 : 0} />
          {pm ? (
            <Row
              p={pm}
              onRemove={() => removeParticipant(pm.id)}
              removing={removingId === pm.id}
              canRemove={isAdmin}
            />
          ) : adding === 'pm' ? (
            <div className="flex items-center" style={{ gap: '0.375rem' }}>
              <div style={{ flex: 1 }}>
                <SearchableSelect
                  options={teamMembers.map(tm => ({ value: tm.id, label: tm.name }))}
                  value={addingValue || null}
                  onChange={v => {
                    if (v) void addParticipant('pm', v, 'team_member')
                    else setAddingValue('')
                  }}
                  placeholder="Pick a PM…"
                  size="sm"
                />
              </div>
              <button
                type="button"
                onClick={() => { setAdding(null); setAddingValue('') }}
                aria-label="Cancel"
                style={{
                  width: '1.5rem', height: '1.5rem',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 'var(--radius-sm)',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--color-text-subtle)',
                  cursor: 'pointer',
                }}
              ><X size={12} /></button>
            </div>
          ) : isAdmin ? (
            <AddButton label="Set PM" onClick={() => { setAdding('pm'); setAddingValue('') }} disabled={saving} />
          ) : (
            <p style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', margin: 0 }}>No PM assigned.</p>
          )}
        </section>

        {/* Assignees slot */}
        <section aria-label="Assignees">
          <RoleHeader icon={<Users size={12} />} label="Assignees" count={assignees.length} />
          {assignees.length > 0 && (
            <div>
              {assignees.map(a => (
                <Row
                  key={a.id}
                  p={a}
                  onRemove={() => removeParticipant(a.id)}
                  removing={removingId === a.id}
                  canRemove={isAdmin}
                />
              ))}
            </div>
          )}
          {adding === 'assignee' ? (
            <div className="flex items-center" style={{ gap: '0.375rem', marginTop: assignees.length > 0 ? '0.375rem' : 0 }}>
              <div style={{ flex: 1 }}>
                <SearchableSelect
                  options={teamMembers
                    .filter(tm => !assigneeIds.has(tm.id) && tm.id !== pm?.participantId)
                    .map(tm => ({ value: tm.id, label: tm.name }))}
                  value={addingValue || null}
                  onChange={v => {
                    if (v) void addParticipant('assignee', v, 'team_member')
                    else setAddingValue('')
                  }}
                  placeholder="Add assignee…"
                  size="sm"
                />
              </div>
              <button
                type="button"
                onClick={() => { setAdding(null); setAddingValue('') }}
                aria-label="Cancel"
                style={{
                  width: '1.5rem', height: '1.5rem',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 'var(--radius-sm)',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--color-text-subtle)',
                  cursor: 'pointer',
                }}
              ><X size={12} /></button>
            </div>
          ) : isAdmin ? (
            <AddButton
              label="Add assignee"
              onClick={() => { setAdding('assignee'); setAddingValue('') }}
              disabled={saving}
              style={{ marginTop: assignees.length > 0 ? '0.375rem' : 0 }}
            />
          ) : assignees.length === 0 ? (
            <p style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', margin: 0 }}>No assignees yet.</p>
          ) : null}
        </section>

        {/* Followers slot — contacts + team members */}
        <section aria-label="Followers">
          <RoleHeader icon={<Eye size={12} />} label="Followers" count={followers.length} />
          {followers.length > 0 && (
            <div>
              {followers.map(f => (
                <Row
                  key={f.id}
                  p={f}
                  onRemove={() => removeParticipant(f.id)}
                  removing={removingId === f.id}
                  canRemove={isAdmin}
                />
              ))}
            </div>
          )}
          {adding === 'follower' ? (
            <div className="flex items-center" style={{ gap: '0.375rem', marginTop: followers.length > 0 ? '0.375rem' : 0 }}>
              <div style={{ flex: 1 }}>
                <SearchableSelect
                  options={[
                    ...contacts
                      .filter(c => !followerIds.has(c.id))
                      .map(c => ({ value: `contact:${c.id}`, label: c.name, subtitle: c.email ?? undefined })),
                    ...teamMembers
                      .filter(tm => !followerIds.has(tm.id))
                      .map(tm => ({ value: `team:${tm.id}`, label: tm.name, subtitle: 'Tahi team' })),
                  ]}
                  value={addingValue || null}
                  onChange={v => {
                    if (!v) { setAddingValue(''); return }
                    const [type, id] = v.split(':')
                    if (type === 'contact') void addParticipant('follower', id, 'contact')
                    else if (type === 'team') void addParticipant('follower', id, 'team_member')
                  }}
                  placeholder="Add a follower…"
                  searchPlaceholder="Search people…"
                  size="sm"
                />
              </div>
              <button
                type="button"
                onClick={() => { setAdding(null); setAddingValue('') }}
                aria-label="Cancel"
                style={{
                  width: '1.5rem', height: '1.5rem',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 'var(--radius-sm)',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--color-text-subtle)',
                  cursor: 'pointer',
                }}
              ><X size={12} /></button>
            </div>
          ) : isAdmin ? (
            <AddButton
              label="Add follower"
              onClick={() => { setAdding('follower'); setAddingValue('') }}
              disabled={saving}
              style={{ marginTop: followers.length > 0 ? '0.375rem' : 0 }}
            />
          ) : followers.length === 0 ? (
            <p style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', margin: 0 }}>No followers yet.</p>
          ) : null}
        </section>
      </div>
    </Card>
  )
}

function AddButton({
  label,
  onClick,
  disabled,
  style,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  style?: React.CSSProperties
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center transition-colors"
      style={{
        gap: '0.3125rem',
        padding: '0.3125rem 0.625rem',
        fontSize: '0.75rem',
        fontWeight: 500,
        borderRadius: 'var(--radius-button)',
        border: '1px dashed var(--color-border)',
        background: 'transparent',
        color: 'var(--color-text-muted)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
      onMouseEnter={e => {
        if (!disabled) {
          e.currentTarget.style.borderColor = 'var(--color-brand)'
          e.currentTarget.style.color = 'var(--color-brand)'
        }
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--color-border)'
        e.currentTarget.style.color = 'var(--color-text-muted)'
      }}
    >
      <Plus size={12} aria-hidden="true" />
      {label}
    </button>
  )
}
