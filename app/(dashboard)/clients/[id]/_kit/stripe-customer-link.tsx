'use client'

import { useState } from 'react'
import { CreditCard, Link2 } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { Card } from '@/components/tahi/card'
import { Callout } from '@/components/tahi/callout'
import { Input } from '@/components/tahi/input'
import { usePermissions } from '@/components/tahi/permissions-context'
import { SlideOver } from '@/components/tahi/slide-over'
import { TahiButton } from '@/components/tahi/tahi-button'
import type { Organisation } from './types'

export interface StripeLinkPreview {
  canApply: boolean
  conflicts: string[]
  previewKey: string
  client: {
    id: string
    name: string
    stripeCustomerId: string | null
    contacts: { name: string; email: string }[]
  }
  customer: { id: string; name: string | null; email: string | null; livemode: boolean }
  linkedClients: { id: string; name: string }[]
  alreadyLinked: boolean
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col" style={{ gap: '0.1875rem', minWidth: 0 }}>
      <dt style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{label}</dt>
      <dd style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-text)', overflowWrap: 'anywhere' }}>{children}</dd>
    </div>
  )
}

export function StripeLinkPreviewDetails({ preview }: { preview: StripeLinkPreview }) {
  return (
    <div className="flex flex-col" style={{ gap: '1rem', overflowWrap: 'anywhere' }}>
      <Card padding="sm">
        <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', fontWeight: 700, color: 'var(--color-text)' }}>Client</h3>
        <dl className="flex flex-col" style={{ margin: 0, gap: '0.75rem' }}>
          <Detail label="Name">{preview.client.name}</Detail>
          <Detail label="Current Stripe customer">{preview.client.stripeCustomerId ?? 'Not linked'}</Detail>
          <Detail label="Contacts">
            {preview.client.contacts.length > 0
              ? preview.client.contacts.map(contact => `${contact.name} (${contact.email})`).join(', ')
              : 'No contacts on this client'}
          </Detail>
        </dl>
      </Card>
      <Card padding="sm">
        <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', fontWeight: 700, color: 'var(--color-text)' }}>Stripe customer</h3>
        <dl className="flex flex-col" style={{ margin: 0, gap: '0.75rem' }}>
          <Detail label="Customer ID">{preview.customer.id}</Detail>
          <Detail label="Name">{preview.customer.name ?? 'No name on this customer'}</Detail>
          <Detail label="Email">{preview.customer.email ?? 'No email on this customer'}</Detail>
          <Detail label="Mode">{preview.customer.livemode ? 'Live' : 'Test'}</Detail>
          <Detail label="Linked clients">
            {preview.linkedClients.length > 0 ? preview.linkedClients.map(client => client.name).join(', ') : 'No clients linked yet'}
          </Detail>
        </dl>
      </Card>
      {preview.conflicts.length > 0 && (
        <div role="alert">
          <Callout tone="danger" title="Link blocked">
            <ul style={{ margin: '0.375rem 0 0', paddingLeft: '1rem' }}>
              {preview.conflicts.map(conflict => <li key={conflict}>{conflict}</li>)}
            </ul>
          </Callout>
        </div>
      )}
      {preview.alreadyLinked && <Callout tone="success" title="Already linked">This client already uses this Stripe customer.</Callout>}
      {preview.canApply && !preview.alreadyLinked && (
        <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
          Check the customer and contact details, then confirm this link for {preview.client.name}.
        </p>
      )}
    </div>
  )
}

