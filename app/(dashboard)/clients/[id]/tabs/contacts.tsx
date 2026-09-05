'use client'

/** The client Contacts tab: the roster, the add form, and the only in-product
 *  way to hand a client a portal login. */

import { useState } from 'react'
import { Check, Copy, Loader2, Mail, Plus, User, Users } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { EmptyState } from '@/components/tahi/empty-state'
import { TahiButton } from '@/components/tahi/tahi-button'
import { useToast } from '@/components/tahi/toast'
import { cn } from '@/lib/utils'
import type { Contact } from '../_kit/types'

// ── Contacts tab ───────────────────────────────────────────────────────────────

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

export function ContactsTab({
  clientId,
  contacts,
  onUpdated,
}: {
  clientId: string
  contacts: Contact[]
  onUpdated: () => void
}) {
  const { showToast } = useToast()
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', email: '', role: '', isPrimary: false })
  const [invites, setInvites] = useState<Record<string, InviteState>>({})
  const [copied, setCopied] = useState<string | null>(null)

  // Persona is deliberately NOT computed here. The mint route derives it from
  // the org's plan with personaForPlanType (lib/onboarding-invites.ts), which is
  // the same rule the welcome route and admin client creation use, so there is
  // one copy of it and it lives next to the data it reads. Importing that module
  // into this client component would pull db/d1 and the whole Drizzle schema
  // into the browser bundle, so the server owns the decision instead.

  const handleInvite = async (contact: Contact) => {
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
      const json = await res.json() as {
        error?: string
        link?: string
        emailed?: boolean
        emailError?: string
      }
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
      setInvites(prev => ({
        ...prev,
        [contact.id]: { status: 'failed', link: '', error: 'Network error' },
      }))
      showToast('Could not create the invite', 'error')
    }
  }

  const handleCopyLink = async (contactId: string, link: string) => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(contactId)
      showToast('Invite link copied', 'success')
      window.setTimeout(() => setCopied(c => (c === contactId ? null : c)), 2000)
    } catch {
      showToast('Could not copy the link', 'error')
    }
  }

  const handleAdd = async (e: React.FormEvent) => {
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

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-[var(--color-text)]">
          Contacts ({contacts.length})
        </h2>
        <TahiButton variant="primary" size="sm" onClick={() => setShowForm(s => !s)}>
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          Add contact
        </TahiButton>
      </div>

      {/* Add contact form */}
      {showForm && (
        <form
          onSubmit={handleAdd}
          className="bg-[var(--color-bg)] rounded-xl border border-[var(--color-border)] p-5 mb-4"
        >
          <h3 className="font-medium text-sm text-[var(--color-text)] mb-3">New contact</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label htmlFor="contact-name" className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
                Name <span className="text-[var(--color-danger)]">*</span>
              </label>
              <input
                id="contact-name"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                required
                placeholder="Jane Smith"
                className="w-full px-3 py-2 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] focus:border-transparent"
              />
            </div>
            <div>
              <label htmlFor="contact-email" className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
                Email <span className="text-[var(--color-danger)]">*</span>
              </label>
              <input
                id="contact-email"
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                required
                placeholder="jane@example.com"
                className="w-full px-3 py-2 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] focus:border-transparent"
              />
            </div>
            <div>
              <label htmlFor="contact-role" className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
                Role
              </label>
              <input
                id="contact-role"
                value={form.role}
                onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                placeholder="e.g. Marketing Manager"
                className="w-full px-3 py-2 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] focus:border-transparent"
              />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isPrimary}
                  onChange={e => setForm(f => ({ ...f, isPrimary: e.target.checked }))}
                  className="rounded border-[var(--color-border)] text-[var(--color-brand)] focus:ring-[var(--color-brand)]"
                />
                Primary contact
              </label>
            </div>
          </div>

          {formError && (
            <div aria-live="polite" className="text-sm text-[var(--color-danger)] bg-[var(--color-danger-bg)] border border-[var(--color-danger)] rounded-lg px-3 py-2 mb-3">
              {formError}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <TahiButton variant="secondary" size="sm" onClick={() => { setShowForm(false); setFormError(null) }}>
              Cancel
            </TahiButton>
            <TahiButton variant="primary" size="sm" disabled={saving || !form.name.trim() || !form.email.trim()}>
              {saving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                  Saving...
                </>
              ) : (
                'Add contact'
              )}
            </TahiButton>
          </div>
        </form>
      )}

      {/* Contact list */}
      {contacts.length === 0 ? (
        <EmptyState
          variant="inline"
          icon={<Users className="w-8 h-8" />}
          title="No contacts for this client yet"
          description="Add a contact to get started."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {contacts.map(contact => (
            <div
              key={contact.id}
              className="bg-[var(--color-bg)] rounded-xl border border-[var(--color-border)] p-4 hover:border-[var(--color-brand)] transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-[var(--color-brand-50)] flex items-center justify-center text-[var(--color-brand)] text-sm font-bold flex-shrink-0">
                  {contact.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span data-private className="text-sm font-medium text-[var(--color-text)] truncate">
                      {contact.name}
                    </span>
                    {contact.isPrimary && (
                      <span className="text-xs text-[var(--color-brand)] bg-[var(--color-brand-50)] px-1.5 py-0.5 rounded-full">
                        Primary
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-[var(--color-text-muted)] mt-1">
                    <Mail className="w-3 h-3 flex-shrink-0" />
                    <span data-private className="truncate">{contact.email}</span>
                  </div>
                  {contact.role && (
                    <div className="flex items-center gap-1 text-xs text-[var(--color-text-muted)] mt-0.5">
                      <User className="w-3 h-3 flex-shrink-0" />
                      <span data-private>{contact.role}</span>
                    </div>
                  )}
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className={cn(
                      'inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full',
                      contact.clerkUserId
                        ? 'bg-[var(--color-success-bg)] text-[var(--color-success)]'
                        : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-subtle)]'
                    )}>
                      <span className={cn('w-1.5 h-1.5 rounded-full', contact.clerkUserId ? 'bg-emerald-400' : 'bg-[var(--color-border)]')} />
                      {contact.clerkUserId ? 'Portal access' : 'No portal access'}
                    </span>
                  </div>

                  {/* Invite to portal. This is the only in-product way to hand a
                      client a login: it mints a tokened link bound to this
                      address and emails it. The copy-link fallback stays
                      available afterwards, because a failed send is the one
                      case where the operator needs the link by hand. */}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => { void handleInvite(contact) }}
                      disabled={invites[contact.id]?.status === 'sending'}
                      className="tahi-focus-ring inline-flex min-h-[2.75rem] items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2.5 text-xs font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-brand)] hover:text-[var(--color-brand)] disabled:cursor-not-allowed disabled:opacity-60 md:min-h-[1.875rem]"
                      aria-label={contact.clerkUserId
                        ? `Resend the portal invite to ${contact.name}`
                        : `Invite ${contact.name} to the portal`}
                    >
                      {invites[contact.id]?.status === 'sending'
                        ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                        : <Mail className="w-3 h-3" aria-hidden="true" />}
                      {invites[contact.id]?.status === 'sending'
                        ? 'Sending...'
                        : invites[contact.id]?.status === 'sent'
                          ? 'Invite sent'
                          : contact.clerkUserId
                            ? 'Resend invite'
                            : 'Invite to portal'}
                    </button>

                    {invites[contact.id]?.link && (
                      <button
                        onClick={() => { void handleCopyLink(contact.id, invites[contact.id].link) }}
                        className="tahi-focus-ring inline-flex min-h-[2.75rem] items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-brand)] hover:text-[var(--color-brand)] md:min-h-[1.875rem]"
                        aria-label={`Copy the invite link for ${contact.name}`}
                      >
                        {copied === contact.id
                          ? <Check className="w-3 h-3" aria-hidden="true" />
                          : <Copy className="w-3 h-3" aria-hidden="true" />}
                        {copied === contact.id ? 'Copied' : 'Copy link'}
                      </button>
                    )}
                  </div>

                  {invites[contact.id]?.status === 'failed' && (
                    <p aria-live="polite" className="mt-1.5 text-xs text-[var(--color-danger)]">
                      {invites[contact.id].error ?? 'Invite email did not send.'}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
