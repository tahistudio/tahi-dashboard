'use client'

/**
 * People (client portal). The org's real teammate roster from the `contacts`
 * table (GET /api/portal/people). A workspace admin (isClientAdmin) can invite
 * (Clerk organization invitation + pending contact row), edit a teammate's
 * name / permission level (PATCH), and remove a teammate (DELETE revokes the
 * Clerk invitation or membership first). Members get a read-only view; the
 * sub-nav also hides this tab from them (settings-shell clientAdminOnly), and
 * every write endpoint re-checks admin server-side.
 *
 * Permission levels shown are the real ones: Owner (the primary contact),
 * Admin, Member. The design's Viewer level has no portalRole backing, so it
 * is intentionally not offered.
 */

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useResource } from '@/lib/use-resource'
import { apiPath } from '@/lib/api'
import {
  SectionShell,
  EmptyRow,
  Chip,
  EditDialog,
  RowActions,
  Toasts,
  useToasts,
} from '@/components/tahi/settings/primitives'

interface Person {
  id: string
  name: string
  email: string
  role: string | null
  portalRole: string
  isPrimary: boolean
  pending: boolean
}

interface PeopleResponse {
  items: Person[]
}

const LEVEL_HELP =
  'Owners manage billing and everyone. Admins manage people and settings. Members work day-to-day.'

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

function levelOf(p: Person): { label: string; tone: 'brand' | 'info' | 'neutral' } {
  if (p.isPrimary) return { label: 'Owner', tone: 'brand' }
  if (p.portalRole === 'admin') return { label: 'Admin', tone: 'info' }
  return { label: 'Member', tone: 'neutral' }
}

function LoadingShell() {
  return (
    <SectionShell
      title="People"
      lede="Invite teammates into your workspace and set what each can do."
    >
      <div className="set-card lrow-wrap">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="lrow animate-pulse"
            style={i ? { borderTop: '1px solid var(--border-subtle)' } : undefined}
            aria-hidden="true"
          >
            <span className="subj-av" style={{ width: 34, height: 34 }} />
            <div className="lrow-t">
              <span
                style={{ display: 'block', width: 130, height: 13, background: 'var(--bg-secondary)', borderRadius: 6 }}
              />
              <span
                style={{ display: 'block', width: 180, height: 11, marginTop: 5, background: 'var(--bg-secondary)', borderRadius: 6 }}
              />
            </div>
          </div>
        ))}
      </div>
    </SectionShell>
  )
}

