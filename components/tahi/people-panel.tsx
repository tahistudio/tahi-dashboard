'use client'

/**
 * <PeoplePanel> — sidebar block on a request detail page. Shows the people
 * attached to this request broken into three role slots:
 *
 *   PM         single team member, can be reassigned
 *   Assignees  many team members, add multiple in one session
 *   Followers  many contacts from the request's client org + optionally
 *              other team members who want updates
 *
 * Each slot (except PM) supports multi-select adds: the picker stays open
 * while the user checks off multiple people, then closes on Done. All
 * mutations are optimistic — we mutate local state, fire the server call,
 * roll back on error.
 *
 * The caller owns the participants list and passes an `onChange` callback
 * that's invoked after successful writes (in case the parent wants to
 * reconcile). If `onOptimisticChange` is provided we prefer that for instant
 * UI updates without a refetch.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, X, Loader2, UserCog, Users, Eye, Check } from 'lucide-react'
import { Card } from '@/components/tahi/card'
import { apiPath } from '@/lib/api'
import { useToast } from '@/components/tahi/toast'

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
  /** Called after a successful server mutation — parent can refetch if it
   *  wants reconciliation, but optimistic state has already been applied. */
  onChange: () => void
  /** If provided, we optimistically apply the new participants list here
   *  instead of waiting for onChange/refetch. */
  onOptimisticChange?: (next: Participant[]) => void
  isAdmin: boolean
  /** Hide the internal card chrome so the panel can be embedded directly
   *  in a parent card without a double border. */
  embedded?: boolean
}

