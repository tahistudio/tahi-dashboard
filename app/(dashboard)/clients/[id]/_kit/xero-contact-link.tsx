'use client'

import { useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import { Landmark, Link2 } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { ApiError } from '@/lib/swr-fetcher'
import { Card } from '@/components/tahi/card'
import { Callout } from '@/components/tahi/callout'
import { Input } from '@/components/tahi/input'
import { useFeature, usePermissions } from '@/components/tahi/permissions-context'
import { SlideOver } from '@/components/tahi/slide-over'
import { TahiButton } from '@/components/tahi/tahi-button'
import type { Contact, Organisation } from './types'

const MATCH_CONTACTS_PATH = '/api/admin/integrations/xero/match-contacts'
const CONTACT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface XeroContactMatch {
  xeroContactId: string
  xeroName: string
  xeroEmail: string | null
  matchedOrgId: string | null
  matchedOrgName: string | null
  confidence: 'linked' | 'suggested' | 'unmatched'
}

type ClientContacts = Pick<Contact, 'name' | 'email'>[]

export async function confirmXeroContact(orgId: string, contactId: string, replace = false): Promise<void> {
  const response = await fetch(apiPath(MATCH_CONTACTS_PATH), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orgId, xeroContactId: contactId, ...(replace ? { replace: true } : {}) }),
  })
  const result = await response.json() as { ok?: boolean; error?: string }
  if (!response.ok || result.ok !== true) {
    throw new Error(result.error ?? (response.status === 409
      ? 'This Xero contact is already linked to another client.'
      : 'Could not confirm the Xero contact link. Please try again.'))
  }
}