export function PeopleSection({ isClientAdmin }: { isClientAdmin?: boolean }) {
  const canManage = !!isClientAdmin
  const { data, error, isLoading, mutate } = useResource<PeopleResponse>('/api/portal/people')
  const [inviting, setInviting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [newId, setNewId] = useState<string | null>(null)
  const { toasts, toast } = useToasts()

  const people = data?.items ?? []
  const editing = editingId ? people.find((p) => p.id === editingId) : null

  if (isLoading && !data) return <LoadingShell />

  async function sendInvite(values: Record<string, string>) {
    const email = (values.email ?? '').trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast('Enter a valid email address.', 'err')
      return
    }
    setBusy(true)
    try {
      const res = await fetch(apiPath('/api/portal/people'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: (values.name ?? '').trim(),
          email,
          portalRole: values.level === 'Admin' ? 'admin' : 'member',
        }),
      })
      if (res.ok) {
        const created = (await res.json().catch(() => null)) as { id?: string } | null
        setInviting(false)
        if (created?.id) {
          setNewId(created.id)
          window.setTimeout(() => setNewId(null), 1400)
        }
        await mutate()
        toast('Invitation sent. It shows as Pending invite until they accept.')
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        toast(body.error || 'Could not send the invitation. Please try again shortly.', 'err')
      }
    } catch {
      toast('Could not send the invitation. Please try again shortly.', 'err')
    } finally {
      setBusy(false)
    }
  }

  async function saveEdit(values: Record<string, string>) {
    if (!editing) return
    setBusy(true)
    try {
      const res = await fetch(apiPath('/api/portal/people'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editing.id,
          name: (values.name ?? '').trim(),
          // Owners keep their level; the dialog hides the select for them.
          ...(editing.isPrimary
            ? {}
            : { portalRole: values.level === 'Admin' ? 'admin' : 'member' }),
        }),
      })
      if (res.ok) {
        setEditingId(null)
        await mutate()
        toast('Teammate updated.')
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        toast(body.error || 'Could not save the changes.', 'err')
      }
    } catch {
      toast('Could not save the changes.', 'err')
    } finally {
      setBusy(false)
    }
  }

  async function remove(p: Person) {
    if (!window.confirm(`Remove ${p.name} from your workspace?`)) return
    setBusy(true)
    try {
      const res = await fetch(apiPath(`/api/portal/people?id=${encodeURIComponent(p.id)}`), {
        method: 'DELETE',
      })
      if (res.ok) {
        await mutate()
        toast(p.pending ? 'Invitation revoked.' : 'Teammate removed.')
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        toast(body.error || 'Could not remove the teammate.', 'err')
      }
    } catch {
      toast('Could not remove the teammate.', 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SectionShell
      title="People"
      lede="Invite teammates into your workspace and set what each can do."
      action={
        canManage ? (
          <button type="button" className="btn1" onClick={() => setInviting(true)} disabled={busy}>
            <Plus size={15} />
            Invite teammate
          </button>
        ) : undefined
      }
    >
      <div className="set-card lrow-wrap">
        {error && <EmptyRow text="Could not load your teammates. Try again shortly." />}
        {!error && !people.length && (
          <EmptyRow text="No teammates yet. Invite someone to get started." />
        )}
        {!error &&
          people.map((p, i) => {
            const level = levelOf(p)
            return (
              <div
                key={p.id}
                className={'lrow' + (p.id === newId ? ' lrow-enter' : '')}
                style={i ? { borderTop: '1px solid var(--border-subtle)' } : undefined}
              >
                <span className="subj-av" style={{ width: 34, height: 34, fontSize: 12 }} aria-hidden="true">
                  {initialsOf(p.name)}
                </span>
                <div className="lrow-t">
                  <b>{p.name}</b>
                  <small>{p.email}</small>
                </div>
                <div className="lrow-r">
                  {p.pending && <Chip tone="neutral">Pending invite</Chip>}
                  <Chip tone={level.tone}>{level.label}</Chip>
                  {canManage && (
                    <RowActions onEdit={() => setEditingId(p.id)} onDelete={() => remove(p)} />
                  )}
                </div>
              </div>
            )
          })}
      </div>

      {!canManage && (
        <p className="set-lede" style={{ marginTop: 12, marginBottom: 0 }}>
          Only workspace admins can invite or manage teammates.
        </p>
      )}

      {inviting && (
        <EditDialog
          heading="Invite teammate"
          row={{ name: '', email: '', level: 'Member' }}
          fields={[
            { key: 'name', label: 'Full name' },
            { key: 'email', label: 'Email address', ph: 'name@company.com' },
            {
              key: 'level',
              label: 'Permission level',
              type: 'select',
              opts: ['Admin', 'Member'],
              help: LEVEL_HELP,
            },
          ]}
          onSave={sendInvite}
          onClose={() => (busy ? undefined : setInviting(false))}
        />
      )}

      {editing && (
        <EditDialog
          heading="Edit teammate"
          row={{ name: editing.name, level: levelOf(editing).label }}
          fields={
            editing.isPrimary
              ? [{ key: 'name', label: 'Full name' }]
              : [
                  { key: 'name', label: 'Full name' },
                  {
                    key: 'level',
                    label: 'Permission level',
                    type: 'select',
                    opts: ['Admin', 'Member'],
                    help: LEVEL_HELP,
                  },
                ]
          }
          onSave={saveEdit}
          onClose={() => (busy ? undefined : setEditingId(null))}
        />
      )}

      <Toasts toasts={toasts} />
    </SectionShell>
  )
}
