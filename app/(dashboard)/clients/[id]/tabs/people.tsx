'use client'

/**
 * The client People tab: the seats at this client, what each one can do in
 * the portal, and the only in-product way to hand someone a login.
 *
 * The invite machinery is kept whole from the old Contacts tab, including the
 * copy-link fallback: when Resend is down or the address bounces, the link is
 * still the operator's only recovery, so it stays on screen after a failure
 * instead of being swallowed by a toast.
 *
 * Edit, delete and merge live here too. Delete and merge are told what they
 * will move BEFORE they are confirmed: the dialog reads
 * /api/admin/contacts/[id]/references and names every request, message and
 * file that points at the row, because "3 requests, 2 messages" is the
 * difference between a tidy-up and a mistake. A row that shares its email
 * with another row at the same client is flagged as a duplicate and offers
 * the merge directly.
 */

import { useMemo, useState } from 'react'
import {
  Check,
  Copy,
  GitMerge,
  Link2,
  Loader2,
  Mail,
  Pencil,
  Plus,
  Shield,
  Star,
  Trash2,
  UserRound,
  Users,
} from 'lucide-react'
import { apiPath } from '@/lib/api'
import { Avatar } from '@/components/tahi/avatar'
import { Badge } from '@/components/tahi/badge'
import { Card } from '@/components/tahi/card'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
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

interface ReferenceCount {
  key: string
  singular: string
  plural: string
  count: number
}

interface ReferenceCandidate {
  id: string
  name: string
  email: string
  isPrimary: boolean
  clerkLinked: boolean
}

/** GET /api/admin/contacts/[id]/references */
interface ContactReferences {
  references: ReferenceCount[]
  total: number
  summary: string
  blockers: { clerkLinked: boolean; onlyPrimary: boolean }
  candidates: ReferenceCandidate[]
}

interface EditForm {
  name: string
  email: string
  phone: string
  role: string
  portalRole: 'admin' | 'member'
  isPrimary: boolean
}

interface DeleteState {
  contact: Contact
  refs: ContactReferences | null
  loading: boolean
  reassignTo: string
  error: string | null
}

interface MergeState {
  from: Contact
  into: Contact
  summary: string
  total: number
}

const INPUT_STYLE: React.CSSProperties = {
  padding: '0 0.75rem',
  borderRadius: 'var(--radius-input)',
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg)',
  color: 'var(--color-text)',
  fontSize: '0.8125rem',
}

const INPUT_CLASS = 'tahi-focus-ring min-h-[2.75rem] md:min-h-[2.25rem]'

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

function normaliseEmail(value: string): string {
  return value.trim().toLowerCase()
}

/** A labelled form control. Same look as every other field on this page. */
function Field({
  label,
  required,
  hint,
  children,
}: {
  label: React.ReactNode
  required?: boolean
  hint?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
        {label} {required && <span style={{ color: 'var(--color-danger)' }}>*</span>}
      </span>
      {children}
      {hint && <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>{hint}</span>}
    </label>
  )
}