function ContactDetails({ org, contacts }: { org: Organisation; contacts: ClientContacts }) {
  return (
    <Card padding="sm" style={{ padding: '1rem' }}>
      <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.875rem', color: 'var(--color-text)', fontWeight: 700 }}>Client: {org.name}</h3>
      <p style={{ margin: '0 0 0.5rem', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Client contact emails</p>
      <ul style={{ margin: 0, paddingLeft: '1rem', fontSize: '0.8125rem', color: 'var(--color-text)', overflowWrap: 'anywhere' }}>
        {contacts.length > 0 ? contacts.map(contact => <li key={`${contact.name}:${contact.email}`}>{contact.name}: {contact.email || 'No email on this contact'}</li>) : <li>No contacts on this client</li>}
      </ul>
    </Card>
  )
}

export function XeroContactChoices({ org, contacts, matches, selectedId, onSelect, disabled = false }: {
  org: Organisation
  contacts: ClientContacts
  matches: XeroContactMatch[]
  selectedId: string
  onSelect: (id: string) => void
  disabled?: boolean
}) {
  const sorted = [...matches].sort((a, b) => Number(b.matchedOrgId === org.id) - Number(a.matchedOrgId === org.id))
  return (
    <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: '0.75rem', alignItems: 'start', minWidth: 0 }}>
      <ContactDetails org={org} contacts={contacts} />
      <fieldset style={{ margin: 0, padding: 0, border: 'none', minWidth: 0 }} disabled={disabled}>
        <legend style={{ marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: 700, color: 'var(--color-text)' }}>Xero contacts</legend>
        <div className="flex flex-col" style={{ gap: '0.5rem', maxHeight: '18rem', overflowY: 'auto' }}>
          {sorted.length === 0 ? (
            <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>No Xero contacts found. Paste a ContactID below to link it directly.</p>
          ) : sorted.map(match => {
            const conflict = match.confidence === 'linked' && match.matchedOrgId !== org.id
            const checked = selectedId.toLowerCase() === match.xeroContactId.toLowerCase()
            return (
              <label key={match.xeroContactId} className={`flex items-start rounded-lg border border-[var(--color-border)] focus-within:ring-2 focus-within:ring-[var(--color-brand)] ${checked ? 'bg-[var(--color-brand-50)] hover:bg-[var(--color-brand-100)]' : 'bg-[var(--color-bg)] hover:bg-[var(--color-bg-secondary)]'}`} style={{ gap: '0.5rem', padding: '0.75rem', minHeight: '2.75rem', flexShrink: 0, cursor: conflict ? 'not-allowed' : 'pointer', minWidth: 0 }}>
                <input type="radio" name="xero-contact" value={match.xeroContactId} checked={checked} disabled={conflict || disabled} onChange={() => onSelect(match.xeroContactId)} style={{ margin: '0.1875rem 0 0', accentColor: 'var(--color-brand)', flexShrink: 0 }} />
                <span className="flex flex-col" style={{ gap: '0.1875rem', minWidth: 0, overflowWrap: 'anywhere', fontSize: '0.8125rem', color: 'var(--color-text)' }}>
                  <strong>{match.xeroName}</strong>
                  <span>{match.xeroEmail || 'No email on this Xero contact'}</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{match.xeroContactId}</span>
                  {conflict ? <span style={{ color: 'var(--badge-danger-text)' }}>Already linked to another client: {match.matchedOrgName ?? match.matchedOrgId}</span> : match.matchedOrgId === org.id && <span style={{ color: 'var(--color-text-muted)' }}>{match.confidence === 'linked' ? 'Already linked to this client' : 'Suggested by name. Check the emails before confirming.'}</span>}
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>
    </div>
  )
}

export function XeroLinkDialog({ org, contacts, onClose, onUpdated }: { org: Organisation; contacts: ClientContacts; onClose: () => void; onUpdated: () => void }) {
  const { data, isLoading, error: readError, mutate } = useSWR<{ matches: XeroContactMatch[] }>(MATCH_CONTACTS_PATH, { revalidateOnFocus: false })
  const [contactId, setContactId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [linkedId, setLinkedId] = useState<string | null>(null)
  const [pendingReplacement, setPendingReplacement] = useState<string | null>(null)
  const footerRef = useRef<HTMLDivElement>(null)
  const trimmedId = contactId.trim().toLowerCase()
  const currentId = org.xeroContactId?.trim().toLowerCase()
  const matches = data?.matches ?? []
  const selected = matches.find(match => match.xeroContactId.toLowerCase() === trimmedId.toLowerCase())
  const current = matches.find(match => match.xeroContactId.toLowerCase() === currentId)
  const replacement = matches.find(match => match.xeroContactId.toLowerCase() === pendingReplacement)
  const conflict = selected?.confidence === 'linked' && selected.matchedOrgId !== org.id
  const readMessage = readError instanceof ApiError && typeof readError.info === 'object' && readError.info !== null && 'error' in readError.info && typeof readError.info.error === 'string'
    ? readError.info.error : 'Could not load Xero contacts. Retry, or paste a ContactID directly.'

  useEffect(() => {
    if (pendingReplacement) footerRef.current?.querySelector<HTMLButtonElement>('[data-xero-cancel-replacement]')?.focus()
  }, [pendingReplacement])

  async function confirm(replace = false, candidateId = trimmedId) {
    if (saving || linkedId || !CONTACT_ID_PATTERN.test(candidateId) || conflict) return
    if (currentId && currentId !== candidateId && !replace) {
      setError(null)
      setPendingReplacement(candidateId)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await confirmXeroContact(org.id, candidateId, replace)
      setLinkedId(candidateId)
      setPendingReplacement(null)
      void mutate()
      onUpdated()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not confirm the Xero contact link. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SlideOver open variant="center" maxWidth="44rem" title="Link Xero contact" subtitle={org.name} icon={<Link2 style={{ width: '1rem', height: '1rem' }} />} onClose={() => { if (!saving) onClose() }} contentKey={linkedId ? 'success' : pendingReplacement ? 'replacement' : 'contacts'}>
      <SlideOver.Body>
        <div className="flex flex-col" style={{ gap: '1rem', minWidth: 0, overflowWrap: 'anywhere' }} aria-busy={saving || isLoading}>
          {linkedId ? <div role="status"><Callout tone="success" title="Xero contact linked">{org.name} now uses {linkedId}.</Callout></div> : (
            <>
              <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>Compare the Xero name and email with this client&apos;s contacts before confirming. A suggested name match has not been verified.</p>
              {currentId && <Callout tone="info" title="Current Xero link">{current ? `${current.xeroName}, ${current.xeroEmail || 'no email on this Xero contact'}. ` : ''}{org.xeroContactId}</Callout>}
              {pendingReplacement ? (
                <Callout tone="warning" title="Replace current Xero contact?">
                  <p style={{ margin: '0 0 0.5rem' }}>New Xero link: {replacement ? `${replacement.xeroName}, ${replacement.xeroEmail || 'no email on this Xero contact'}. ` : ''}{pendingReplacement}</p>
                  <p style={{ margin: 0 }}>Replacing {org.xeroContactId} changes the contact used for future invoice pushes. Confirm the new contact&apos;s name and email before replacing this link.</p>
                </Callout>
              ) : <>
              {isLoading ? (
                <>
                  <ContactDetails org={org} contacts={contacts} />
                  <div role="status" className="animate-pulse" style={{ padding: '1rem', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)' }}>Loading Xero contacts...</div>
                </>
              ) : readError ? (
                <>
                  <ContactDetails org={org} contacts={contacts} />
                  <div role="alert"><Callout tone="danger" title="Xero contacts unavailable">{readMessage}</Callout></div>
                  <TahiButton variant="secondary" style={{ minHeight: '2.75rem' }} onClick={() => { void mutate() }} disabled={saving}>Retry contacts</TahiButton>
                </>
              ) : (
                <XeroContactChoices org={org} contacts={contacts} matches={matches} selectedId={trimmedId} onSelect={id => { setContactId(id); setError(null) }} disabled={saving} />
              )}
              <form id="xero-contact-link" onSubmit={event => { event.preventDefault(); void confirm() }} className="flex flex-col" style={{ gap: '0.375rem' }}>
                <label htmlFor="xero-link-contact-id" style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)' }}>Xero ContactID</label>
                <Input id="xero-link-contact-id" value={contactId} onChange={event => { setContactId(event.target.value); setError(null) }} placeholder="Paste a ContactID from Xero" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={128} disabled={saving} aria-describedby="xero-link-contact-hint" style={{ minHeight: '2.75rem' }} />
                <p id="xero-link-contact-hint" style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{selected ? `Selected: ${selected.xeroName}, ${selected.xeroEmail || 'no email on this Xero contact'}.` : 'You can paste a ContactID directly. Check its name and email in Xero if it is not in the list.'}</p>
                {trimmedId && !CONTACT_ID_PATTERN.test(trimmedId) && <p role="status" style={{ margin: 0, fontSize: '0.75rem', color: 'var(--badge-danger-text)' }}>Enter the full ContactID from Xero, including its hyphens.</p>}
              </form>
              {conflict && <div role="alert"><Callout tone="danger" title="Link blocked">This Xero contact is already linked to another client: {selected.matchedOrgName ?? selected.matchedOrgId}.</Callout></div>}
              </>}
              {error && <div role="alert"><Callout tone="danger" title="Could not link contact">{error}</Callout></div>}
            </>
          )}
        </div>
      </SlideOver.Body>
      <SlideOver.Footer>
        <div ref={footerRef} className="flex flex-wrap items-center justify-end" style={{ gap: '0.75rem' }}>
          {linkedId ? <TahiButton style={{ minHeight: '2.75rem' }} onClick={onClose}>Done</TahiButton> : pendingReplacement ? <><TahiButton data-xero-cancel-replacement variant="secondary" style={{ minHeight: '2.75rem' }} disabled={saving} onClick={() => { setPendingReplacement(null); setError(null) }}>Cancel replacement</TahiButton><TahiButton style={{ minHeight: '2.75rem' }} disabled={saving || conflict} loading={saving} onClick={() => { void confirm(true, pendingReplacement) }}>{saving ? 'Replacing contact...' : 'Replace Xero link'}</TahiButton></> : <><TahiButton variant="secondary" style={{ minHeight: '2.75rem' }} disabled={saving} onClick={onClose}>Cancel</TahiButton><TahiButton type="submit" form="xero-contact-link" style={{ minHeight: '2.75rem' }} disabled={saving || !CONTACT_ID_PATTERN.test(trimmedId) || conflict} loading={saving}>{saving ? 'Linking contact...' : 'Confirm link'}</TahiButton></>}
        </div>
      </SlideOver.Footer>
    </SlideOver>
  )
}

export function XeroContactLink({ org, contacts, onUpdated }: { org: Organisation; contacts: ClientContacts; onUpdated: () => void }) {
  const { isAdmin } = usePermissions()
  const canIntegrations = useFeature('settings.integrations')
  const [open, setOpen] = useState(false)
  if (!isAdmin || !canIntegrations) return null
  return (
    <>
      <Card padding="sm" style={{ padding: '1rem' }}>
        <div className="flex flex-wrap items-center justify-between" style={{ gap: '0.75rem' }}>
          <div className="flex items-center" style={{ gap: '0.75rem', minWidth: 0, flex: '1 1 12rem' }}>
            <span className="inline-flex items-center justify-center shrink-0" style={{ width: '2.5rem', height: '2.5rem', borderRadius: 'var(--radius-leaf-sm)', color: 'var(--color-brand)', background: 'var(--color-brand-50)' }}><Landmark aria-hidden style={{ width: '1.125rem', height: '1.125rem' }} /></span>
            <div className="flex flex-col" style={{ gap: '0.1875rem', minWidth: 0 }}>
              <h3 style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-text)', fontWeight: 700 }}>Xero contact</h3>
              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-muted)', overflowWrap: 'anywhere' }}>{org.xeroContactId ? `Linked to ${org.xeroContactId}` : 'Connect an existing Xero contact before pushing invoices.'}</p>
            </div>
          </div>
          <TahiButton variant="secondary" style={{ minHeight: '2.75rem' }} onClick={() => setOpen(true)} disabled={org.status === 'archived'} iconLeft={<Link2 style={{ width: '1rem', height: '1rem' }} />}>{org.xeroContactId ? 'Change Xero contact' : 'Link Xero contact'}</TahiButton>
        </div>
      </Card>
      {open && <XeroLinkDialog org={org} contacts={contacts} onClose={() => setOpen(false)} onUpdated={onUpdated} />}
    </>
  )
}
