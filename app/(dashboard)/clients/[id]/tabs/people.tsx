'use client'

/**
 * The client People tab: the seats at this client, what each one can do in
 * the portal, and the only in-product way to hand someone a login.
 *
 * The invite machinery is kept whole from the old Contacts tab, including the
 * copy-link fallback: when Resend is down or the address bounces, the link is
 * still the operator's only recovery, so it stays on screen after a failure
 * instead of being swallowed by a toast.
 */

import { useState } from 'react'
import {
  Check,
  Copy,
  Link2,
  Loader2,
  Mail,
  Plus,
  Shield,
  Star,
  UserRound,
  Users,
} from 'lucide-react'
import { apiPath } from '@/lib/api'
import { Avatar } from '@/components/tahi/avatar'
import { Badge } from '@/components/tahi/badge'
import { Card } from '@/components/tahi/card'
import { DataTable, type DataTableAction, type DataTableColumn } from '@/components/tahi/data-table'
import { EmptyState } from '@/components/tahi/empty-state'
import { SlideOver } from '@/components/tahi/slide-over'
import { TahiButton } from '@/components/tahi/tahi-button'
import { useToast } from '@/components/tahi/toast'
import { CountText, Grow, SectionTitle, SubBar } from '../_kit/chrome'
import type { Contact } from '../_kit/types'

/**
 * Per-contact invite state. `link` is kept after a send so the operator always
 * has a copy-link fallback, which is the only recovery when Resend is down or
 * the address bounces.
 */
export interface InviteState {
  status: 'sending' | 'sent' | 'failed'
  link: string
  error?: string
}