function FormError({ children }: { children: React.ReactNode }) {
  return (
    <p
      aria-live="polite"
      style={{
        margin: 0,
        padding: '0.5rem 0.75rem',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-danger)',
        background: 'var(--color-danger-bg)',
        color: 'var(--color-danger)',
        fontSize: '0.8125rem',
      }}
    >
      {children}
    </p>
  )
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

  const [editing, setEditing] = useState<Contact | null>(null)
  const [editForm, setEditForm] = useState<EditForm>({ name: '', email: '', phone: '', role: '', portalRole: 'member', isPrimary: false })
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const [deleting, setDeleting] = useState<DeleteState | null>(null)
  const [merging, setMerging] = useState<MergeState | null>(null)

  const open = contacts.find(c => c.id === contactId) ?? null
  const inPortal = contacts.filter(c => c.clerkUserId).length

  /** Ids of rows that share a (case-insensitive) email with another row here. */
  const duplicateIds = useMemo(() => {
    const byEmail = new Map<string, string[]>()
    for (const c of contacts) {
      const key = normaliseEmail(c.email)
      if (!key) continue
      byEmail.set(key, [...(byEmail.get(key) ?? []), c.id])
    }
    const out = new Set<string>()
    for (const ids of byEmail.values()) {
      if (ids.length > 1) ids.forEach(id => out.add(id))
    }
    return out
  }, [contacts])

  function duplicatesOf(c: Contact): Contact[] {
    const key = normaliseEmail(c.email)
    if (!key) return []
    return contacts.filter(o => o.id !== c.id && normaliseEmail(o.email) === key)
  }

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

  // ── Edit ───────────────────────────────────────────────────────────────────

  function openEdit(contact: Contact) {
    setEditForm({
      name: contact.name,
      email: contact.email,
      phone: contact.phone ?? '',
      role: contact.role ?? '',
      portalRole: contact.portalRole === 'admin' ? 'admin' : 'member',
      isPrimary: Boolean(contact.isPrimary),
    })
    setEditError(null)
    setEditing(contact)
  }

  async function handleEditSave(e: React.FormEvent) {
    e.preventDefault()
    if (!editing) return
    if (!editForm.name.trim() || !editForm.email.trim()) return
    setEditSaving(true)
    setEditError(null)
    try {
      // The address of a contact that signs in is not ours to change (the
      // route refuses it too); leave it out rather than send a no-op.
      const body: Record<string, unknown> = {
        name: editForm.name,
        phone: editForm.phone,
        role: editForm.role,
        portalRole: editForm.portalRole,
        isPrimary: editForm.isPrimary,
      }
      if (!editing.clerkUserId) body.email = editForm.email
      const res = await fetch(apiPath(`/api/admin/contacts/${editing.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => null) as { error?: string } | null
        setEditError(json?.error ?? 'Could not save the contact')
        return
      }
      showToast(`${editForm.name.trim()} saved`, 'success')
      setEditing(null)
      onUpdated()
    } catch {
      setEditError('Network error. Please try again.')
    } finally {
      setEditSaving(false)
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  async function fetchReferences(id: string): Promise<ContactReferences> {
    const res = await fetch(apiPath(`/api/admin/contacts/${id}/references`))
    if (!res.ok) {
      const json = await res.json().catch(() => null) as { error?: string } | null
      throw new Error(json?.error ?? 'Could not check what references them')
    }
    return await res.json() as ContactReferences
  }

  async function startDelete(contact: Contact) {
    setDeleting({ contact, refs: null, loading: true, reassignTo: '', error: null })
    try {
      const refs = await fetchReferences(contact.id)
      setDeleting(prev => (prev && prev.contact.id === contact.id ? { ...prev, refs, loading: false } : prev))
    } catch (err) {
      setDeleting(prev => (prev && prev.contact.id === contact.id
        ? { ...prev, loading: false, error: err instanceof Error ? err.message : 'Could not check what references them' }
        : prev))
    }
  }

  async function confirmDelete() {
    if (!deleting || !deleting.refs) return
    const { contact, refs, reassignTo } = deleting
    const needsReassign = refs.total > 0 || refs.blockers.onlyPrimary
    if (needsReassign && !reassignTo) return
    setDeleting(prev => (prev ? { ...prev, loading: true, error: null } : prev))
    try {
      const res = await fetch(apiPath(`/api/admin/contacts/${contact.id}`), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reassignTo ? { reassignTo } : {}),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => null) as { error?: string } | null
        setDeleting(prev => (prev ? { ...prev, loading: false, error: json?.error ?? 'Could not delete the contact' } : prev))
        return
      }
      const target = refs.candidates.find(c => c.id === reassignTo)
      showToast(
        target ? `${contact.name} deleted; everything moved to ${target.name}` : `${contact.name} deleted`,
        'success',
      )
      setDeleting(null)
      if (contactId === contact.id) onOpenContact(null)
      onUpdated()
    } catch {
      setDeleting(prev => (prev ? { ...prev, loading: false, error: 'Network error. Please try again.' } : prev))
    }
  }

  // ── Merge ──────────────────────────────────────────────────────────────────

  async function startMerge(from: Contact, into: Contact) {
    setBusyId(from.id)
    try {
      const refs = await fetchReferences(from.id)
      setMerging({ from, into, summary: refs.summary, total: refs.total })
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not check what references them', 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function confirmMerge() {
    if (!merging) return
    const { from, into } = merging
    try {
      const res = await fetch(apiPath(`/api/admin/contacts/${from.id}/merge`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ into: into.id }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => null) as { error?: string } | null
        showToast(json?.error ?? 'Could not merge the contacts', 'error')
        return
      }
      showToast(`${from.name} merged into ${into.name}`, 'success')
      setMerging(null)
      if (contactId === from.id) onOpenContact(null)
      onUpdated()
    } catch {
      showToast('Could not merge the contacts', 'error')
    }
  }

  function mergeDescription(m: MergeState): string {
    const moves = m.total > 0
      ? `${m.from.name} is referenced by ${m.summary}; all of it moves to ${m.into.name}.`
      : `Nothing references ${m.from.name}.`
    return `${moves} ${m.into.name} keeps their own details and only fills a blank phone or role from ${m.from.name}. ${m.from.name} is then deleted. This cannot be undone.`
  }

  function actionsFor(c: Contact): DataTableAction[] {
    const out: DataTableAction[] = [
      { label: 'Open', icon: <UserRound className="w-3.5 h-3.5" />, onClick: () => onOpenContact(c.id) },
    ]
    if (writeDisabled) return out
    const busy = busyId === c.id
    out.push({
      label: 'Edit',
      icon: <Pencil className="w-3.5 h-3.5" />,
      disabled: busy,
      onClick: () => openEdit(c),
    })
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
    for (const other of duplicatesOf(c)) {
      out.push({
        label: `Merge into ${other.name}${other.isPrimary ? ' (primary)' : ''}`,
        icon: <GitMerge className="w-3.5 h-3.5" />,
        disabled: busy,
        onClick: () => { void startMerge(c, other) },
      })
    }
    out.push({
      label: 'Delete',
      icon: <Trash2 className="w-3.5 h-3.5" />,
      tone: 'danger',
      disabled: busy,
      onClick: () => { void startDelete(c) },
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
            <span className="flex items-center flex-wrap" style={{ gap: '0.375rem' }}>
              <span data-private className="truncate" style={{ fontWeight: 600, color: 'var(--color-text)' }}>{c.name}</span>
              {c.isPrimary && <Badge tone="brand" size="sm">Primary</Badge>}
              {duplicateIds.has(c.id) && <Badge tone="warning" size="sm">Duplicate</Badge>}
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

  const deleteNeedsReassign = deleting?.refs ? (deleting.refs.total > 0 || deleting.refs.blockers.onlyPrimary) : false
  const deleteBlocked = deleting?.refs
    ? deleting.refs.blockers.clerkLinked || (deleteNeedsReassign && deleting.refs.candidates.length === 0)
    : false

  return (
    <div className="flex flex-col" style={{ gap: '0.75rem' }}>
      <SubBar>
        <SectionTitle>Seats</SectionTitle>
        <CountText>
          {contacts.length} {contacts.length === 1 ? 'person' : 'people'}, {inPortal} in the portal
          {duplicateIds.size > 0 && `, ${duplicateIds.size} duplicate ${duplicateIds.size === 1 ? 'row' : 'rows'}`}
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
              <Field label="Name" required>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  required
                  placeholder="Jane Smith"
                  className={INPUT_CLASS}
                  style={INPUT_STYLE}
                />
              </Field>
              <Field label="Email" required>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  required
                  placeholder="jane@example.com"
                  className={INPUT_CLASS}
                  style={INPUT_STYLE}
                />
              </Field>
              <Field label={`Role at ${orgName}`}>
                <input
                  value={form.role}
                  onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                  placeholder="Marketing Manager"
                  className={INPUT_CLASS}
                  style={INPUT_STYLE}
                />
              </Field>
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
              <div style={{ marginBottom: '0.75rem' }}>
                <FormError>{formError}</FormError>
              </div>
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
                {duplicateIds.has(c.id) && <Badge tone="warning" size="sm">Duplicate</Badge>}
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
                  <TahiButton
                    variant="secondary"
                    size="sm"
                    disabled={busyId === c.id}
                    onClick={() => openEdit(c)}
                    iconLeft={<Pencil className="w-3.5 h-3.5" />}
                  >
                    Edit
                  </TahiButton>
                  {duplicatesOf(c).slice(0, 1).map(other => (
                    <TahiButton
                      key={other.id}
                      variant="secondary"
                      size="sm"
                      disabled={busyId === c.id}
                      onClick={() => { void startMerge(c, other) }}
                      iconLeft={<GitMerge className="w-3.5 h-3.5" />}
                    >
                      Merge into {other.name}
                    </TahiButton>
                  ))}
                  <TahiButton
                    variant="ghost"
                    size="sm"
                    disabled={busyId === c.id}
                    onClick={() => { void startDelete(c) }}
                    iconLeft={<Trash2 className="w-3.5 h-3.5" />}
                    style={{ color: 'var(--color-danger)' }}
                  >
                    Delete
                  </TahiButton>
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

      {/* Contact detail drawer */}
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
                  {open.phone && (
                    <span data-private style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{open.phone}</span>
                  )}
                </div>
              </div>

              {duplicateIds.has(open.id) && (
                <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-warning)' }}>
                  Another row at {orgName} shares this email. Merge them from the row actions.
                </p>
              )}

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
                  onClick={() => openEdit(open)}
                  iconLeft={<Pencil className="w-3.5 h-3.5" />}
                >
                  Edit
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

      {/* Edit drawer */}
      <SlideOver
        open={editing != null}
        onClose={() => { if (!editSaving) setEditing(null) }}
        title="Edit contact"
        subtitle={editing ? `${editing.name} at ${orgName}` : undefined}
        icon={<Pencil className="w-3.5 h-3.5" />}
      >
        <form onSubmit={handleEditSave} style={{ display: 'contents' }}>
          <SlideOver.Body>
            {editing && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <Field label="Name" required>
                  <input
                    value={editForm.name}
                    onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                    required
                    className={INPUT_CLASS}
                    style={INPUT_STYLE}
                  />
                </Field>
                <Field
                  label="Email"
                  required
                  hint={editing.clerkUserId
                    ? `${editing.name} signs in with this address. The login is the truth: change it in Clerk, or unlink them first.`
                    : undefined}
                >
                  <input
                    type="email"
                    value={editForm.email}
                    onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                    required
                    disabled={Boolean(editing.clerkUserId)}
                    aria-disabled={Boolean(editing.clerkUserId)}
                    className={INPUT_CLASS}
                    style={editing.clerkUserId
                      ? { ...INPUT_STYLE, opacity: 0.6, cursor: 'not-allowed', background: 'var(--color-bg-secondary)' }
                      : INPUT_STYLE}
                  />
                </Field>
                <Field label="Phone">
                  <input
                    type="tel"
                    value={editForm.phone}
                    onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))}
                    placeholder="+64 21 555 0100"
                    className={INPUT_CLASS}
                    style={INPUT_STYLE}
                  />
                </Field>
                <Field label={`Role at ${orgName}`}>
                  <input
                    value={editForm.role}
                    onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}
                    placeholder="Marketing Manager"
                    className={INPUT_CLASS}
                    style={INPUT_STYLE}
                  />
                </Field>
                <Field
                  label="Portal role"
                  hint={editForm.portalRole === 'admin'
                    ? `Administers the ${orgName} portal: manages contacts and sees everything the org is allowed to see.`
                    : 'Sees only their own scoped view of the portal.'}
                >
                  <select
                    value={editForm.portalRole}
                    onChange={e => setEditForm(f => ({ ...f, portalRole: e.target.value === 'admin' ? 'admin' : 'member' }))}
                    className={INPUT_CLASS}
                    style={{ ...INPUT_STYLE, cursor: 'pointer' }}
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                </Field>
                <label
                  className="flex items-center"
                  style={{ gap: '0.5rem', minHeight: '2.75rem', fontSize: '0.8125rem', color: 'var(--color-text-muted)', cursor: 'pointer' }}
                >
                  <input
                    type="checkbox"
                    checked={editForm.isPrimary}
                    onChange={e => setEditForm(f => ({ ...f, isPrimary: e.target.checked }))}
                    style={{ accentColor: 'var(--color-brand)', width: '0.875rem', height: '0.875rem' }}
                  />
                  Primary contact, gets the invoices and the invite
                </label>
                {editError && <FormError>{editError}</FormError>}
              </div>
            )}
          </SlideOver.Body>
          <SlideOver.Footer>
            <div className="flex items-center justify-end" style={{ gap: '0.5rem' }}>
              <TahiButton type="button" variant="secondary" size="sm" disabled={editSaving} onClick={() => setEditing(null)}>
                Cancel
              </TahiButton>
              <TahiButton
                type="submit"
                variant="primary"
                size="sm"
                disabled={editSaving || !editForm.name.trim() || !editForm.email.trim()}
              >
                {editSaving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" aria-hidden="true" /> : null}
                Save changes
              </TahiButton>
            </div>
          </SlideOver.Footer>
        </form>
      </SlideOver>

      {/* Delete dialog: says what moves, and to whom, before anything goes. */}
      <SlideOver
        open={deleting != null}
        onClose={() => { if (!deleting?.loading) setDeleting(null) }}
        variant="center"
        maxWidth="30rem"
        title={deleting ? `Delete ${deleting.contact.name}?` : 'Delete contact'}
        subtitle={deleting ? `${deleting.contact.email} at ${orgName}` : undefined}
        icon={<Trash2 className="w-3.5 h-3.5" />}
        contentKey={deleting?.refs ? 'ready' : 'checking'}
      >
        <SlideOver.Body>
          {deleting && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.8125rem', color: 'var(--color-text)' }}>
              {deleting.loading && !deleting.refs && (
                <p className="flex items-center" style={{ margin: 0, gap: '0.5rem', color: 'var(--color-text-muted)' }}>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  Checking what references them...
                </p>
              )}
              {deleting.refs && deleting.refs.blockers.clerkLinked && (
                <p style={{ margin: 0 }}>
                  {deleting.contact.name} signs in to the portal; a contact with a login cannot be deleted. Unlink them in Clerk first.
                </p>
              )}
              {deleting.refs && !deleting.refs.blockers.clerkLinked && (
                <>
                  <p style={{ margin: 0 }}>
                    {deleting.refs.total > 0
                      ? `${deleting.contact.name} is referenced by ${deleting.refs.summary}.`
                      : `Nothing references ${deleting.contact.name}.`}
                    {deleting.refs.blockers.onlyPrimary && ` They are the only primary contact at ${orgName}.`}
                  </p>
                  {deleteNeedsReassign && deleting.refs.candidates.length > 0 && (
                    <Field
                      label="Reassign everything to"
                      required
                      hint={deleting.refs.blockers.onlyPrimary
                        ? 'Every reference moves to them, and they become the primary contact.'
                        : 'Every reference moves to them before the row is deleted.'}
                    >
                      <select
                        value={deleting.reassignTo}
                        onChange={e => setDeleting(prev => (prev ? { ...prev, reassignTo: e.target.value } : prev))}
                        className={INPUT_CLASS}
                        style={{ ...INPUT_STYLE, cursor: 'pointer' }}
                      >
                        <option value="">Choose a contact</option>
                        {deleting.refs.candidates.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({c.email}){c.isPrimary ? ', primary' : ''}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                  {deleteNeedsReassign && deleting.refs.candidates.length === 0 && (
                    <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
                      There is nobody else at {orgName} to reassign to. Add another contact first.
                    </p>
                  )}
                  <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>
                    This cannot be undone.
                  </p>
                </>
              )}
              {deleting.error && <FormError>{deleting.error}</FormError>}
            </div>
          )}
        </SlideOver.Body>
        <SlideOver.Footer>
          <div className="flex items-center justify-end" style={{ gap: '0.5rem' }}>
            <TahiButton type="button" variant="secondary" size="sm" disabled={deleting?.loading} onClick={() => setDeleting(null)}>
              Cancel
            </TahiButton>
            {deleting?.refs && !deleteBlocked && (
              <TahiButton
                type="button"
                variant="danger"
                size="sm"
                disabled={deleting.loading || (deleteNeedsReassign && !deleting.reassignTo)}
                onClick={() => { void confirmDelete() }}
                iconLeft={deleting.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Trash2 className="w-3.5 h-3.5" />}
              >
                {deleteNeedsReassign ? 'Reassign and delete' : 'Delete contact'}
              </TahiButton>
            )}
          </div>
        </SlideOver.Footer>
      </SlideOver>

      <ConfirmDialog
        open={merging != null}
        title={merging ? `Merge ${merging.from.name} into ${merging.into.name}?` : 'Merge contacts'}
        description={merging ? mergeDescription(merging) : ''}
        confirmLabel="Merge contacts"
        variant="warning"
        onConfirm={confirmMerge}
        onCancel={() => setMerging(null)}
      />
    </div>
  )
}