// Tiny avatar cell — reused by each row.
function Avatar({ name, avatar, size = 24 }: { name: string | null; avatar: string | null; size?: number }) {
  if (avatar) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={avatar} alt="" style={{ width: size, height: size, borderRadius: '9999px', objectFit: 'cover', flexShrink: 0 }} />
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
        width: size, height: size,
        borderRadius: '9999px',
        background: 'var(--color-brand-50)',
        color: 'var(--color-brand)',
        fontSize: size <= 20 ? '0.5625rem' : '0.625rem',
        fontWeight: 600,
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

/**
 * Multi-select picker used by Assignees + Followers. Renders a compact
 * checkbox list inline in the panel — the picker stays open while the
 * user checks multiple people. Each check immediately fires an add
 * (optimistic); uncheck doesn't do anything inside the picker (we don't
 * remove from here — use the row X). Done button just closes.
 */
function MultiPicker({
  options,
  existingIds,
  placeholder,
  onPick,
  onClose,
}: {
  options: Array<{ value: string; label: string; subtitle?: string; avatar?: string | null }>
  existingIds: Set<string>
  placeholder?: string
  onPick: (value: string) => void | Promise<void>
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const filtered = options.filter(o => {
    const q = query.toLowerCase()
    if (!q) return true
    return o.label.toLowerCase().includes(q) || (o.subtitle?.toLowerCase().includes(q) ?? false)
  })
  return (
    <div
      role="dialog"
      aria-label="Add people"
      style={{
        marginTop: '0.5rem',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--color-bg)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '0.375rem 0.5rem',
          borderBottom: '1px solid var(--color-border-subtle)',
          background: 'var(--color-bg-secondary)',
        }}
      >
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={placeholder ?? 'Search…'}
          autoFocus
          style={{
            width: '100%',
            padding: '0.25rem 0.5rem',
            fontSize: '0.75rem',
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-sm)',
            outline: 'none',
            color: 'var(--color-text)',
          }}
        />
      </div>

      <div role="list" style={{ maxHeight: '13rem', overflowY: 'auto' }}>
        {filtered.length === 0 ? (
          <p style={{ padding: '0.75rem', fontSize: '0.75rem', color: 'var(--color-text-subtle)', textAlign: 'center', margin: 0 }}>
            No matches.
          </p>
        ) : (
          filtered.map(opt => {
            const alreadyAdded = existingIds.has(opt.value.split(':').pop() ?? opt.value)
            return (
              <button
                key={opt.value}
                type="button"
                disabled={alreadyAdded}
                onClick={() => void onPick(opt.value)}
                className="flex items-center w-full transition-colors"
                style={{
                  gap: '0.5rem',
                  padding: '0.375rem 0.5rem',
                  fontSize: '0.75rem',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: '1px solid var(--color-border-subtle)',
                  cursor: alreadyAdded ? 'default' : 'pointer',
                  opacity: alreadyAdded ? 0.5 : 1,
                  textAlign: 'left',
                  color: 'var(--color-text)',
                }}
                onMouseEnter={e => { if (!alreadyAdded) e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: '1rem', height: '1rem',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: 'var(--radius-sm)',
                    border: alreadyAdded ? '1px solid var(--color-brand)' : '1px solid var(--color-border)',
                    background: alreadyAdded ? 'var(--color-brand)' : 'var(--color-bg)',
                    color: '#fff',
                    flexShrink: 0,
                  }}
                >
                  {alreadyAdded && <Check size={10} aria-hidden="true" />}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="truncate" style={{ fontWeight: 500 }}>{opt.label}</div>
                  {opt.subtitle && (
                    <div className="truncate" style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>
                      {opt.subtitle}
                    </div>
                  )}
                </div>
              </button>
            )
          })
        )}
      </div>

      <div
        className="flex items-center justify-end"
        style={{
          padding: '0.375rem 0.5rem',
          borderTop: '1px solid var(--color-border-subtle)',
          background: 'var(--color-bg-secondary)',
          gap: '0.375rem',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          className="text-xs font-medium"
          style={{
            padding: '0.25rem 0.625rem',
            borderRadius: 'var(--radius-sm)',
            border: 'none',
            background: 'var(--color-brand)',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          Done
        </button>
      </div>
    </div>
  )
}

export function PeoplePanel({
  requestId,
  orgId,
  participants,
  onChange,
  onOptimisticChange,
  isAdmin,
  embedded = false,
}: PeoplePanelProps) {
  const { showToast } = useToast()
  const [teamMembers, setTeamMembers] = useState<TeamMemberOption[]>([])
  const [contacts, setContacts] = useState<ContactOption[]>([])
  const [pickingPm, setPickingPm] = useState(false)
  const [pickingAssignee, setPickingAssignee] = useState(false)
  const [pickingFollower, setPickingFollower] = useState(false)
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

  const assigneeIds = useMemo(() => new Set(assignees.map(p => p.participantId)), [assignees])
  const followerIds = useMemo(() => new Set(followers.map(p => p.participantId)), [followers])

  // Optimistic apply helper — inserts a temp row until the server confirms.
  const applyAdd = useCallback(async (
    role: 'pm' | 'assignee' | 'follower',
    participantId: string,
    participantType: 'team_member' | 'contact',
    displayName: string | null,
    email: string | null,
  ) => {
    const tempId = `temp-${participantId}-${role}`
    const optimistic: Participant = {
      id: tempId,
      participantId,
      participantType,
      role,
      name: displayName,
      avatar: null,
      email,
      addedAt: new Date().toISOString(),
    }
    // For PM role, remove any existing PM first in local state.
    const next = role === 'pm'
      ? [...participants.filter(p => p.role !== 'pm'), optimistic]
      : [...participants, optimistic]
    onOptimisticChange?.(next)

    try {
      const res = await fetch(apiPath(`/api/admin/requests/${requestId}/participants`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId, participantType, role }),
      })
      if (!res.ok) {
        // Roll back
        onOptimisticChange?.(participants)
        const j = await res.json().catch(() => ({})) as { error?: string }
        showToast(j.error ?? 'Failed to add person')
        return
      }
      // Server returns the real row — let caller refetch to swap the temp id.
      onChange()
    } catch {
      onOptimisticChange?.(participants)
      showToast('Network error — try again')
    }
  }, [requestId, participants, onOptimisticChange, onChange, showToast])

  const applyRemove = useCallback(async (rowId: string) => {
    setRemovingId(rowId)
    const next = participants.filter(p => p.id !== rowId)
    onOptimisticChange?.(next)
    try {
      const res = await fetch(apiPath(`/api/admin/requests/${requestId}/participants/${rowId}`), {
        method: 'DELETE',
      })
      if (!res.ok) {
        onOptimisticChange?.(participants)
        showToast('Failed to remove')
        return
      }
      onChange()
    } catch {
      onOptimisticChange?.(participants)
      showToast('Network error — try again')
    } finally {
      setRemovingId(null)
    }
  }, [requestId, participants, onOptimisticChange, onChange, showToast])

  const body = (
    <div style={{ padding: embedded ? 0 : '0.875rem 1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* PM slot */}
      <section aria-label="Project manager">
        <RoleHeader icon={<UserCog size={12} />} label="Project manager" count={pm ? 1 : 0} />
        {pm ? (
          <Row
            p={pm}
            onRemove={() => applyRemove(pm.id)}
            removing={removingId === pm.id}
            canRemove={isAdmin}
          />
        ) : pickingPm ? (
          <MultiPicker
            options={teamMembers.map(tm => ({ value: tm.id, label: tm.name }))}
            existingIds={new Set<string>()}
            placeholder="Pick a PM…"
            onPick={v => {
              const tm = teamMembers.find(m => m.id === v)
              void applyAdd('pm', v, 'team_member', tm?.name ?? null, null)
              setPickingPm(false)
            }}
            onClose={() => setPickingPm(false)}
          />
        ) : isAdmin ? (
          <AddButton label="Set PM" onClick={() => setPickingPm(true)} />
        ) : (
          <p style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', margin: 0 }}>No PM assigned.</p>
        )}
      </section>

      {/* Assignees */}
      <section aria-label="Assignees">
        <RoleHeader icon={<Users size={12} />} label="Assignees" count={assignees.length} />
        {assignees.length > 0 && (
          <div>
            {assignees.map(a => (
              <Row
                key={a.id}
                p={a}
                onRemove={() => applyRemove(a.id)}
                removing={removingId === a.id}
                canRemove={isAdmin}
              />
            ))}
          </div>
        )}
        {pickingAssignee ? (
          <MultiPicker
            options={teamMembers
              .filter(tm => tm.id !== pm?.participantId)
              .map(tm => ({ value: tm.id, label: tm.name }))}
            existingIds={assigneeIds}
            placeholder="Search team…"
            onPick={v => {
              if (assigneeIds.has(v)) return
              const tm = teamMembers.find(m => m.id === v)
              void applyAdd('assignee', v, 'team_member', tm?.name ?? null, null)
            }}
            onClose={() => setPickingAssignee(false)}
          />
        ) : isAdmin ? (
          <AddButton
            label={assignees.length === 0 ? 'Add assignees' : 'Add more'}
            onClick={() => setPickingAssignee(true)}
            style={{ marginTop: assignees.length > 0 ? '0.375rem' : 0 }}
          />
        ) : assignees.length === 0 ? (
          <p style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', margin: 0 }}>No assignees yet.</p>
        ) : null}
      </section>

      {/* Followers */}
      <section aria-label="Followers">
        <RoleHeader icon={<Eye size={12} />} label="Followers" count={followers.length} />
        {followers.length > 0 && (
          <div>
            {followers.map(f => (
              <Row
                key={f.id}
                p={f}
                onRemove={() => applyRemove(f.id)}
                removing={removingId === f.id}
                canRemove={isAdmin}
              />
            ))}
          </div>
        )}
        {pickingFollower ? (
          <MultiPicker
            options={[
              ...contacts
                .map(c => ({ value: `contact:${c.id}`, label: c.name, subtitle: c.email ?? undefined })),
              ...teamMembers
                .map(tm => ({ value: `team:${tm.id}`, label: tm.name, subtitle: 'Tahi team' })),
            ]}
            existingIds={followerIds}
            placeholder="Search people…"
            onPick={v => {
              const [type, id] = v.split(':')
              if (followerIds.has(id)) return
              if (type === 'contact') {
                const c = contacts.find(x => x.id === id)
                void applyAdd('follower', id, 'contact', c?.name ?? null, c?.email ?? null)
              } else if (type === 'team') {
                const tm = teamMembers.find(m => m.id === id)
                void applyAdd('follower', id, 'team_member', tm?.name ?? null, null)
              }
            }}
            onClose={() => setPickingFollower(false)}
          />
        ) : isAdmin ? (
          <AddButton
            label={followers.length === 0 ? 'Add followers' : 'Add more'}
            onClick={() => setPickingFollower(true)}
            style={{ marginTop: followers.length > 0 ? '0.375rem' : 0 }}
          />
        ) : followers.length === 0 ? (
          <p style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', margin: 0 }}>No followers yet.</p>
        ) : null}
      </section>
    </div>
  )

  if (embedded) return body

  return (
    <Card padding="none">
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
      {body}
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
