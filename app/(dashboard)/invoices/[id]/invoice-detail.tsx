'use client'

import { useState, useCallback, useEffect } from 'react'
import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, RefreshCw, FileText, Sparkles, Send, X, CreditCard, Mail, Lock, ExternalLink } from 'lucide-react'
import { SourceBadge } from '../source-badge'
import { Breadcrumb } from '@/components/tahi/breadcrumb'
import { Card } from '@/components/tahi/card'
import { EmptyState } from '@/components/tahi/empty-state'
import { ApiError } from '@/lib/swr-fetcher'
import {
  portalAdminLabel,
  portalMoneyDenial,
  portalInvoiceDenialCopy,
  type PortalPersonSummary,
} from '@/lib/portal-admin-label'
import { apiPath } from '@/lib/api'
import { useToast } from '@/components/tahi/toast'
import { useImpersonation } from '@/components/tahi/impersonation-banner'
import { formatCurrency } from '@/lib/currency'
import { useDisplayCurrency } from '@/lib/display-currency-context'
import { invoiceReference } from '@/lib/invoice-billing'

// ─── Types ────────────────────────────────────────────────────────────────────

interface InvoiceRow {
  id: string
  orgId: string
  orgName: string | null
  projectId: string | null
  subscriptionId: string | null
  // Admin projection only. The portal projection deliberately withholds the
  // Stripe / Xero ids, so these are absent for a client audience.
  stripeInvoiceId?: string | null
  xeroInvoiceId?: string | null
  // Stripe hosted invoice page, served to the client so they can pay.
  payUrl?: string | null
  // The same page under its column name on the admin projection, so the
  // studio can open what the client sees without a round trip to Stripe.
  stripeHostedInvoiceUrl?: string | null
  // Xero's own client-facing pay page, captured by the syncs once the invoice
  // is approved in Xero. Admin projection only: on the portal it is folded
  // into payUrl, because the client does not care which rail issued the link.
  xeroOnlineInvoiceUrl?: string | null
  source: string | null
  status: string
  /**
   * The real invoice number (migration 0096). NULL on everything raised before
   * it existed, so it is always read through invoiceReference, which falls back
   * to the short id.
   */
  number?: string | null
  amountUsd: number
  taxAmountUsd: number | null
  discountAmountUsd: number | null
  totalUsd: number
  currency: string | null
  notes: string | null
  dueDate: string | null
  sentAt: string | null
  viewedAt: string | null
  paidAt: string | null
  createdAt: string
  updatedAt: string
}

interface LineItem {
  id: string
  invoiceId: string
  description: string
  quantity: number | null
  unitPriceUsd: number
  totalUsd: number
}

