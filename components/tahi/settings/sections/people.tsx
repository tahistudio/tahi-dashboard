'use client'

/**
 * People (client portal). The org's real teammate roster from the `contacts`
 * table (GET /api/portal/people). A workspace admin (isClientAdmin) can invite a
 * teammate: this creates a Clerk organization invitation and records a pending
 * contact, so a "Pending" chip always maps to a real invitation. Members get a
 * plain read-only view; the sub-nav also hides this tab from them
 * (settings-shell clientAdminOnly), and the invite endpoint re-checks admin.
 */

import { useState } from 'react'
import { UserPlus } from 'lucide-react'
import { useResource } from '@/lib/use-resource'
import { apiPath } from '@/lib/api'
import {
  SectionShell,
  EmptyRow,
  Chip,
  EditDialog,
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

function LoadingShell() {
  return (
    <SectionShell title="People" lede="Your workspace teammates and what each can do.">
      <div className="set-card lrow-wrap">
        <div className="lrow" style={{ color: 'var(--text-faint)', font: '500 13px Manrope' }}>
          Loading teammates...
        </div>
      </div>
    </SectionShell>
  )
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

export function PeopleSection({ isClientAdmin }: { isClientAdmin?: boolean }) {
  const canManage = !!isClientAdmin
  const { data, error, isLoading, mutate } = useResource<PeopleResponse>('/api/portal/people')
  const [inviting, setInviting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  if (isLoading && !data) return <LoadingShell />

  function flash(msg: string) {
    setNote(msg)
    window.setTimeout(() => setNote(''), 5200)
  }

  async function sendInvite(values: Record<string, string>) {
    const email = (values.email ?? '').trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      flash('Enter a valid email address.')
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
          portalRole: values.portalRole === 'admin' ? 'admin' : 'member',
        }),
      })
      if (res.ok) {
        setInviting(false)
        await mutate()
        flash('Invitation sent. It shows as Pending until they accept.')
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        flash(body.error || 'Could not send the invitation. Please try again shortly.')
      }
    } catch {
      flash('Could not send the invitation. Please try again shortly.')
    } finally {
      setBusy(false)
    }
  }

  const people = data?.items ?? []

  return (
    <SectionShell
      title="People"
      lede="Your workspace teammates and what each can do."
      action={
        canManage ? (
          <button
            type="button"
            className="btn1"
            onClick={() => setInviting(true)}
            disabled={busy}
          >
            <UserPlus size={15} />
            Invite teammate
          </button>
        ) : undefined
      }
    >
      <div className="set-card lrow-wrap">
        {error && <EmptyRow text="Could not load your teammates. Try again shortly." />}
        {!error && !people.length && <EmptyRow text="No teammates to show yet." />}
        {!error &&
          people.map((p, i) => (
            <div
              key={p.id}
              className="lrow"
              style={i ? { borderTop: '1px solid var(--border-subtle)' } : undefined}
            >
              <span className="subj-av" aria-hidden="true">
                {initialsOf(p.name)}
              </span>
              <div className="lrow-t">
                <b>{p.name}</b>
                <small style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{p.email}</small>
              </div>
              <div className="lrow-r" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {p.pending && <Chip tone="warning">Pending</Chip>}
                {p.isPrimary && <Chip tone="brand">Primary</Chip>}
                <Chip tone={p.portalRole === 'admin' ? 'info' : 'neutral'}>
                  {p.portalRole === 'admin' ? 'Admin' : 'Member'}
                </Chip>
              </div>
            </div>
          ))}
      </div>

      <p className="set-lede" style={{ marginTop: 12, marginBottom: 0 }}>
        {canManage
          ? 'Invited teammates receive an email to join your workspace and show as Pending until they accept.'
          : 'Only workspace admins can invite or manage teammates.'}
      </p>

      {note && <div className="plan-note">{note}</div>}

      {inviting && (
        <EditDialog
          heading="Invite teammate"
          row={{ name: '', email: '', portalRole: 'member' }}
          fields={[
            { key: 'name', label: 'Name', ph: 'Optional' },
            { key: 'email', label: 'Email', ph: 'name@company.com' },
            {
              key: 'portalRole',
              label: 'Role',
              type: 'select',
              opts: ['member', 'admin'],
              help: 'Admins can manage the workspace, brands and teammates. Members get a read-only settings view.',
            },
          ]}
          onSave={sendInvite}
          onClose={() => (busy ? undefined : setInviting(false))}
        />
      )}
    </SectionShell>
  )
}
