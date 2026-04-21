'use client'

/**
 * <PeoplePanel> — sidebar block on a request detail page. Three role
 * slots (PM / Assignees / Followers) with optimistic multi-select adds.
 *
 * Concurrency story — why we don't call back to the parent for refetch
 * between mutations:
 *
 *   Early versions called `onChange()` after every POST/DELETE, which
 *   triggered a full /requests/[id] refetch. That races badly with fast
 *   clicks: user does add→delete before the add's refetch lands, the
 *   late refetch restores the deleted row. So we ditched the refetch.
 *
 *   Now the parent passes `setParticipants` (React's state dispatcher),
 *   and this component uses functional updates everywhere:
 *
 *     setParticipants(prev => [...prev, optimistic])
 *
 *   so each handler always composes on the latest state, regardless of
 *   how fast the user is clicking. When the server confirms, we swap the
 *   temp row with the real row via a single map() on prev. No refetch
 *   needed — the parent's full refetch happens on page load only, and
 *   we're authoritative from that point forward.
 *
 * The MultiPicker is rendered through a <Popover> so it overlays the
 * page instead of pushing sidebar cards around when it opens.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, X, Loader2, UserCog, Users, Eye, Check } from 'lucide-react'
import { Card } from '@/components/tahi/card'
import { Popover } from '@/components/tahi/popover'
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
  /** React state dispatcher from the parent — we call it with functional
   *  updaters so optimistic writes always compose on latest state. */
  setParticipants: React.Dispatch<React.SetStateAction<Participant[]>>
  isAdmin: boolean
  /** Hide the outer Card chrome so this can be embedded directly. */
  embedded?: boolean
}

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
  const isPending = p.id.startsWith('temp-')
  return (
    <div
      className="flex items-center"
      style={{
        gap: '0.5rem',
        padding: '0.3125rem 0',
        minHeight: '1.875rem',
        opacity: isPending ? 0.7 : 1,
        transition: 'opacity 150ms ease',
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
          disabled={removing || isPending}
          aria-label={`Remove ${p.name ?? 'participant'}`}
          title={isPending ? 'Saving…' : 'Remove'}
          style={{
            width: '1.5rem', height: '1.5rem',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 'var(--radius-sm)',
            background: 'transparent',
            border: 'none',
            color: 'var(--color-text-subtle)',
            cursor: (removing || isPending) ? 'not-allowed' : 'pointer',
            flexShrink: 0,
          }}
          onMouseEnter={e => {
            if (!removing && !isPending) {
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

function MultiPickerContent({
  options,
  existingIds,
  placeholder,
  onPick,
  onClose,
}: {
  options: Array<{ value: string; label: string; subtitle?: string }>
  existingIds: Set<string>
  placeholder?: string
  onPick: (value: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const filtered = options.filter(o => {
    const q = query.toLowerCase()
    if (!q) return true
    return o.label.toLowerCase().includes(q) || (o.subtitle?.toLowerCase().includes(q) ?? false)
  })
  return (
    <>
      <div
        style={{
          padding: '0.375rem 0.5rem',
          borderBottom: '1px solid var(--color-border-subtle)',
          background: 'var(--color-bg-secondary)',
          flexShrink: 0,
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
            padding: '0.3125rem 0.5rem',
            fontSize: '0.75rem',
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-sm)',
            outline: 'none',
            color: 'var(--color-text)',
          }}
        />
      </div>

      <div role="list" style={{ overflowY: 'auto', flex: 1 }}>
        {filtered.length === 0 ? (
          <p style={{ padding: '0.75rem', fontSize: '0.75rem', color: 'var(--color-text-subtle)', textAlign: 'center', margin: 0 }}>
            No matches.
          </p>
        ) : (
          filtered.map(opt => {
            const id = opt.value.includes(':') ? (opt.value.split(':').pop() ?? opt.value) : opt.value
            const alreadyAdded = existingIds.has(id)
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => { if (!alreadyAdded) onPick(opt.value) }}
                disabled={alreadyAdded}
                className="flex items-center w-full transition-colors"
                style={{
                  gap: '0.5rem',
                  padding: '0.375rem 0.5rem',
                  fontSize: '0.75rem',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: '1px solid var(--color-border-subtle)',
                  cursor: alreadyAdded ? 'default' : 'pointer',
                  opacity: alreadyAdded ? 0.55 : 1,
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
          flexShrink: 0,
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
    </>
  )
}

export function PeoplePanel({
  requestId,
  orgId,
  participants,
  setParticipants,
  isAdmin,
  embedded = false,
}: PeoplePanelProps) {
  const { showToast } = useToast()
  const [teamMembers, setTeamMembers] = useState<TeamMemberOption[]>([])
  const [contacts, setContacts] = useState<ContactOption[]>([])
  const [removingId, setRemovingId] = useState<string | null>(null)

  // Each slot has its own trigger + popover open state.
  const [pmOpen, setPmOpen] = useState(false)
  const [assigneeOpen, setAssigneeOpen] = useState(false)
  const [followerOpen, setFollowerOpen] = useState(false)
  const pmTrigger = useRef<HTMLButtonElement>(null)
  const assigneeTrigger = useRef<HTMLButtonElement>(null)
  const followerTrigger = useRef<HTMLButtonElement>(null)

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

  // --- server actions, always functional state updates --------------------

  const applyAdd = useCallback(async (
    role: 'pm' | 'assignee' | 'follower',
    participantId: string,
    participantType: 'team_member' | 'contact',
    displayName: string | null,
    email: string | null,
  ) => {
    const tempId = `temp-${role}-${participantId}-${Date.now()}`
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

    // Optimistic insert — functional update so we compose on latest state
    // even when the user is clicking faster than the server can respond.
    setParticipants(prev => {
      // Short-circuit if that person is already in this role (fast double-clicks).
      if (prev.some(p => p.participantId === participantId && p.role === role && !p.id.startsWith('temp-'))) {
        return prev
      }
      if (role === 'pm') {
        return [...prev.filter(p => p.role !== 'pm'), optimistic]
      }
      return [...prev, optimistic]
    })

    try {
      const res = await fetch(apiPath(`/api/admin/requests/${requestId}/participants`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId, participantType, role }),
      })
      if (!res.ok) {
        setParticipants(prev => prev.filter(p => p.id !== tempId))
        const j = await res.json().catch(() => ({})) as { error?: string }
        showToast(j.error ?? 'Failed to add person')
        return
      }
      const data = await res.json() as {
        participant: {
          id: string
          participantId: string
          participantType: 'team_member' | 'contact'
          role: 'pm' | 'assignee' | 'follower'
          addedAt: string
        }
      }
      // Swap temp row with the real row id, keep the display name we already
      // resolved so no flicker.
      setParticipants(prev => prev.map(p =>
        p.id === tempId
          ? { ...p, id: data.participant.id, addedAt: data.participant.addedAt }
          : p,
      ))
    } catch {
      setParticipants(prev => prev.filter(p => p.id !== tempId))
      showToast('Network error — try again')
    }
  }, [requestId, setParticipants, showToast])

  const applyRemove = useCallback(async (rowId: string) => {
    if (rowId.startsWith('temp-')) return // still saving, ignore
    // Optimistic: take it out of the list immediately.
    let snapshotRow: Participant | null = null
    setRemovingId(rowId)
    setParticipants(prev => {
      snapshotRow = prev.find(p => p.id === rowId) ?? null
      return prev.filter(p => p.id !== rowId)
    })
    try {
      const res = await fetch(apiPath(`/api/admin/requests/${requestId}/participants/${rowId}`), {
        method: 'DELETE',
      })
      if (!res.ok) {
        // Roll back — put the row back where it was.
        if (snapshotRow) setParticipants(prev => [...prev, snapshotRow!])
        showToast('Failed to remove')
      }
    } catch {
      if (snapshotRow) setParticipants(prev => [...prev, snapshotRow!])
      showToast('Network error — try again')
    } finally {
      setRemovingId(null)
    }
  }, [requestId, setParticipants, showToast])

  // --- render -------------------------------------------------------------

  const body = (
    <div style={{ padding: embedded ? 0 : '0.875rem 1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* PM */}
      <section aria-label="Project manager">
        <RoleHeader icon={<UserCog size={12} />} label="Project manager" count={pm ? 1 : 0} />
        {pm ? (
          <Row
            p={pm}
            onRemove={() => applyRemove(pm.id)}
            removing={removingId === pm.id}
            canRemove={isAdmin}
          />
        ) : isAdmin ? (
          <AddButton
            ref={pmTrigger}
            label="Set PM"
            onClick={() => setPmOpen(v => !v)}
          />
        ) : (
          <p style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', margin: 0 }}>No PM assigned.</p>
        )}

        <Popover
          anchorRef={pmTrigger}
          open={pmOpen}
          onClose={() => setPmOpen(false)}
          width="15rem"
        >
          <MultiPickerContent
            options={teamMembers.map(tm => ({ value: tm.id, label: tm.name }))}
            existingIds={new Set()}
            placeholder="Pick a PM…"
            onPick={v => {
              const tm = teamMembers.find(m => m.id === v)
              void applyAdd('pm', v, 'team_member', tm?.name ?? null, null)
              setPmOpen(false)
            }}
            onClose={() => setPmOpen(false)}
          />
        </Popover>
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
        {isAdmin ? (
          <AddButton
            ref={assigneeTrigger}
            label={assignees.length === 0 ? 'Add assignees' : 'Add more'}
            onClick={() => setAssigneeOpen(v => !v)}
            style={{ marginTop: assignees.length > 0 ? '0.375rem' : 0 }}
          />
        ) : assignees.length === 0 ? (
          <p style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', margin: 0 }}>No assignees yet.</p>
        ) : null}

        <Popover
          anchorRef={assigneeTrigger}
          open={assigneeOpen}
          onClose={() => setAssigneeOpen(false)}
          width="15rem"
        >
          <MultiPickerContent
            options={teamMembers
              .filter(tm => tm.id !== pm?.participantId)
              .map(tm => ({ value: tm.id, label: tm.name }))}
            existingIds={assigneeIds}
            placeholder="Search team…"
            onPick={v => {
              const tm = teamMembers.find(m => m.id === v)
              void applyAdd('assignee', v, 'team_member', tm?.name ?? null, null)
            }}
            onClose={() => setAssigneeOpen(false)}
          />
        </Popover>
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
        {isAdmin ? (
          <AddButton
            ref={followerTrigger}
            label={followers.length === 0 ? 'Add followers' : 'Add more'}
            onClick={() => setFollowerOpen(v => !v)}
            style={{ marginTop: followers.length > 0 ? '0.375rem' : 0 }}
          />
        ) : followers.length === 0 ? (
          <p style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', margin: 0 }}>No followers yet.</p>
        ) : null}

        <Popover
          anchorRef={followerTrigger}
          open={followerOpen}
          onClose={() => setFollowerOpen(false)}
          width="16rem"
        >
          <MultiPickerContent
            options={[
              ...contacts.map(c => ({ value: `contact:${c.id}`, label: c.name, subtitle: c.email ?? undefined })),
              ...teamMembers.map(tm => ({ value: `team:${tm.id}`, label: tm.name, subtitle: 'Tahi team' })),
            ]}
            existingIds={followerIds}
            placeholder="Search people…"
            onPick={v => {
              const [type, id] = v.split(':')
              if (type === 'contact') {
                const c = contacts.find(x => x.id === id)
                void applyAdd('follower', id, 'contact', c?.name ?? null, c?.email ?? null)
              } else if (type === 'team') {
                const tm = teamMembers.find(m => m.id === id)
                void applyAdd('follower', id, 'team_member', tm?.name ?? null, null)
              }
            }}
            onClose={() => setFollowerOpen(false)}
          />
        </Popover>
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

/** Small dashed "+ Label" button used as the trigger for each slot's
 *  Popover. forwardRef so the Popover can measure it. */
const AddButton = React.forwardRef<HTMLButtonElement, {
  label: string
  onClick: () => void
  disabled?: boolean
  style?: React.CSSProperties
}>(function AddButton({ label, onClick, disabled, style }, ref) {
  return (
    <button
      ref={ref}
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
})