// ─── Config ───────────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; bg: string; text: string }> = {
  draft:        { label: 'Draft',       bg: 'var(--status-draft-bg)', text: 'var(--status-draft-text)' },
  sent:         { label: 'Sent',        bg: 'var(--status-submitted-bg)', text: 'var(--status-submitted-text)' },
  viewed:       { label: 'Viewed',      bg: 'var(--status-submitted-bg)', text: 'var(--status-submitted-text)' },
  overdue:      { label: 'Overdue',     bg: 'var(--color-danger-bg)', text: 'var(--color-danger)' },
  paid:         { label: 'Paid',        bg: 'var(--color-success-bg)', text: 'var(--color-success)' },
  written_off:  { label: 'Written Off', bg: 'var(--status-archived-bg)', text: 'var(--status-archived-text)' },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatInvoiceCurrency(amount: number, currency: string | null): string {
  return formatCurrency(amount, currency ?? 'NZD')
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '--'
  try {
    const d = new Date(dateStr.includes('T') ? dateStr : dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch { return '--' }
}

function isOverdue(dueDate: string | null, status: string): boolean {
  if (!dueDate || status === 'paid' || status === 'written_off') return false
  return new Date(dueDate + 'T23:59:59') < new Date()
}

function effectiveStatus(invoice: InvoiceRow): string {
  if (isOverdue(invoice.dueDate, invoice.status) && invoice.status === 'sent') return 'overdue'
  return invoice.status
}

// ─── Push-back ────────────────────────────────────────────────────────────────
//
// PATCH /api/admin/invoices/[id] tells the rail about a hand mark-paid and
// reports what the rail did. Until now this page threw that body away, so the
// two near-certain outcomes in the first weeks (no Xero payment account code
// in settings, and a Xero invoice still sitting at DRAFT) were invisible to
// the person who had just clicked the button: the dashboard said paid, Xero
// kept chasing the client, and only the audit log knew.

interface PushbackOutcome {
  rail: 'xero' | 'stripe'
  status: 'done' | 'skipped' | 'failed'
  reason?: string
}

type ToastTone = 'success' | 'error' | 'info' | 'warning'

interface PushbackCopy {
  /** The glance signal. Short on purpose: see below. */
  toast: string
  tone: ToastTone
  /**
   * The sentence that carries the REASON, or null when there is nothing to
   * explain. Rendered persistently under the actions row rather than in the
   * toast, because the toast clips: components/tahi/toast.tsx caps the surface
   * at 22rem and renders the message on one nowrap line with an ellipsis, then
   * dismisses it after 3.5s. "Marked paid here. Xero was not told: No Xero
   * payment account code in settings" arrives as "Marked paid here. Xero was
   * not to..." and then leaves, which loses exactly the half a human can act on.
   */
  detail: string | null
}

/** What happened, said twice: once at a glance, once in full. */
function pushbackCopy(outcome: PushbackOutcome | undefined): PushbackCopy {
  // No rail to tell: a manual invoice that never reached Stripe or Xero. Not a
  // failure, and saying "and in Xero" would be a lie.
  if (!outcome) return { toast: 'Marked paid.', tone: 'success', detail: null }

  const rail = outcome.rail === 'xero' ? 'Xero' : 'Stripe'
  const reason = outcome.reason?.trim()

  if (outcome.status === 'done') {
    return { toast: `Marked paid in ${rail} too.`, tone: 'success', detail: null }
  }
  if (outcome.status === 'skipped') {
    return {
      toast: `Marked paid. ${rail} not told.`,
      tone: 'info',
      detail: `Marked paid here. ${rail} was not told: ${reason ?? 'no reason given'}`,
    }
  }
  return {
    toast: `Marked paid. ${rail} not updated.`,
    tone: 'warning',
    detail: `Marked paid here. ${rail} did not record the payment: ${reason ?? 'no reason given'}`,
  }
}

/**
 * Ink for a persistent outcome line, by tone.
 *
 * The badge inks rather than --color-warning / --color-success: those are
 * indicator colours (#fb923c reads at roughly 2.2:1 on the page, #4ade80 at
 * 1.6:1) and this is a sentence somebody has to read. The badge tokens are the
 * text-weight members of the same families and carry dark-mode overrides.
 */
const OUTCOME_INK: Record<ToastTone, string> = {
  success: 'var(--badge-positive-text)',
  info: 'var(--color-text-muted)',
  warning: 'var(--badge-warning-text)',
  error: 'var(--badge-danger-text)',
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface InvoiceDetailProps {
  invoiceId: string
  isAdmin: boolean
}

export function InvoiceDetail({ invoiceId, isAdmin: isAdminProp }: InvoiceDetailProps) {
  const router = useRouter()
  const { isImpersonatingClient } = useImpersonation()
  // Only switch to client view when impersonating a client, not a team member
  const isAdmin = isAdminProp && !isImpersonatingClient
  const { displayCurrency, formatNativeWithDisplay } = useDisplayCurrency()
  const { showToast } = useToast()
  const [patching, setPatching] = useState<string | null>(null)
  // The rail's answer to a hand mark-paid, kept on the page. The toast says it
  // at a glance and then goes; this is where the reason stays readable.
  const [pushback, setPushback] = useState<{ message: string; tone: ToastTone } | null>(null)

  // Audience-correct source. A client is not allowed on the admin route (it
  // 403s them), so the client branch reads the org-scoped portal detail route,
  // which returns the same { invoice, items } shape plus the pay link.
  const { data, isLoading: loading, error: fetchError, mutate } = useSWR<{ invoice?: InvoiceRow; items?: LineItem[] }>(
    isAdmin ? `/api/admin/invoices/${invoiceId}` : `/api/portal/invoices/${invoiceId}`
  )
  // A 403 on the CLIENT endpoint is a rule, not a failure. /api/portal/invoices
  // and its [id] sibling turn a member seat away by design, and this page used
  // to answer that with "Failed to load invoice." over a Retry that could never
  // succeed. Classify the body instead: the same three denials the list page
  // already explains, from the same helper, so the two pages cannot drift.
  const denial = !isAdmin && fetchError instanceof ApiError && fetchError.status === 403
    ? portalMoneyDenial(fetchError.info)
    : null
  // Who to ask, fetched only for the one denial whose copy names anybody.
  const { data: peopleData } = useSWR<{ items?: PortalPersonSummary[] }>(
    denial === 'member_seat' ? '/api/portal/people' : null,
  )
  const denialCopy = denial
    ? portalInvoiceDenialCopy(denial, portalAdminLabel(peopleData?.items))
    : null

  const invoice = data?.invoice ?? null
  const items = data?.items ?? []
  const error = !denial && (!!fetchError || (!loading && !data?.invoice))

  const patchStatus = useCallback(async (newStatus: string) => {
    if (!invoice) return
    setPatching(newStatus)
    setPushback(null)
    try {
      const paidAt = newStatus === 'paid' ? new Date().toISOString() : undefined
      const sentAt = newStatus === 'sent' ? new Date().toISOString() : undefined
      const body: Record<string, unknown> = { status: newStatus }
      if (paidAt) body.paidAt = paidAt
      if (sentAt) body.sentAt = sentAt
      const res = await fetch(apiPath(`/api/admin/invoices/${invoiceId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      // Read the body before the ok check: the route reports the rail's answer
      // in it, and an error carries the sentence that explains the refusal.
      const payload = await res.json().catch(() => ({})) as {
        error?: string
        pushback?: PushbackOutcome
      }
      if (!res.ok) throw new Error(payload.error ?? 'Could not update this invoice')
      await mutate()
      if (newStatus === 'paid') {
        const { toast, tone, detail } = pushbackCopy(payload.pushback)
        showToast(toast, tone)
        setPushback(detail ? { message: detail, tone } : null)
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update this invoice', 'error')
    } finally {
      setPatching(null)
    }
  }, [invoice, invoiceId, mutate, showToast])

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <div style={{ height: 32, width: 120, borderRadius: '0.5rem', background: 'var(--color-bg-tertiary)' }} className="animate-pulse" />
        <div style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)', padding: '1.75rem' }}>
          <div style={{ height: 40, width: 200, borderRadius: '0.5rem', background: 'var(--color-bg-tertiary)', marginBottom: '1rem' }} className="animate-pulse" />
          <div style={{ height: 20, width: 120, borderRadius: '0.5rem', background: 'var(--color-bg-tertiary)' }} className="animate-pulse" />
        </div>
      </div>
    )
  }

  // Denied, not broken. SWR clears isLoading on an error, so this sits safely
  // after the loading branch, and every hook above has already run.
  if (denialCopy) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'flex-start' }}>
        <Link href="/invoices" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.875rem', color: 'var(--color-text-muted)', textDecoration: 'none' }}>
          <ArrowLeft style={{ width: 14, height: 14 }} aria-hidden="true" />
          Back to Invoices
        </Link>
        <Card padding="none" style={{ width: '100%' }}>
          <EmptyState
            icon={<Lock className="w-6 h-6" />}
            title={denialCopy.title}
            description={denialCopy.description}
          />
        </Card>
      </div>
    )
  }

  if (error || !invoice) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'flex-start' }}>
        <Link href="/invoices" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.875rem', color: 'var(--color-text-muted)', textDecoration: 'none' }}>
          <ArrowLeft style={{ width: 14, height: 14 }} aria-hidden="true" />
          Back to Invoices
        </Link>
        <div style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)', padding: '3rem 1.5rem', textAlign: 'center', width: '100%' }}>
          <FileText style={{ width: 32, height: 32, color: 'var(--color-text-subtle)', margin: '0 auto 0.75rem' }} aria-hidden="true" />
          <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', marginBottom: 12 }}>
            {error ? 'Failed to load invoice.' : 'Invoice not found.'}
          </p>
          {error && (
            <button
              onClick={() => void mutate()}
              className="flex items-center gap-2 text-sm font-medium hover:opacity-80 transition-opacity mx-auto"
              style={{ color: 'var(--color-brand)', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              <RefreshCw style={{ width: 14, height: 14 }} aria-hidden="true" />
              Retry
            </button>
          )}
        </div>
      </div>
    )
  }

  const status = effectiveStatus(invoice)
  const statusCfg = STATUS_CFG[status] ?? STATUS_CFG['draft']

  // One pay page, two projections: the portal route calls it payUrl (already
  // folded, Stripe's page or Xero's), the admin route returns the Stripe
  // column under its own name and the Xero one alongside it.
  const payUrl = invoice.payUrl ?? invoice.stripeHostedInvoiceUrl ?? null
  // Xero's own client-facing page. Shown next to the Stripe one rather than
  // merged into it, because for the studio WHICH page the client is looking at
  // is the whole question: a Xero link only exists once Liam has approved the
  // invoice inside Xero, so its presence is the fastest read of that state.
  const xeroPayUrl = invoice.xeroOnlineInvoiceUrl ?? null

  const subtotal = items.reduce((s, it) => s + it.totalUsd, 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Breadcrumb */}
      <Breadcrumb
        items={[
          { label: 'Invoices', href: '/invoices' },
          { label: `INV-${invoiceId.slice(0, 6).toUpperCase()}` },
        ]}
      />

      {/* Invoice header card */}
      <div
        style={{
          background: 'var(--color-bg)',
          borderRadius: 'var(--radius-card)',
          border: '1px solid var(--color-border)',
          padding: '1.75rem 1.75rem 1.5rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '1rem',
            marginBottom: '1.5rem',
          }}
        >
          <div>
            <p data-private style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: '0.25rem' }}>
              {invoice.orgName ?? 'Unknown Client'}
            </p>
            <p
              data-private
              style={{
                fontSize: '2.25rem',
                fontWeight: 700,
                color: 'var(--color-text)',
                lineHeight: 1.1,
                letterSpacing: '-0.02em',
              }}
            >
              {formatInvoiceCurrency(invoice.totalUsd, invoice.currency)}
            </p>
            {invoice.currency && invoice.currency !== displayCurrency && invoice.totalUsd > 0 && (
              <p data-private style={{ fontSize: '0.8125rem', color: 'var(--color-text-subtle)', marginTop: '0.25rem' }}>
                {formatNativeWithDisplay(invoice.totalUsd, invoice.currency).split('\u2248 ')[1] ?? ''}
              </p>
            )}
          </div>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '0.25rem 0.75rem',
              borderRadius: 99,
              fontSize: '0.8125rem',
              fontWeight: 600,
              background: statusCfg.bg,
              color: statusCfg.text,
            }}
          >
            {statusCfg.label}
          </span>
        </div>

        {/* Metadata grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: '1rem 1.5rem',
            borderTop: '1px solid var(--color-border-subtle)',
            paddingTop: '1.25rem',
          }}
        >
          {/* The number when the row has one, the short id when it does not,
              and the label says which so nobody quotes a UUID fragment to Xero
              believing it is an invoice number. */}
          <MetaField
            label={invoice.number ? 'Invoice number' : 'Invoice ID'}
            value={invoiceReference(invoice.id, invoice.number)}
            isPrivate
          />
          <MetaField label="Created" value={formatDate(invoice.createdAt)} />
          <MetaField label="Due Date" value={formatDate(invoice.dueDate)} highlight={isOverdue(invoice.dueDate, invoice.status)} />
          {invoice.sentAt && <MetaField label="Sent" value={formatDate(invoice.sentAt)} />}
          {invoice.paidAt && <MetaField label="Paid" value={formatDate(invoice.paidAt)} />}
          {invoice.stripeInvoiceId && <MetaField label="Stripe ID" value={invoice.stripeInvoiceId} isPrivate />}
          {invoice.xeroInvoiceId && <MetaField label="Xero ID" value={invoice.xeroInvoiceId.slice(0, 8)} isPrivate />}
          <MetaField label="Source" value={<SourceBadge source={invoice.source} />} />
        </div>

        {/* Client pay CTA. Only for a bill that is actually payable, and only
            when Stripe has given us a hosted invoice page for it. */}
        {!isAdmin && payUrl && status !== 'paid' && status !== 'written_off' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              flexWrap: 'wrap',
              marginTop: '1.5rem',
              paddingTop: '1.25rem',
              borderTop: '1px solid var(--color-border-subtle)',
            }}
          >
            <a
              href={payUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="tahi-focus-ring"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '0.625rem 1.25rem',
                minHeight: '2.75rem',
                borderRadius: 'var(--radius-leaf-sm)',
                background: 'var(--color-brand)',
                color: 'var(--color-bg)',
                fontSize: '0.875rem',
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              <CreditCard style={{ width: 15, height: 15 }} aria-hidden="true" />
              Pay {formatInvoiceCurrency(invoice.totalUsd, invoice.currency)}
            </a>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>
              Secure payment page, hosted by Stripe.
            </span>
          </div>
        )}

        {/* The studio's view of the same page. "Copy Payment Link" below asks
            Stripe for it again; this is the link we already stored, visible
            without a click so Liam can see whether a bill is actually payable
            and open exactly what the client was sent.

            Both rails, side by side. A Xero pay page only exists once the
            invoice has been approved inside Xero (the push holds it at DRAFT
            on purpose), so an empty Xero slot on a Xero-rail invoice is the
            one-glance answer to "why has the client not paid this". */}
        {isAdmin && (payUrl || xeroPayUrl) && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem 1rem',
              flexWrap: 'wrap',
              marginTop: '1.25rem',
              paddingTop: '1.25rem',
              borderTop: '1px solid var(--color-border-subtle)',
            }}
          >
            {payUrl && <PayPageLink href={payUrl} label="Client pay page" />}
            {xeroPayUrl && <PayPageLink href={xeroPayUrl} label="Xero pay page" />}
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>
              What the client sees when they pay.
            </span>
          </div>
        )}

        {/* Admin actions */}
        {isAdmin && (
          <div
            style={{
              display: 'flex',
              gap: '0.75rem',
              flexWrap: 'wrap',
              marginTop: '1.5rem',
              paddingTop: '1.25rem',
              borderTop: '1px solid var(--color-border-subtle)',
            }}
          >
            {/* Sending means emailing them, not just flipping a column. The
                route mails every billing contact with the pay link and marks
                the invoice sent, so this replaces the old status-only PATCH.
                Withheld once the invoice is settled or voided: there is
                nothing left to chase. */}
            {invoice.status !== 'paid' && invoice.status !== 'written_off' && (
              <SendInvoiceEmailButton
                invoiceId={invoice.id}
                disabled={patching !== null}
                primary={invoice.status === 'draft'}
                onSent={() => void mutate()}
              />
            )}
            {(invoice.status === 'sent' || invoice.status === 'overdue') && (
              <ActionButton
                label={patching === 'paid' ? 'Marking...' : 'Mark as Paid'}
                disabled={patching !== null}
                onClick={() => patchStatus('paid')}
                variant="success"
              />
            )}
            {invoice.status !== 'draft' && invoice.status !== 'written_off' && invoice.status !== 'paid' && (
              <ActionButton
                label="Revert to Draft"
                disabled={patching !== null}
                onClick={() => patchStatus('draft')}
                variant="ghost"
              />
            )}
            {invoice.status !== 'written_off' && invoice.status !== 'paid' && (
              <ActionButton
                label="Void Invoice"
                disabled={patching !== null}
                onClick={() => {
                  if (confirm('Void this invoice? This will also void it in Xero if linked.')) {
                    patchStatus('written_off')
                  }
                }}
                variant="danger"
              />
            )}
            {!invoice.xeroInvoiceId && invoice.status !== 'paid' && (
              <ActionButton
                label="Sync to Xero"
                disabled={patching !== null}
                onClick={async () => {
                  try {
                    const res = await fetch(apiPath('/api/admin/invoices/xero-sync'), {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ invoiceIds: [invoice.id] }),
                    })
                    if (res.ok) {
                      void mutate()
                    } else {
                      const err = await res.json() as { error?: string }
                      alert(err.error ?? 'Xero sync failed. Reconnect Xero in Settings.')
                    }
                  } catch { alert('Xero sync failed. Check connection in Settings.') }
                }}
                variant="ghost"
              />
            )}
            {invoice.status !== 'paid' && !invoice.stripeInvoiceId && (
              <ActionButton
                label="Create Stripe Link"
                disabled={patching !== null}
                onClick={async () => {
                  try {
                    const res = await fetch(apiPath('/api/admin/invoices/stripe-create'), {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ invoiceId: invoice.id }),
                    })
                    if (res.ok) {
                      const data = await res.json() as { payUrl?: string }
                      if (data.payUrl) {
                        await navigator.clipboard.writeText(data.payUrl)
                        alert('Stripe invoice created - payment link copied to clipboard.')
                      }
                      void mutate()
                    } else {
                      // Surface the real Stripe error rather than a generic message.
                      // Most common cause: the client has no contact with email
                      // (Stripe rejects customer.create without one).
                      const err = await res.json().catch(() => ({})) as { error?: string; message?: string }
                      const detail = err.message || err.error || `HTTP ${res.status}`
                      alert(`Stripe invoice failed:\n\n${detail}\n\nIf this says "Missing email", add a contact with email on this client's Contacts tab.`)
                    }
                  } catch (err) {
                    alert(`Failed to create Stripe link: ${err instanceof Error ? err.message : 'unknown error'}`)
                  }
                }}
                variant="ghost"
              />
            )}
            {invoice.stripeInvoiceId && (
              <ActionButton
                label="Copy Payment Link"
                disabled={patching !== null}
                onClick={async () => {
                  try {
                    const res = await fetch(apiPath(`/api/admin/integrations/stripe/provision?invoiceId=${invoice.id}`))
                    if (res.ok) {
                      const data = await res.json() as { payUrl?: string }
                      if (data.payUrl) {
                        await navigator.clipboard.writeText(data.payUrl)
                        alert('Payment link copied!')
                      } else {
                        alert('No payment link available')
                      }
                    }
                  } catch { alert('Failed') }
                }}
                variant="ghost"
              />
            )}
            <ActionButton
              label="Delete Invoice"
              disabled={patching !== null}
              onClick={async () => {
                if (!confirm('Are you sure you want to delete this invoice? This cannot be undone.')) return
                try {
                  const res = await fetch(apiPath(`/api/admin/invoices/${invoice.id}`), { method: 'DELETE' })
                  if (res.ok) {
                    router.push('/invoices')
                  } else {
                    const err = await res.json() as { error?: string }
                    alert(err.error ?? 'Failed to delete invoice')
                  }
                } catch { alert('Failed to delete invoice') }
              }}
              variant="danger"
            />
          </div>
        )}

        {/* What the rail did with the hand mark-paid, in full and in place.
            The toast carries the same outcome at a glance and then leaves; this
            wraps, stays, and is where the REASON lives ("No Xero payment
            account code in settings", "Xero invoice is still a draft"). Without
            it the dashboard says paid, Xero keeps chasing the client, and only
            the audit log knows. Same <p role="status"> pattern as the send
            result under the email button. */}
        {isAdmin && pushback && (
          <p
            role="status"
            style={{
              margin: '0.875rem 0 0',
              fontSize: '0.8125rem',
              lineHeight: 1.5,
              color: OUTCOME_INK[pushback.tone],
            }}
          >
            {pushback.message}
          </p>
        )}
      </div>

      {/* Overdue-invoice chase draft (admin only, sent/overdue invoices) */}
      {isAdmin && (status === 'sent' || status === 'overdue') && (
        <ChaseDraftCard invoiceId={invoiceId} recipientLabel={invoice.orgName ?? 'the client'} />
      )}

      {/* Notes */}
      {invoice.notes && (
        <div
          style={{
            background: 'var(--color-bg-secondary)',
            borderRadius: '0.5rem',
            border: '1px solid var(--color-border-subtle)',
            padding: '0.875rem 1rem',
          }}
        >
          <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
            Notes
          </p>
          <p style={{ fontSize: '0.875rem', color: 'var(--color-text)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
            {invoice.notes}
          </p>
        </div>
      )}

      {/* Line items */}
      <div
        style={{
          background: 'var(--color-bg)',
          borderRadius: 'var(--radius-card)',
          border: '1px solid var(--color-border)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)' }}>
          <h2 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text)', margin: 0 }}>Line Items</h2>
        </div>

        {items.length === 0 ? (
          <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 14 }}>
            No line items on this invoice.
          </div>
        ) : (
          <div className="h-scroll">
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 500 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ padding: '0.625rem 1.25rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Description
                  </th>
                  <th style={{ padding: '0.625rem 1.25rem', textAlign: 'right', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', width: 100 }}>
                    Qty
                  </th>
                  <th style={{ padding: '0.625rem 1.25rem', textAlign: 'right', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', width: 120 }}>
                    Unit Price
                  </th>
                  <th style={{ padding: '0.625rem 1.25rem', textAlign: 'right', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', width: 120 }}>
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={item.id} style={{ borderBottom: i < items.length - 1 ? '1px solid var(--color-border-subtle)' : 'none' }}>
                    <td data-private style={{ padding: '0.875rem 1.25rem', fontSize: '0.875rem', color: 'var(--color-text)' }}>
                      {item.description}
                    </td>
                    <td style={{ padding: '0.875rem 1.25rem', textAlign: 'right', fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
                      {item.quantity ?? 1}
                    </td>
                    <td data-private style={{ padding: '0.875rem 1.25rem', textAlign: 'right', fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
                      {formatInvoiceCurrency(item.unitPriceUsd, invoice.currency)}
                    </td>
                    <td data-private style={{ padding: '0.875rem 1.25rem', textAlign: 'right', fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text)' }}>
                      {formatInvoiceCurrency(item.totalUsd, invoice.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Totals */}
        <div
          style={{
            borderTop: '1px solid var(--color-border)',
            padding: '1rem 1.25rem',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', width: 240 }}>
            <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>Subtotal</span>
            <span data-private style={{ fontSize: '0.8125rem', color: 'var(--color-text)' }}>{formatInvoiceCurrency(subtotal, invoice.currency)}</span>
          </div>
          {(() => {
            // Show tax if stored, or if total > subtotal (e.g. GST from Xero)
            const storedTax = invoice.taxAmountUsd ?? 0
            const impliedTax = invoice.totalUsd - subtotal
            const taxAmount = storedTax > 0 ? storedTax : (impliedTax > 0.01 ? impliedTax : 0)
            if (taxAmount <= 0) return null
            const isNzd = (invoice.currency ?? '').toUpperCase() === 'NZD'
            return (
              <div style={{ display: 'flex', justifyContent: 'space-between', width: 240 }}>
                <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{isNzd ? 'GST (15%)' : 'Tax'}</span>
                <span data-private style={{ fontSize: '0.8125rem', color: 'var(--color-text)' }}>{formatInvoiceCurrency(taxAmount, invoice.currency)}</span>
              </div>
            )
          })()}
          {(invoice.discountAmountUsd ?? 0) > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', width: 240 }}>
              <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>Discount</span>
              <span data-private style={{ fontSize: '0.8125rem', color: 'var(--color-danger)' }}>-{formatInvoiceCurrency(invoice.discountAmountUsd ?? 0, invoice.currency)}</span>
            </div>
          )}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              width: 240,
              paddingTop: 8,
              borderTop: '1px solid var(--color-border)',
            }}
          >
            <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--color-text)' }}>Total</span>
            <span data-private style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--color-text)' }}>{formatInvoiceCurrency(invoice.totalUsd, invoice.currency)}</span>
          </div>
        </div>
      </div>

      {/* Mobile bottom nav spacer */}
      <div className="h-28 md:hidden" aria-hidden="true" />
    </div>
  )
}

// ─── Helper sub-components ────────────────────────────────────────────────────

/** One "open what the client sees" link. Shared by the Stripe and Xero rows. */
function PayPageLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="tahi-focus-ring"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        minHeight: '2.75rem',
        fontSize: '0.875rem',
        fontWeight: 600,
        color: 'var(--color-brand)',
        textDecoration: 'none',
      }}
    >
      <ExternalLink style={{ width: 14, height: 14 }} aria-hidden="true" />
      {label}
    </a>
  )
}

function MetaField({ label, value, highlight, isPrivate }: { label: string; value: React.ReactNode; highlight?: boolean; isPrivate?: boolean }) {
  return (
    <div>
      <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.125rem' }}>
        {label}
      </p>
      <div {...(isPrivate ? { 'data-private': true } : {})} style={{ fontSize: '0.8125rem', fontWeight: 500, color: highlight ? 'var(--color-danger)' : 'var(--color-text)' }}>
        {value}
      </div>
    </div>
  )
}

function ActionButton({
  label,
  onClick,
  disabled,
  variant,
}: {
  label: string
  onClick: () => void
  disabled: boolean
  variant: 'primary' | 'success' | 'ghost' | 'danger'
}) {
  const styles: Record<string, React.CSSProperties> = {
    primary: { background: 'var(--color-brand)', color: 'white', border: 'none' },
    success: { background: 'var(--color-brand)', color: 'white', border: 'none' },
    ghost:   { background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)' },
    danger:  { background: 'var(--color-bg)', color: 'var(--color-danger)', border: '1px solid var(--color-danger)' },
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '0.5625rem 1.125rem',
        borderRadius: '0.5rem',
        fontSize: '0.875rem',
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        transition: 'opacity 0.15s',
        minHeight: 44,
        ...styles[variant],
      }}
    >
      {label}
    </button>
  )
}

// ─── Send invoice email ─────────────────────────────────────────────────────
// The admin's "send" motion. POSTs to the send-email route, which mails every
// billing contact the real template (pay link + portal deep link) and flips the
// invoice to sent. Reports who it actually reached rather than a bare success.

/** What the send route answers, beyond the plain success. */
interface SendEmailResult {
  sentTo?: string[]
  failedTo?: string[]
  /** Only on the Xero rail: whether Xero sent its own copy as well, or why not. */
  xeroEmail?: 'sent' | 'skipped' | 'failed'
  reason?: string
  error?: string
  message?: string
}

/** How well the send went, for the colour the sentence is said in. */
type SendTone = 'ok' | 'partial' | 'error'

/**
 * Ink per outcome. Amber and red are the badge inks rather than
 * --color-warning / --color-danger-dot: those are indicator colours and this
 * is a sentence to be read on the page background. Green stays the success
 * token only where the whole send succeeded.
 */
const SEND_RESULT_INK: Record<SendTone, string> = {
  ok: 'var(--badge-positive-text)',
  partial: 'var(--badge-warning-text)',
  error: 'var(--badge-danger-text)',
}

/**
 * One sentence for what the client actually received, and how well it went.
 *
 * The Xero half is not decoration. With invoicing.xeroEmailMode set to 'xero'
 * the studio has handed the send to Xero, and Xero refuses to email a DRAFT,
 * which is where every dashboard-pushed invoice starts. Our template is the
 * fallback in that case, and if this line did not say so the studio would
 * believe Xero sent a PDF that Xero never sent.
 *
 * The failure clause is built INDEPENDENTLY of the success clause. A send in
 * which Xero delivered cleanly and every one of our own emails bounced answers
 * 200 with an empty sentTo (the route's "did anybody get it" check is satisfied
 * by Xero), and folding "could not reach" inside `to.length > 0` dropped that
 * entirely: the studio read "Xero emailed this invoice to the client." over a
 * send where every billing contact we tried had failed.
 */
function sendResultMessage(body: SendEmailResult): { message: string; tone: SendTone } {
  const to = body.sentTo ?? []
  const failed = body.failedTo ?? []

  const parts: string[] = []
  if (to.length > 0) parts.push(`Sent to ${to.join(', ')}.`)
  if (failed.length > 0) parts.push(`Could not reach ${failed.join(', ')}.`)

  const reason = body.reason?.trim()
  if (body.xeroEmail === 'sent') {
    // In 'xero' mode ours never went, so there may be no recipient list at all.
    parts.push(to.length > 0 ? 'Xero emailed its own copy too.' : 'Xero emailed this invoice to the client.')
  } else if (body.xeroEmail === 'skipped') {
    parts.push(`Xero did not send its own copy: ${reason ?? 'no reason given'}`)
  } else if (body.xeroEmail === 'failed') {
    parts.push(`Xero could not send its own copy: ${reason ?? 'no reason given'}`)
  }

  // 'skipped' is not a fault: a Xero invoice still sitting at DRAFT is the
  // ordinary state of a freshly pushed bill and our template covered it. A
  // bounced address or a Xero call that broke is something to look at.
  const tone: SendTone = failed.length > 0 || body.xeroEmail === 'failed' ? 'partial' : 'ok'

  return { message: parts.length > 0 ? parts.join(' ') : 'Sent.', tone }
}

function SendInvoiceEmailButton({
  invoiceId,
  disabled,
  primary,
  onSent,
}: {
  invoiceId: string
  disabled: boolean
  primary: boolean
  onSent: () => void
}) {
  const [sending, setSending] = useState(false)
  // The tone is carried, not derived from the HTTP status. A 200 covers a
  // partial outcome ("Xero could not send its own copy", every one of our
  // addresses bounced), and painting those in --color-success said the send
  // went fine while the words said a delivery failed.
  const [result, setResult] = useState<{ tone: SendTone; message: string } | null>(null)

  const send = useCallback(async () => {
    setSending(true)
    setResult(null)
    try {
      const res = await fetch(apiPath(`/api/admin/invoices/${invoiceId}/send-email`), { method: 'POST' })
      const body = await res.json().catch(() => ({})) as SendEmailResult
      if (!res.ok) {
        throw new Error(body.message || body.error || `HTTP ${res.status}`)
      }
      setResult(sendResultMessage(body))
      onSent()
    } catch (err) {
      setResult({ tone: 'error', message: err instanceof Error ? err.message : 'Send failed' })
    } finally {
      setSending(false)
    }
  }, [invoiceId, onSent])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <button
        type="button"
        onClick={() => void send()}
        disabled={disabled || sending}
        className="tahi-focus-ring"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '0.5625rem 1.125rem',
          borderRadius: '0.5rem',
          fontSize: '0.875rem',
          fontWeight: 600,
          cursor: disabled || sending ? 'not-allowed' : 'pointer',
          opacity: disabled || sending ? 0.6 : 1,
          transition: 'opacity 0.15s',
          minHeight: '2.75rem',
          background: primary ? 'var(--color-brand)' : 'var(--color-bg)',
          color: primary ? 'var(--color-bg)' : 'var(--color-text)',
          border: primary ? 'none' : '1px solid var(--color-border)',
        }}
      >
        {sending
          ? <RefreshCw style={{ width: 14, height: 14 }} className="animate-spin" aria-hidden="true" />
          : <Mail style={{ width: 14, height: 14 }} aria-hidden="true" />}
        {sending ? 'Sending...' : primary ? 'Email to client' : 'Resend email'}
      </button>
      {result && (
        <p
          role="status"
          style={{
            margin: 0,
            fontSize: '0.75rem',
            lineHeight: 1.5,
            color: SEND_RESULT_INK[result.tone],
          }}
        >
          {result.message}
        </p>
      )}
    </div>
  )
}