function StripeLinkDialog({ org, onClose, onUpdated }: { org: Organisation; onClose: () => void; onUpdated: () => void }) {
  const [customerId, setCustomerId] = useState('')
  const [preview, setPreview] = useState<StripeLinkPreview | null>(null)
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [linkedId, setLinkedId] = useState<string | null>(null)
  const trimmedId = customerId.trim()
  const validId = /^cus_[A-Za-z0-9]{1,124}$/.test(trimmedId)
  const canConfirm = preview?.canApply === true && !preview.alreadyLinked && !!preview.previewKey

  async function previewLink() {
    if (!validId || busy) return
    setBusy('preview')
    setError(null)
    setPreview(null)
    try {
      const response = await fetch(apiPath('/api/admin/integrations/stripe/link-customer'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId: org.id, stripeCustomerId: trimmedId, dryRun: true }),
      })
      const result = await response.json() as StripeLinkPreview & { error?: string }
      if (!response.ok) throw new Error(result.error ?? 'Could not preview this Stripe customer.')
      if (!result.previewKey || result.client?.id !== org.id || result.customer?.id !== trimmedId) {
        throw new Error('Could not verify the preview. Please preview the customer again.')
      }
      setPreview(result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not reach Stripe. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  async function confirmLink() {
    if (!preview || !canConfirm || busy) return
    setBusy('apply')
    setError(null)
    try {
      const response = await fetch(apiPath('/api/admin/integrations/stripe/link-customer'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId: org.id, stripeCustomerId: preview.customer.id, dryRun: false, previewKey: preview.previewKey }),
      })
      const result = await response.json() as { error?: string; dryRun?: boolean; applied?: boolean; alreadyLinked?: boolean }
      if (!response.ok) throw new Error(result.error ?? 'Could not confirm the link. Preview again to check the current mapping.')
      if (result.dryRun !== false || (result.applied !== true && result.alreadyLinked !== true)) {
        throw new Error('Could not confirm the link. Preview again to check the current mapping.')
      }
      setLinkedId(preview.customer.id)
      onUpdated()
    } catch (cause) {
      setPreview(null)
      setError(cause instanceof Error ? cause.message : 'Could not confirm the link. Preview again to check the current mapping.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <SlideOver
      open
      variant="center"
      maxWidth="34rem"
      title="Link Stripe customer"
      subtitle={org.name}
      icon={<Link2 style={{ width: '1rem', height: '1rem' }} />}
      onClose={() => { if (!busy) onClose() }}
      contentKey={linkedId ? 'success' : preview ? 'preview' : 'customer'}
    >
      <SlideOver.Body>
        <div className="flex flex-col" style={{ gap: '1rem', overflowWrap: 'anywhere' }} aria-busy={busy !== null}>
          {linkedId ? (
            <div role="status">
              <Callout tone="success" title="Stripe customer linked">{org.name} now uses {linkedId}.</Callout>
            </div>
          ) : preview ? <StripeLinkPreviewDetails preview={preview} /> : (
            <form id="stripe-customer-preview" onSubmit={event => { event.preventDefault(); void previewLink() }} className="flex flex-col" style={{ gap: '0.75rem' }}>
              <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                Enter the live Stripe customer ID. The preview shows who owns it before you confirm the link.
              </p>
              <div className="flex flex-col" style={{ gap: '0.375rem' }}>
                <label htmlFor="stripe-link-customer-id" style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)' }}>Stripe customer ID</label>
                <Input
                  id="stripe-link-customer-id"
                  value={customerId}
                  onChange={event => { setCustomerId(event.target.value); setError(null) }}
                  placeholder="cus_..."
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={128}
                  disabled={busy !== null}
                  aria-describedby="stripe-link-customer-hint"
                  style={{ minHeight: '2.75rem' }}
                />
                <p id="stripe-link-customer-hint" style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>
                  Copy the ID from the customer page in Stripe. It begins with cus_.
                </p>
              </div>
            </form>
          )}
          {error && <div role="alert"><Callout tone="danger" title="Could not link customer">{error}</Callout></div>}
        </div>
      </SlideOver.Body>
      <SlideOver.Footer>
        <div className="flex flex-wrap items-center justify-end" style={{ gap: '0.75rem' }}>
          {linkedId || preview?.alreadyLinked ? (
            <TahiButton onClick={onClose} style={{ minHeight: '2.75rem' }}>Done</TahiButton>
          ) : (
            <>
              <TahiButton variant="secondary" disabled={busy !== null} style={{ minHeight: '2.75rem' }} onClick={() => {
                if (preview) { setPreview(null); setError(null) } else onClose()
              }}>{preview ? 'Change customer' : 'Cancel'}</TahiButton>
              {preview ? (
                <TahiButton disabled={!canConfirm || busy !== null} loading={busy === 'apply'} style={{ minHeight: '2.75rem' }} onClick={() => { void confirmLink() }}>
                  {busy === 'apply' ? 'Linking customer...' : 'Confirm link'}
                </TahiButton>
              ) : (
                <TahiButton type="submit" form="stripe-customer-preview" disabled={!validId || busy !== null} loading={busy === 'preview'} style={{ minHeight: '2.75rem' }}>
                  {busy === 'preview' ? 'Loading preview...' : 'Preview customer'}
                </TahiButton>
              )}
            </>
          )}
        </div>
      </SlideOver.Footer>
    </SlideOver>
  )
}

export function StripeCustomerLink({ org, onUpdated }: { org: Organisation; onUpdated: () => void }) {
  const { isSuperAdmin } = usePermissions()
  const [open, setOpen] = useState(false)
  if (!isSuperAdmin) return null

  return (
    <>
      <Card padding="sm">
        <div className="flex flex-wrap items-center justify-between" style={{ gap: '0.75rem' }}>
          <div className="flex items-center" style={{ gap: '0.75rem', minWidth: 0, flex: '1 1 12rem' }}>
            <span className="inline-flex items-center justify-center shrink-0" style={{ width: '2.5rem', height: '2.5rem', borderRadius: 'var(--radius-leaf-sm)', color: 'var(--color-brand)', background: 'var(--color-brand-50)' }}>
              <CreditCard aria-hidden style={{ width: '1.125rem', height: '1.125rem' }} />
            </span>
            <div className="flex flex-col" style={{ gap: '0.1875rem', minWidth: 0 }}>
              <h3 style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-text)', fontWeight: 700 }}>Stripe customer</h3>
              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-muted)', overflowWrap: 'anywhere' }}>
                {org.stripeCustomerId ? `Linked to ${org.stripeCustomerId}` : 'Connect an existing live customer to this client.'}
              </p>
            </div>
          </div>
          <TahiButton variant="secondary" style={{ minHeight: '2.75rem' }} onClick={() => setOpen(true)} disabled={org.status === 'archived'} iconLeft={<Link2 style={{ width: '1rem', height: '1rem' }} />}>
            Link Stripe customer
          </TahiButton>
        </div>
      </Card>
      {open && <StripeLinkDialog org={org} onClose={() => setOpen(false)} onUpdated={onUpdated} />}
    </>
  )
}