function lastSeenLabel(value: string | null | undefined): string {
  if (!value) return 'Never signed in'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return 'Never signed in'
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days} days ago`
  return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function PeopleTab({
  clientId,
  orgName,
  contacts,
  contactId,
  writeDisabled,
  onOpenContact,
  onUpdated,
}: {
  clientId: string
  orgName: string
  contacts: Contact[]
  contactId: string | null
  writeDisabled: boolean
  onOpenContact: (id: string | null) => void
  onUpdated: () => void
}) {
  const { showToast } = useToast()
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', email: '', role: '', isPrimary: false })
  const [invites, setInvites] = useState<Record<string, InviteState>>({})
  const [copied, setCopied] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const open = contacts.find(c => c.id === contactId) ?? null
  const inPortal = contacts.filter(c => c.clerkUserId).length

  // Persona is deliberately NOT computed here. The mint route derives it from
  // the org's plan with personaForPlanType (lib/onboarding-invites.ts), which is
  // the same rule the welcome route and admin client creation use, so there is
  // one copy of it and it lives next to the data it reads.
  async function handleInvite(contact: Contact) {
    setInvites(prev => ({ ...prev, [contact.id]: { status: 'sending', link: '' } }))
    try {
      const res = await fetch(apiPath('/api/admin/onboarding-invites'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flow: 'client',
          orgId: clientId,
          contactEmail: contact.email,
          contactName: contact.name,
          send: true,
          reuse: true,
        }),
      })
      const json = await res.json() as { error?: string; link?: string; emailed?: boolean; emailError?: string }
      if (!res.ok) {
        setInvites(prev => ({
          ...prev,
          [contact.id]: { status: 'failed', link: '', error: json.error ?? 'Could not create the invite' },
        }))
        showToast(json.error ?? 'Could not create the invite', 'error')
        return
      }
      const link = json.link ?? ''
      if (json.emailed) {
        setInvites(prev => ({ ...prev, [contact.id]: { status: 'sent', link } }))
        showToast(`Invite sent to ${contact.email}`, 'success')
      } else {
        setInvites(prev => ({
          ...prev,
          [contact.id]: { status: 'failed', link, error: json.emailError ?? 'Email not sent' },
        }))
        showToast('Invite link created, but the email did not send. Copy the link instead.', 'warning')
      }
    } catch {
      setInvites(prev => ({ ...prev, [contact.id]: { status: 'failed', link: '', error: 'Network error' } }))
      showToast('Could not create the invite', 'error')
    }
  }

  async function handleCopyLink(id: string, link: string) {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(id)
      showToast('Invite link copied', 'success')
      window.setTimeout(() => setCopied(c => (c === id ? null : c)), 2000)
    } catch {
      showToast('Could not copy the link', 'error')
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim() || !form.email.trim()) return
    setSaving(true)
    setFormError(null)
    try {
      const res = await fetch(apiPath(`/api/admin/clients/${clientId}/contacts`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        setFormError(data.error ?? 'Failed to add contact')
        return
      }
      setForm({ name: '', email: '', role: '', isPrimary: false })
      setShowForm(false)
      onUpdated()
    } catch {
      setFormError('Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function makePrimary(contact: Contact) {
    setBusyId(contact.id)
    try {
      const res = await fetch(apiPath(`/api/admin/contacts/${contact.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPrimary: true }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => null) as { error?: string } | null
        showToast(json?.error ?? 'Could not make them the primary contact', 'error')
        return
      }
      showToast(`${contact.name} is now the primary contact`, 'success')
      onUpdated()
    } catch {
      showToast('Could not make them the primary contact', 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function setPortalRole(contact: Contact, portalRole: 'admin' | 'member') {
    setBusyId(contact.id)
    try {
      const res = await fetch(apiPath('/api/admin/permissions/contact-role'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: contact.id, portalRole }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => null) as { error?: string } | null
        showToast(json?.error ?? 'Could not change their portal role', 'error')
        return
      }
      showToast(
        portalRole === 'admin'
          ? `${contact.name} can now administer the ${orgName} portal`
          : `${contact.name} is back to their own scoped view`,
        'success',
      )
      onUpdated()
    } catch {
      showToast('Could not change their portal role', 'error')
    } finally {
      setBusyId(null)
    }
  }

  function actionsFor(c: Contact): DataTableAction[] {
    const out: DataTableAction[] = [
      { label: 'Open', icon: <UserRound className="w-3.5 h-3.5" />, onClick: () => onOpenContact(c.id) },
    ]
    if (writeDisabled) return out
    const busy = busyId === c.id
    if (!c.isPrimary) {
      out.push({
        label: 'Make primary',
        icon: <Star className="w-3.5 h-3.5" />,
        disabled: busy,
        onClick: () => { void makePrimary(c) },
      })
    }
    out.push({
      label: c.clerkUserId ? 'Resend portal invite' : 'Invite to portal',
      icon: <Mail className="w-3.5 h-3.5" />,
      disabled: invites[c.id]?.status === 'sending',
      onClick: () => { void handleInvite(c) },
    })
    if (invites[c.id]?.link) {
      out.push({
        label: 'Copy invite link',
        icon: <Link2 className="w-3.5 h-3.5" />,
        onClick: () => { void handleCopyLink(c.id, invites[c.id].link) },
      })
    }
    out.push({
      label: c.portalRole === 'admin' ? 'Make a portal member' : 'Make a portal admin',
      icon: <Shield className="w-3.5 h-3.5" />,
      disabled: busy,
      onClick: () => { void setPortalRole(c, c.portalRole === 'admin' ? 'member' : 'admin') },
    })
    return out
  }

  const columns: DataTableColumn<Contact>[] = [
    {
      key: 'person',
      header: 'Person',
      minWidth: '14rem',
      sortable: true,
      sortValue: c => c.name,
      render: c => (
        <div className="flex items-center" style={{ gap: '0.5rem', minWidth: 0 }}>
          <Avatar name={c.name} size="sm" tooltip={false} />
          <div className="flex flex-col" style={{ minWidth: 0 }}>
            <span className="flex items-center" style={{ gap: '0.375rem' }}>
              <span data-private className="truncate" style={{ fontWeight: 600, color: 'var(--color-text)' }}>{c.name}</span>
              {c.isPrimary && <Badge tone="brand" size="sm">Primary</Badge>}
            </span>
            <span data-private className="truncate" style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              {c.email}
            </span>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      muted: true,
      render: c => <span data-private>{c.role ?? '--'}</span>,
    },
    {
      key: 'portalRole',
      header: 'Portal role',
      width: '8rem',
      render: c => (
        <Badge tone={c.portalRole === 'admin' ? 'brand' : 'neutral'} size="sm">
          {c.portalRole === 'admin' ? 'Admin' : 'Member'}
        </Badge>
      ),
    },
    {
      key: 'access',
      header: 'Access',
      width: '11rem',
      render: c => (
        <span className="flex items-center flex-wrap" style={{ gap: '0.5rem' }}>
          <Badge tone={c.clerkUserId ? 'positive' : 'neutral'} size="sm" dot>
            {c.clerkUserId ? 'In the portal' : 'No access'}
          </Badge>
          {invites[c.id]?.status === 'sent' && <Badge tone="info" size="sm">Invite sent</Badge>}
          {invites[c.id]?.status === 'failed' && <Badge tone="danger" size="sm">Send failed</Badge>}
        </span>
      ),
    },
    {
      key: 'seen',
      header: 'Seen',
      muted: true,
      width: '8rem',
      sortable: true,
      sortValue: c => c.lastLoginAt ?? '',
      render: c => lastSeenLabel(c.lastLoginAt),
    },
  ]

  return (
    <div className="flex flex-col" style={{ gap: '0.75rem' }}>
      <SubBar>
        <SectionTitle>Seats</SectionTitle>
        <CountText>
          {contacts.length} {contacts.length === 1 ? 'person' : 'people'}, {inPortal} in the portal
        </CountText>
        <Grow />
        <TahiButton
          variant="primary"
          size="sm"
          disabled={writeDisabled}
          aria-expanded={showForm}
          onClick={() => setShowForm(s => !s)}
          iconLeft={<Plus className="w-3.5 h-3.5" />}
        >
          Add contact
        </TahiButton>
      </SubBar>

      {showForm && (
        <Card>
          <form onSubmit={handleAdd}>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.8125rem', fontWeight: 700, color: 'var(--color-text)' }}>
              New contact at {orgName}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: '0.75rem', marginBottom: '0.75rem' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
                  Name <span style={{ color: 'var(--color-danger)' }}>*</span>
                </span>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  required
                  placeholder="Jane Smith"
                  className="tahi-focus-ring min-h-[2.75rem] md:min-h-[2.25rem]"
                  style={{
                    padding: '0 0.75rem',
                    borderRadius: 'var(--radius-input)',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg)',
                    color: 'var(--color-text)',
                    fontSize: '0.8125rem',
                  }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
                  Email <span style={{ color: 'var(--color-danger)' }}>*</span>
                </span>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  required
                  placeholder="jane@example.com"
                  className="tahi-focus-ring min-h-[2.75rem] md:min-h-[2.25rem]"
                  style={{
                    padding: '0 0.75rem',
                    borderRadius: 'var(--radius-input)',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg)',
                    color: 'var(--color-text)',
                    fontSize: '0.8125rem',
                  }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
                  Role at {orgName}
                </span>
                <input
                  value={form.role}
                  onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                  placeholder="Marketing Manager"
                  className="tahi-focus-ring min-h-[2.75rem] md:min-h-[2.25rem]"
                  style={{
                    padding: '0 0.75rem',
                    borderRadius: 'var(--radius-input)',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg)',
                    color: 'var(--color-text)',
                    fontSize: '0.8125rem',
                  }}
                />
              </label>
              <label
                className="flex items-center"
                style={{ gap: '0.5rem', minHeight: '2.75rem', fontSize: '0.8125rem', color: 'var(--color-text-muted)', cursor: 'pointer' }}
              >
                <input
                  type="checkbox"
                  checked={form.isPrimary}
                  onChange={e => setForm(f => ({ ...f, isPrimary: e.target.checked }))}
                  style={{ accentColor: 'var(--color-brand)', width: '0.875rem', height: '0.875rem' }}
                />
                Primary contact, gets the invoices and the invite
              </label>
            </div>

            {formError && (
              <p
                aria-live="polite"
                style={{
                  margin: '0 0 0.75rem',
                  padding: '0.5rem 0.75rem',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-danger)',
                  background: 'var(--color-danger-bg)',
                  color: 'var(--color-danger)',
                  fontSize: '0.8125rem',
                }}
              >
                {formError}
              </p>
            )}

            <div className="flex items-center justify-end" style={{ gap: '0.5rem' }}>
              <TahiButton type="button" variant="secondary" size="sm" onClick={() => { setShowForm(false); setFormError(null) }}>
                Cancel
              </TahiButton>
              <TahiButton type="submit" variant="primary" size="sm" disabled={saving || !form.name.trim() || !form.email.trim()}>
                {saving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" aria-hidden="true" /> : null}
                Add contact
              </TahiButton>
            </div>
          </form>
        </Card>
      )}

      <Card padding="none">
        <DataTable<Contact>
          ariaLabel="Contacts"
          columns={columns}
          rows={contacts}
          getRowId={c => c.id}
          onRowClick={c => onOpenContact(c.id)}
          rowActions={actionsFor}
          mobileCard={c => (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '0.75rem' }}>
              <button
                type="button"
                onClick={() => onOpenContact(c.id)}
                className="tahi-focus-ring text-left flex items-center"
                style={{
                  gap: '0.5rem',
                  minHeight: '2.75rem',
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                <Avatar name={c.name} size="sm" tooltip={false} />
                <span className="flex flex-col" style={{ minWidth: 0 }}>
                  <span data-private style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)' }}>{c.name}</span>
                  <span data-private style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{c.email}</span>
                </span>
              </button>
              <div className="flex items-center flex-wrap" style={{ gap: '0.5rem' }}>
                {c.isPrimary && <Badge tone="brand" size="sm">Primary</Badge>}
                <Badge tone={c.clerkUserId ? 'positive' : 'neutral'} size="sm" dot>
                  {c.clerkUserId ? 'In the portal' : 'No access'}
                </Badge>
                <Badge tone={c.portalRole === 'admin' ? 'brand' : 'neutral'} size="sm">
                  {c.portalRole === 'admin' ? 'Admin' : 'Member'}
                </Badge>
              </div>
              {!writeDisabled && (
                <div className="flex items-center flex-wrap" style={{ gap: '0.5rem' }}>
                  <TahiButton
                    variant="secondary"
                    size="sm"
                    disabled={invites[c.id]?.status === 'sending'}
                    onClick={() => { void handleInvite(c) }}
                  >
                    {invites[c.id]?.status === 'sending'
                      ? 'Sending...'
                      : c.clerkUserId ? 'Resend invite' : 'Invite to portal'}
                  </TahiButton>
                  {invites[c.id]?.link && (
                    <TahiButton
                      variant="secondary"
                      size="sm"
                      onClick={() => { void handleCopyLink(c.id, invites[c.id].link) }}
                      iconLeft={copied === c.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    >
                      {copied === c.id ? 'Copied' : 'Copy link'}
                    </TahiButton>
                  )}
                </div>
              )}
              {invites[c.id]?.status === 'failed' && (
                <p aria-live="polite" style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-danger)' }}>
                  {invites[c.id].error ?? 'The invite email did not send.'}
                </p>
              )}
            </div>
          )}
          empty={
            <EmptyState
              variant="inline"
              icon={<Users className="w-8 h-8" />}
              title="Nobody here yet"
              description={`Nobody at ${orgName} can sign in until someone is added. Add the first contact and send them a portal invite.`}
              ctaLabel={writeDisabled ? undefined : 'Add contact'}
              onCtaClick={writeDisabled ? undefined : () => setShowForm(true)}
            />
          }
        />
      </Card>

      {/* Any send that failed keeps its link on screen, not just in a toast. */}
      {Object.entries(invites).some(([, s]) => s.status === 'failed' && s.link) && (
        <Card padding="sm">
          <p style={{ margin: '0 0 0.5rem', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-danger)' }}>
            An invite email did not send. Copy the link and pass it on by hand.
          </p>
          <div className="flex flex-col" style={{ gap: '0.375rem' }}>
            {Object.entries(invites)
              .filter(([, s]) => s.status === 'failed' && s.link)
              .map(([id, s]) => {
                const c = contacts.find(x => x.id === id)
                return (
                  <div key={id} className="flex items-center flex-wrap" style={{ gap: '0.5rem' }}>
                    <span data-private style={{ fontSize: '0.8125rem', color: 'var(--color-text)' }}>
                      {c?.name ?? 'Contact'}
                    </span>
                    <TahiButton
                      variant="secondary"
                      size="sm"
                      onClick={() => { void handleCopyLink(id, s.link) }}
                      iconLeft={copied === id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    >
                      {copied === id ? 'Copied' : 'Copy invite link'}
                    </TahiButton>
                  </div>
                )
              })}
          </div>
        </Card>
      )}

      <SlideOver
        open={open != null}
        onClose={() => onOpenContact(null)}
        title={open?.name ?? 'Contact'}
        subtitle={open ? `${open.role ?? 'Contact'} at ${orgName}` : undefined}
      >
        <SlideOver.Body>
          {open && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="flex items-center" style={{ gap: '0.75rem' }}>
                <Avatar name={open.name} size="lg" tooltip={false} />
                <div className="flex flex-col" style={{ minWidth: 0 }}>
                  <span data-private style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-text)' }}>{open.name}</span>
                  <span data-private style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{open.email}</span>
                </div>
              </div>

              <dl style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', margin: 0 }}>
                <div className="flex items-center justify-between flex-wrap" style={{ gap: '0.5rem' }}>
                  <dt style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Portal role</dt>
                  <dd style={{ margin: 0 }}>
                    <Badge tone={open.portalRole === 'admin' ? 'brand' : 'neutral'} size="sm">
                      {open.portalRole === 'admin' ? 'Admin' : 'Member'}
                    </Badge>
                  </dd>
                </div>
                <div className="flex items-center justify-between flex-wrap" style={{ gap: '0.5rem' }}>
                  <dt style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Access</dt>
                  <dd style={{ margin: 0 }}>
                    <Badge tone={open.clerkUserId ? 'positive' : 'neutral'} size="sm" dot>
                      {open.clerkUserId ? 'In the portal' : 'No access yet'}
                    </Badge>
                  </dd>
                </div>
                <div className="flex items-center justify-between flex-wrap" style={{ gap: '0.5rem' }}>
                  <dt style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Last seen</dt>
                  <dd style={{ margin: 0, fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)' }}>
                    {lastSeenLabel(open.lastLoginAt)}
                  </dd>
                </div>
                <div className="flex items-center justify-between flex-wrap" style={{ gap: '0.5rem' }}>
                  <dt style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Primary</dt>
                  <dd style={{ margin: 0, fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)' }}>
                    {open.isPrimary
                      ? 'Yes, gets the invoices and the invite'
                      : (writeDisabled
                        ? 'No'
                        : (
                          <TahiButton variant="secondary" size="sm" disabled={busyId === open.id} onClick={() => { void makePrimary(open) }}>
                            Make primary
                          </TahiButton>
                        ))}
                  </dd>
                </div>
              </dl>

              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>
                {open.portalRole === 'admin'
                  ? `Admins administer the ${orgName} portal: they manage contacts and see everything the org is allowed to see.`
                  : 'Members only see their own scoped view of the portal.'}
              </p>
            </div>
          )}
        </SlideOver.Body>
        <SlideOver.Footer>
          {open && (
            <div className="flex items-center flex-wrap" style={{ gap: '0.5rem' }}>
              {!writeDisabled && (
                <TahiButton
                  variant="primary"
                  size="sm"
                  disabled={invites[open.id]?.status === 'sending'}
                  onClick={() => { void handleInvite(open) }}
                  iconLeft={<Mail className="w-3.5 h-3.5" />}
                >
                  {open.clerkUserId ? 'Resend invite' : 'Send portal invite'}
                </TahiButton>
              )}
              {!writeDisabled && (
                <TahiButton
                  variant="secondary"
                  size="sm"
                  disabled={busyId === open.id}
                  onClick={() => { void setPortalRole(open, open.portalRole === 'admin' ? 'member' : 'admin') }}
                  iconLeft={<Shield className="w-3.5 h-3.5" />}
                >
                  {open.portalRole === 'admin' ? 'Make a member' : 'Make an admin'}
                </TahiButton>
              )}
            </div>
          )}
        </SlideOver.Footer>
      </SlideOver>
    </div>
  )
}