// ─── AI chase draft card ────────────────────────────────────────────────────
// Clones the lead draft-reply triad for overdue invoices: generate a PENDING
// draft, edit it, then explicitly Send (Resend) or Dismiss. Nothing is ever
// sent automatically - a human clicks Send.

interface ChaseDraftRow {
  id: string
  aiDraftSubject: string | null
  aiDraftBody: string
  finalSubject: string | null
  finalBody: string | null
  status: string
  tokensSpent: number | null
}

function ChaseDraftCard({ invoiceId, recipientLabel }: { invoiceId: string; recipientLabel: string }) {
  const { data, mutate } = useSWR<{ draft: ChaseDraftRow | null }>(
    `/api/admin/invoices/${invoiceId}/draft-chase`
  )
  const draft = data?.draft ?? null

  const [subjectEdit, setSubjectEdit] = useState('')
  const [bodyEdit, setBodyEdit] = useState('')
  const [generating, setGenerating] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)

  useEffect(() => {
    if (draft) {
      setSubjectEdit(draft.finalSubject ?? draft.aiDraftSubject ?? '')
      setBodyEdit(draft.finalBody ?? draft.aiDraftBody ?? '')
    }
  }, [draft])

  const generate = useCallback(async () => {
    setGenerating(true)
    setError(null)
    setSentTo(null)
    try {
      const res = await fetch(apiPath(`/api/admin/invoices/${invoiceId}/draft-chase`), { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string; detail?: string }
        throw new Error(err.detail ?? err.error ?? 'Draft generation failed')
      }
      await mutate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Draft generation failed')
    } finally {
      setGenerating(false)
    }
  }, [invoiceId, mutate])

  const send = useCallback(async () => {
    if (!draft) return
    setSending(true)
    setError(null)
    try {
      const subjectChanged = subjectEdit !== (draft.finalSubject ?? draft.aiDraftSubject ?? '')
      const bodyChanged = bodyEdit !== (draft.finalBody ?? draft.aiDraftBody)
      if (subjectChanged || bodyChanged) {
        await fetch(apiPath(`/api/admin/ai-reply-drafts/${draft.id}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ finalSubject: subjectEdit, finalBody: bodyEdit }),
        })
      }
      const res = await fetch(apiPath(`/api/admin/ai-reply-drafts/${draft.id}/send`), { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string; detail?: string }
        throw new Error(err.detail ?? err.error ?? 'Send failed')
      }
      const body = await res.json().catch(() => ({})) as { recipientEmail?: string }
      setSentTo(body.recipientEmail ?? 'the client')
      await mutate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }, [draft, subjectEdit, bodyEdit, mutate])

  const dismiss = useCallback(async () => {
    if (!draft) return
    try {
      await fetch(apiPath(`/api/admin/ai-reply-drafts/${draft.id}`), { method: 'DELETE' })
      await mutate()
    } catch {
      // ignore - the card falls back to the generate prompt on next load
    }
  }, [draft, mutate])

  const labelStyle: React.CSSProperties = {
    fontSize: '0.6875rem',
    fontWeight: 600,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    color: 'var(--color-text-subtle)',
    marginBottom: '0.25rem',
    display: 'block',
  }

  return (
    <div
      style={{
        background: 'var(--color-bg)',
        borderRadius: 'var(--radius-card)',
        border: '1px solid var(--color-border)',
        padding: '1.25rem 1.25rem 1.375rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.75rem' }}>
        <Sparkles style={{ width: 16, height: 16, color: 'var(--color-brand)' }} aria-hidden="true" />
        <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-text)', margin: 0 }}>
          Chase email
        </h2>
      </div>

      {sentTo && (
        <div
          style={{
            padding: '0.5rem 0.75rem',
            marginBottom: '0.75rem',
            background: 'var(--color-success-bg)',
            border: '1px solid var(--color-success)',
            borderRadius: '0.5rem',
            fontSize: '0.8125rem',
            color: 'var(--color-success)',
          }}
        >
          Chase sent to {sentTo}.
        </div>
      )}

      {!draft ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem', alignItems: 'flex-start' }}>
          <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-text-muted)', lineHeight: 1.55 }}>
            Draft a polite overdue-payment follow-up to {recipientLabel}&rsquo;s primary contact. Grounded in this
            invoice (number, amount, days overdue) and Tahi&rsquo;s tone. You review and send it yourself.
          </p>
          {error && (
            <div
              style={{
                padding: '0.5rem 0.75rem',
                background: 'var(--color-danger-bg)',
                border: '1px solid var(--color-danger)',
                borderRadius: '0.5rem',
                fontSize: '0.75rem',
                color: 'var(--color-danger)',
              }}
            >
              {error}
            </div>
          )}
          <button
            onClick={() => void generate()}
            disabled={generating}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '0.5625rem 1.125rem',
              borderRadius: '0.5rem',
              fontSize: '0.875rem',
              fontWeight: 600,
              background: 'var(--color-brand)',
              color: 'white',
              border: 'none',
              cursor: generating ? 'not-allowed' : 'pointer',
              opacity: generating ? 0.6 : 1,
              minHeight: 44,
            }}
          >
            {generating
              ? <RefreshCw style={{ width: 14, height: 14 }} className="animate-spin" aria-hidden="true" />
              : <Sparkles style={{ width: 14, height: 14 }} aria-hidden="true" />}
            {generating ? 'Drafting...' : 'Draft chase email'}
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <label style={labelStyle}>Subject</label>
            <input
              data-private
              value={subjectEdit}
              onChange={e => setSubjectEdit(e.target.value)}
              placeholder="(no subject)"
              style={{
                width: '100%',
                fontSize: '0.8125rem',
                fontFamily: 'inherit',
                color: 'var(--color-text)',
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                borderRadius: '0.5rem',
                padding: '0.5rem 0.625rem',
              }}
            />
          </div>
          <div>
            <label style={labelStyle}>Body</label>
            <textarea
              data-private
              value={bodyEdit}
              onChange={e => setBodyEdit(e.target.value)}
              rows={10}
              style={{
                width: '100%',
                fontSize: '0.8125rem',
                fontFamily: 'inherit',
                color: 'var(--color-text)',
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                borderRadius: '0.5rem',
                padding: '0.5rem 0.625rem',
                lineHeight: 1.55,
                resize: 'vertical',
              }}
            />
          </div>

          {error && (
            <div
              style={{
                padding: '0.5rem 0.75rem',
                background: 'var(--color-danger-bg)',
                border: '1px solid var(--color-danger)',
                borderRadius: '0.5rem',
                fontSize: '0.75rem',
                color: 'var(--color-danger)',
              }}
            >
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              onClick={() => void send()}
              disabled={sending || !bodyEdit.trim()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '0.5625rem 1.125rem',
                borderRadius: '0.5rem',
                fontSize: '0.875rem',
                fontWeight: 600,
                background: 'var(--color-brand)',
                color: 'white',
                border: 'none',
                cursor: sending || !bodyEdit.trim() ? 'not-allowed' : 'pointer',
                opacity: sending || !bodyEdit.trim() ? 0.6 : 1,
                minHeight: 44,
              }}
            >
              {sending
                ? <RefreshCw style={{ width: 14, height: 14 }} className="animate-spin" aria-hidden="true" />
                : <Send style={{ width: 14, height: 14 }} aria-hidden="true" />}
              {sending ? 'Sending...' : 'Send chase'}
            </button>
            <button
              onClick={() => void generate()}
              disabled={generating}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '0.5625rem 1.125rem',
                borderRadius: '0.5rem',
                fontSize: '0.875rem',
                fontWeight: 600,
                background: 'var(--color-bg)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-border)',
                cursor: generating ? 'not-allowed' : 'pointer',
                opacity: generating ? 0.6 : 1,
                minHeight: 44,
              }}
            >
              <RefreshCw style={{ width: 14, height: 14 }} aria-hidden="true" />
              Regenerate
            </button>
            <button
              onClick={() => void dismiss()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '0.5625rem 1.125rem',
                borderRadius: '0.5rem',
                fontSize: '0.875rem',
                fontWeight: 600,
                background: 'var(--color-bg)',
                color: 'var(--color-text-muted)',
                border: '1px solid var(--color-border)',
                cursor: 'pointer',
                minHeight: 44,
              }}
            >
              <X style={{ width: 14, height: 14 }} aria-hidden="true" />
              Dismiss
            </button>
            {draft.tokensSpent != null && draft.tokensSpent > 0 && (
              <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)', marginLeft: 'auto' }}>
                {draft.tokensSpent.toLocaleString()} tokens
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
