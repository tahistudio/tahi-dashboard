'use client'

/**
 * One invoice, for the studio.
 *
 * Ported onto the shared primitives (T2.10). What it does is unchanged: every
 * fetch, every action, every confirmation and every sentence the page could
 * say before, it still says. What changed is what it is made of. It used to
 * hand roll six buttons, its own status colour map, its own header and its own
 * table, none of which the rest of the app shared, so a change to the design
 * system stopped at this page's door.
 *
 * Now: <PageHeader> inside the hero card, <TahiButton> for every action,
 * <InvoiceStatusBadge> (the same one the list renders, from the same map),
 * <DataTable> for the line items, <SidebarCard> for the rail, and the two
 * column page grid the request detail already uses.
 *
 * The reading, left to right:
 *   Hero   who owes it, which invoice it is, what state it is in, how much,
 *          and the actions, with the one next action carrying the primary fill.
 *   Main   the chase drafter when there is somebody to chase, the notes, and
 *          the lines with their totals.
 *   Rail   Getting paid (status, due date, the reference the client quotes on
 *          a transfer, the rail that raised it, and the two pay pages), then
 *          the dates, then the integration ids.
 *
 * Two audiences reach this component. The server page already routes a real
 * client and a cookie-scoped preview to <PortalInvoiceDetail>, but the
 * per-tab impersonation store is not the cookie, so a studio tab that has
 * switched to a client still lands here with isAdmin false. That branch reads
 * the org-scoped portal route and keeps the client's pay CTA.
 */

import { useState, useCallback, useEffect } from 'react'
import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, Banknote, CalendarClock, CreditCard, ExternalLink, FileText, Link2,
  Lock, Mail, RefreshCw, Send, Sparkles, X,
} from 'lucide-react'
import { SourceBadge } from '../source-badge'
import {
  InvoiceStatusBadge,
  effectiveInvoiceStatus,
  isInvoiceOverdue,
} from '../invoice-status'
import { Breadcrumb } from '@/components/tahi/breadcrumb'
import { Card } from '@/components/tahi/card'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { DataTable, type DataTableColumn } from '@/components/tahi/data-table'
import { EmptyState } from '@/components/tahi/empty-state'
import { Money } from '@/components/tahi/money'
import { PageHeader } from '@/components/tahi/page-header'
import { SidebarCard } from '@/components/tahi/rail/sidebar-card'
import { TahiButton } from '@/components/tahi/tahi-button'
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

/**
 * The display-currency half of `formatNativeWithDisplay`, or null when the
 * session is not converting (a pinned client, matching currencies, rates that
 * never loaded). The context hands back one string, "NZ$100.00 approx US$60.00",
 * and the hero prints the two halves on two lines, so the join has to be undone
 * exactly where it was made rather than guessed at.
 */
const DISPLAY_JOIN = '≈ '
function displayEquivalent(combined: string): string | null {
  const at = combined.indexOf(DISPLAY_JOIN)
  return at === -1 ? null : combined.slice(at + DISPLAY_JOIN.length)
}

// ─── Action outcomes ──────────────────────────────────────────────────────────
//
// Every write on this page can half succeed, and the half that matters is
// always the REASON. A mark-paid that Xero refused, a Stripe invoice that could
// not be raised because the client has no contact with an email, a Xero sync
// against a disconnected integration: each of those used to arrive as a
// browser alert() or, worse, as a toast that clipped.
//
// components/tahi/toast.tsx caps its surface at 22rem, renders the message on
// one nowrap line with an ellipsis, and dismisses after 3.5s, so "Marked paid
// here. Xero was not told: No Xero payment account code in settings" arrives
// as "Marked paid here. Xero was not to..." and then leaves, which loses
// exactly the half a human can act on. So outcomes are said twice: once at a
// glance in the toast, and once in full in a line that stays under the actions
// until the next action replaces it.

interface PushbackOutcome {
  rail: 'xero' | 'stripe'
  status: 'done' | 'skipped' | 'failed'
  reason?: string
}

type ToastTone = 'success' | 'error' | 'info' | 'warning'

interface PushbackCopy {
  /** The glance signal. Short on purpose: see above. */
  toast: string
  tone: ToastTone
  /** The sentence that carries the REASON, or null when there is nothing to explain. */
  detail: string | null
}

/** What happened to a hand mark-paid, said twice: once at a glance, once in full. */
export function pushbackCopy(outcome: PushbackOutcome | undefined): PushbackCopy {
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

/** The persistent half of an outcome: wraps, stays, and carries the reason. */
function OutcomeLine({ tone, children }: { tone: ToastTone; children: React.ReactNode }) {
  return (
    <p
      role="status"
      style={{
        margin: 0,
        fontSize: '0.8125rem',
        lineHeight: 1.5,
        color: OUTCOME_INK[tone],
      }}
    >
      {children}
    </p>
  )
}

// ─── States ───────────────────────────────────────────────────────────────────

/** First paint: the hero block and the two columns under it. */
export function InvoiceDetailSkeleton() {
  return (
    <div className="flex flex-col animate-pulse" style={{ gap: '1rem' }}>
      <div style={{ height: '1.25rem', width: '11rem', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-tertiary)' }} />
      <Card padding="md">
        <div style={{ height: '1rem', width: '9rem', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-tertiary)', marginBottom: '0.75rem' }} />
        <div style={{ height: '2.5rem', width: '14rem', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-tertiary)', marginBottom: '1rem' }} />
        <div style={{ height: '2.75rem', width: '100%', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-tertiary)' }} />
      </Card>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_16rem] lg:grid-cols-[1fr_20rem]" style={{ gap: '1.5rem' }}>
        <div style={{ height: '18rem', borderRadius: 'var(--radius-lg)', background: 'var(--color-bg-tertiary)' }} />
        <div style={{ height: '12rem', borderRadius: 'var(--radius-lg)', background: 'var(--color-bg-tertiary)' }} />
      </div>
    </div>
  )
}

/** The back link every dead-end state on this page sits under. */
function BackToInvoices() {
  return (
    <Link
      href="/invoices"
      className="tahi-focus-ring inline-flex items-center min-h-11 md:min-h-9"
      style={{
        gap: '0.375rem',
        padding: '0 0.5rem',
        borderRadius: 'var(--radius-sm)',
        fontSize: '0.875rem',
        fontWeight: 500,
        color: 'var(--color-text-muted)',
        textDecoration: 'none',
      }}
    >
      <ArrowLeft style={{ width: '0.875rem', height: '0.875rem' }} aria-hidden="true" />
      Back to Invoices
    </Link>
  )
}

/**
 * Could not load, or is not there. Retry only appears on the first of those:
 * a 404 does not become a 200 because somebody pressed a button.
 */
export function InvoiceLoadFailed({ notFound, onRetry }: { notFound?: boolean; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-start" style={{ gap: '1rem' }}>
      <BackToInvoices />
      <Card padding="none" style={{ width: '100%' }}>
        <EmptyState
          icon={<FileText className="w-6 h-6" />}
          title={notFound ? 'Invoice not found.' : 'Failed to load invoice.'}
          description={notFound
            ? 'It may have been deleted, or the link may be wrong.'
            : 'The invoice could not be fetched. Try again.'}
          action={!notFound && onRetry
            ? (
              <TahiButton
                variant="secondary"
                size="sm"
                iconLeft={<RefreshCw style={{ width: '0.875rem', height: '0.875rem' }} aria-hidden="true" />}
                onClick={onRetry}
              >
                Retry
              </TahiButton>
            )
            : undefined}
        />
      </Card>
    </div>
  )
}

// ─── Rail atoms ───────────────────────────────────────────────────────────────

/** One labelled fact in the rail. */
function RailFact({
  label,
  value,
  highlight,
  isPrivate,
}: {
  label: string
  value: React.ReactNode
  highlight?: boolean
  isPrivate?: boolean
}) {
  return (
    <div className="flex flex-col" style={{ gap: '0.125rem', minWidth: 0 }}>
      <span
        className="uppercase"
        style={{ fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.05em', color: 'var(--color-text-subtle)' }}
      >
        {label}
      </span>
      <span
        {...(isPrivate ? { 'data-private': true } : {})}
        className="flex items-center"
        style={{
          gap: '0.375rem',
          minWidth: 0,
          fontSize: '0.8125rem',
          fontWeight: 500,
          wordBreak: 'break-word',
          color: highlight ? 'var(--color-danger)' : 'var(--color-text)',
        }}
      >
        {value}
      </span>
    </div>
  )
}

/** A stack of facts inside one rail card. */
function RailFacts({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col" style={{ gap: '0.75rem' }}>{children}</div>
}

/**
 * One "open what the client sees" link. A real anchor, not a TahiButton: it
 * leaves the app, and middle-click and "open in new tab" have to keep working.
 */
function PayPageLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="tahi-focus-ring inline-flex items-center min-h-11 md:min-h-9"
      style={{
        gap: '0.375rem',
        padding: '0 0.5rem',
        borderRadius: 'var(--radius-sm)',
        fontSize: '0.8125rem',
        fontWeight: 600,
        color: 'var(--color-brand-dark)',
        textDecoration: 'none',
        transition: 'background-color var(--motion-quick) var(--ease-out), color var(--motion-quick) var(--ease-out)',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'var(--color-bg-secondary)'
        e.currentTarget.style.color = 'var(--color-brand)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.color = 'var(--color-brand-dark)'
      }}
    >
      <ExternalLink style={{ width: '0.875rem', height: '0.875rem', flexShrink: 0 }} aria-hidden="true" />
      {label}
    </a>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface InvoiceDetailProps {
  invoiceId: string
  isAdmin: boolean
}

/** Which destructive confirmation is open, if any. */
type PendingConfirm = 'void' | 'delete' | null

export function InvoiceDetail({ invoiceId, isAdmin: isAdminProp }: InvoiceDetailProps) {
  const router = useRouter()
  const { isImpersonatingClient } = useImpersonation()
  // Only switch to client view when impersonating a client, not a team member
  const isAdmin = isAdminProp && !isImpersonatingClient
  const { displayCurrency, formatNativeWithDisplay } = useDisplayCurrency()
  const { showToast } = useToast()
  const [patching, setPatching] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<PendingConfirm>(null)
  // The last write's answer, kept on the page. The toast says it at a glance
  // and then goes; this is where the reason stays readable.
  const [outcome, setOutcome] = useState<{ message: string; tone: ToastTone } | null>(null)

  /** Say it twice: once in the toast, once in the line that stays. */
  const report = useCallback((toast: string, tone: ToastTone, detail?: string | null) => {
    showToast(toast, tone)
    setOutcome(detail ? { message: detail, tone } : null)
  }, [showToast])

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
    setOutcome(null)
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
        report(toast, tone, detail)
      }
    } catch (err) {
      report(err instanceof Error ? err.message : 'Could not update this invoice', 'error')
    } finally {
      setPatching(null)
    }
  }, [invoice, invoiceId, mutate, report])

  const syncToXero = useCallback(async () => {
    if (!invoice) return
    setBusy('xero')
    setOutcome(null)
    try {
      const res = await fetch(apiPath('/api/admin/invoices/xero-sync'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceIds: [invoice.id] }),
      })
      if (res.ok) {
        await mutate()
        report('Synced to Xero.', 'success')
      } else {
        const err = await res.json().catch(() => ({})) as { error?: string }
        report('Xero sync failed.', 'error', err.error ?? 'Xero sync failed. Reconnect Xero in Settings.')
      }
    } catch {
      report('Xero sync failed.', 'error', 'Xero sync failed. Check connection in Settings.')
    } finally {
      setBusy(null)
    }
  }, [invoice, mutate, report])

  const createStripeLink = useCallback(async () => {
    if (!invoice) return
    setBusy('stripe')
    setOutcome(null)
    try {
      const res = await fetch(apiPath('/api/admin/invoices/stripe-create'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: invoice.id }),
      })
      if (res.ok) {
        const body = await res.json() as { payUrl?: string }
        if (body.payUrl) {
          await navigator.clipboard.writeText(body.payUrl)
          report('Stripe invoice created.', 'success', 'Stripe invoice created, payment link copied to clipboard.')
        }
        await mutate()
      } else {
        // Surface the real Stripe error rather than a generic message.
        // Most common cause: the client has no contact with email
        // (Stripe rejects customer.create without one).
        const err = await res.json().catch(() => ({})) as { error?: string; message?: string }
        const detail = err.message || err.error || `HTTP ${res.status}`
        report(
          'Stripe invoice failed.',
          'error',
          `Stripe invoice failed: ${detail}. If this says "Missing email", add a contact with email on this client's Contacts tab.`,
        )
      }
    } catch (err) {
      report(
        'Stripe invoice failed.',
        'error',
        `Failed to create Stripe link: ${err instanceof Error ? err.message : 'unknown error'}`,
      )
    } finally {
      setBusy(null)
    }
  }, [invoice, mutate, report])

  const copyPaymentLink = useCallback(async () => {
    if (!invoice) return
    setBusy('copy')
    setOutcome(null)
    try {
      const res = await fetch(apiPath(`/api/admin/integrations/stripe/provision?invoiceId=${invoice.id}`))
      if (res.ok) {
        const body = await res.json() as { payUrl?: string }
        if (body.payUrl) {
          await navigator.clipboard.writeText(body.payUrl)
          report('Payment link copied.', 'success')
        } else {
          report('No payment link available.', 'warning')
        }
      } else {
        // Used to be silent: a failed lookup left the button looking like it
        // had worked and nothing on the page said otherwise.
        report('Could not fetch the payment link.', 'error', `Stripe returned HTTP ${res.status}.`)
      }
    } catch {
      report('Could not copy the payment link.', 'error')
    } finally {
      setBusy(null)
    }
  }, [invoice, report])

  const deleteInvoice = useCallback(async () => {
    if (!invoice) return
    setBusy('delete')
    setOutcome(null)
    try {
      const res = await fetch(apiPath(`/api/admin/invoices/${invoice.id}`), { method: 'DELETE' })
      if (res.ok) {
        router.push('/invoices')
      } else {
        const err = await res.json().catch(() => ({})) as { error?: string }
        report('Failed to delete invoice.', 'error', err.error ?? 'Failed to delete invoice')
      }
    } catch {
      report('Failed to delete invoice.', 'error')
    } finally {
      setBusy(null)
    }
  }, [invoice, report, router])

  if (loading && !data) return <InvoiceDetailSkeleton />

  // Denied, not broken. SWR clears isLoading on an error, so this sits safely
  // after the loading branch, and every hook above has already run.
  if (denialCopy) {
    return (
      <div className="flex flex-col items-start" style={{ gap: '1rem' }}>
        <BackToInvoices />
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
    return <InvoiceLoadFailed notFound={!fetchError} onRetry={() => void mutate()} />
  }

  const status = effectiveInvoiceStatus(invoice)
  const reference = invoiceReference(invoice.id, invoice.number)
  const overdue = isInvoiceOverdue(invoice.dueDate, invoice.status)
  const currency = invoice.currency

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
  // Show tax if stored, or if total > subtotal (e.g. GST from Xero)
  const storedTax = invoice.taxAmountUsd ?? 0
  const impliedTax = invoice.totalUsd - subtotal
  const taxAmount = storedTax > 0 ? storedTax : (impliedTax > 0.01 ? impliedTax : 0)
  const isNzd = (currency ?? '').toUpperCase() === 'NZD'
  const discount = invoice.discountAmountUsd ?? 0

  const settled = invoice.status === 'paid' || invoice.status === 'written_off'
  const owed = invoice.status === 'sent' || invoice.status === 'overdue'
  const anyBusy = patching !== null || busy !== null

  // The amount, and its equivalent in the currency this session reads in.
  const nativeAmount = formatInvoiceCurrency(invoice.totalUsd, currency)
  const equivalent = currency && currency !== displayCurrency && invoice.totalUsd > 0
    ? displayEquivalent(formatNativeWithDisplay(invoice.totalUsd, currency))
    : null

  const columns: DataTableColumn<LineItem>[] = [
    {
      key: 'description',
      header: 'Description',
      wrap: true,
      minWidth: '10rem',
      render: item => <span data-private>{item.description}</span>,
    },
    {
      key: 'quantity',
      header: 'Qty',
      align: 'right',
      width: '5rem',
      muted: true,
      render: item => item.quantity ?? 1,
    },
    {
      key: 'unitPrice',
      header: 'Unit price',
      align: 'right',
      width: '8rem',
      muted: true,
      render: item => <Money native={item.unitPriceUsd} currency={currency ?? 'NZD'} sensitive />,
    },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      width: '8rem',
      render: item => (
        <Money native={item.totalUsd} currency={currency ?? 'NZD'} sensitive style={{ fontWeight: 600 }} />
      ),
    },
  ]

  return (
    <div className="flex flex-col" style={{ gap: '1rem' }}>
      <Breadcrumb items={[{ label: 'Invoices', href: '/invoices' }, { label: reference }]} />

      {/* Hero: who owes it, which invoice, what state, how much, what to do. */}
      <Card padding="md">
        <PageHeader
          title={<span data-private>{reference}</span>}
          subtitle={<span data-private>{invoice.orgName ?? 'Unknown Client'}</span>}
          style={{ marginBottom: '1rem' }}
        >
          <InvoiceStatusBadge status={invoice.status} dueDate={invoice.dueDate} size="md" />
          {isAdmin && <SourceBadge source={invoice.source} />}
        </PageHeader>

        <p
          data-private
          className="tabular-nums"
          style={{
            margin: 0,
            fontSize: '2.25rem',
            fontWeight: 700,
            color: 'var(--color-text)',
            lineHeight: 1.1,
            letterSpacing: '-0.02em',
          }}
        >
          {nativeAmount}
        </p>
        {equivalent && (
          <p data-private style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem', color: 'var(--color-text-subtle)' }}>
            {equivalent}
          </p>
        )}

        {/* Client pay CTA. Only for a bill that is actually payable, and only
            when Stripe has given us a hosted invoice page for it. */}
        {!isAdmin && payUrl && !settled && (
          <>
            <Card.Divider />
            <div className="flex items-center flex-wrap" style={{ gap: '0.75rem' }}>
              <a
                href={payUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="tahi-focus-ring inline-flex items-center justify-center min-h-11"
                style={{
                  gap: '0.5rem',
                  padding: '0 1.25rem',
                  borderRadius: 'var(--radius-leaf-sm)',
                  background: 'var(--color-brand)',
                  color: 'var(--color-bg)',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  textDecoration: 'none',
                  transition: 'background-color var(--motion-quick) var(--ease-out)',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-brand-dark)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-brand)' }}
              >
                <CreditCard style={{ width: '0.9375rem', height: '0.9375rem' }} aria-hidden="true" />
                Pay {nativeAmount}
              </a>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>
                Secure payment page, hosted by Stripe.
              </span>
            </div>
          </>
        )}

        {/* Admin actions. One wrapping row; the primary fill marks the single
            next action, which is Send while the invoice is a draft and Mark as
            Paid once the client has been asked for the money. */}
        {isAdmin && (
          <>
            <Card.Divider />
            <div className="flex flex-wrap items-start" style={{ gap: '0.5rem' }}>
              {/* Sending means emailing them, not just flipping a column. The
                  route mails every billing contact with the pay link and marks
                  the invoice sent, so this replaces the old status-only PATCH.
                  Withheld once the invoice is settled or voided: there is
                  nothing left to chase. */}
              {!settled && (
                <SendInvoiceEmailButton
                  invoiceId={invoice.id}
                  disabled={anyBusy}
                  primary={invoice.status === 'draft'}
                  onSent={() => void mutate()}
                />
              )}
              {owed && (
                <TahiButton
                  variant="primary"
                  size="lg"
                  disabled={anyBusy}
                  loading={patching === 'paid'}
                  onClick={() => void patchStatus('paid')}
                >
                  {patching === 'paid' ? 'Marking...' : 'Mark as Paid'}
                </TahiButton>
              )}
              {invoice.status !== 'draft' && !settled && (
                <TahiButton
                  variant="secondary"
                  size="lg"
                  disabled={anyBusy}
                  onClick={() => void patchStatus('draft')}
                >
                  Revert to Draft
                </TahiButton>
              )}
              {!settled && (
                <TahiButton
                  variant="secondary"
                  size="lg"
                  disabled={anyBusy}
                  onClick={() => setConfirming('void')}
                >
                  Void Invoice
                </TahiButton>
              )}
              {!invoice.xeroInvoiceId && invoice.status !== 'paid' && (
                <TahiButton
                  variant="secondary"
                  size="lg"
                  disabled={anyBusy}
                  loading={busy === 'xero'}
                  onClick={() => void syncToXero()}
                >
                  Sync to Xero
                </TahiButton>
              )}
              {invoice.status !== 'paid' && !invoice.stripeInvoiceId && (
                <TahiButton
                  variant="secondary"
                  size="lg"
                  disabled={anyBusy}
                  loading={busy === 'stripe'}
                  onClick={() => void createStripeLink()}
                >
                  Create Stripe Link
                </TahiButton>
              )}
              {invoice.stripeInvoiceId && (
                <TahiButton
                  variant="secondary"
                  size="lg"
                  disabled={anyBusy}
                  loading={busy === 'copy'}
                  onClick={() => void copyPaymentLink()}
                >
                  Copy Payment Link
                </TahiButton>
              )}
              <TahiButton
                variant="danger"
                size="lg"
                disabled={anyBusy}
                loading={busy === 'delete'}
                onClick={() => setConfirming('delete')}
              >
                Delete Invoice
              </TahiButton>
            </div>
          </>
        )}

        {/* What the last write actually did, in full and in place. The toast
            carried the same outcome at a glance and then left; this wraps,
            stays, and is where the REASON lives ("No Xero payment account code
            in settings", "Xero invoice is still a draft"). Without it the
            dashboard says paid, Xero keeps chasing the client, and only the
            audit log knows. */}
        {isAdmin && outcome && (
          <div style={{ marginTop: '0.875rem' }}>
            <OutcomeLine tone={outcome.tone}>{outcome.message}</OutcomeLine>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_16rem] lg:grid-cols-[1fr_20rem]" style={{ gap: '1.5rem' }}>
        {/* Main column */}
        <div className="flex flex-col" style={{ gap: '1rem', minWidth: 0 }}>
          {/* Overdue-invoice chase draft (admin only, sent/overdue invoices) */}
          {isAdmin && (status === 'sent' || status === 'overdue') && (
            <ChaseDraftCard invoiceId={invoiceId} recipientLabel={invoice.orgName ?? 'the client'} />
          )}

          {invoice.notes && (
            <Card padding="md">
              <h2
                className="uppercase"
                style={{
                  margin: '0 0 0.375rem',
                  fontSize: '0.6875rem',
                  fontWeight: 700,
                  letterSpacing: '0.05em',
                  color: 'var(--color-text-subtle)',
                }}
              >
                Notes
              </h2>
              <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-text)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                {invoice.notes}
              </p>
            </Card>
          )}

          <Card padding="none" style={{ overflow: 'hidden' }}>
            <div
              className="flex items-center"
              style={{
                gap: '0.5rem',
                padding: '0.6875rem 0.875rem',
                borderBottom: '1px solid var(--color-border-subtle)',
                background: 'var(--color-bg-secondary)',
              }}
            >
              <h2 style={{ margin: 0, fontSize: '0.875rem', fontWeight: 700, color: 'var(--color-text)' }}>
                Line Items
              </h2>
              {items.length > 0 && (
                <span className="tabular-nums" style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-subtle)' }}>
                  {items.length}
                </span>
              )}
            </div>

            <DataTable<LineItem>
              columns={columns}
              rows={items}
              getRowId={item => item.id}
              ariaLabel="Invoice line items"
              paginate={false}
              density="compact"
              empty={
                <EmptyState
                  variant="inline"
                  title="No line items on this invoice."
                  description="The total below is the whole of it."
                />
              }
            />

            {/* Totals */}
            <div
              className="flex flex-col items-end"
              style={{
                borderTop: '1px solid var(--color-border-subtle)',
                padding: '1rem 1.25rem',
                gap: '0.5rem',
              }}
            >
              <TotalRow label="Subtotal">
                <Money native={subtotal} currency={currency ?? 'NZD'} sensitive />
              </TotalRow>
              {taxAmount > 0 && (
                <TotalRow label={isNzd ? 'GST (15%)' : 'Tax'}>
                  <Money native={taxAmount} currency={currency ?? 'NZD'} sensitive />
                </TotalRow>
              )}
              {discount > 0 && (
                <TotalRow label="Discount">
                  <span data-private style={{ color: 'var(--color-danger)' }}>
                    -{formatInvoiceCurrency(discount, currency)}
                  </span>
                </TotalRow>
              )}
              <TotalRow label="Total" strong>
                <Money native={invoice.totalUsd} currency={currency ?? 'NZD'} sensitive style={{ fontWeight: 700 }} />
              </TotalRow>
            </div>
          </Card>
        </div>

        {/* Rail: getting paid, then the dates, then the ids. */}
        <div className="flex flex-col" style={{ gap: '1rem', minWidth: 0 }}>
          <SidebarCard title="Getting paid" icon={<Banknote size={13} aria-hidden="true" />}>
            <RailFacts>
              {/* The number when the row has one, the short id when it does
                  not, and the label says which so nobody quotes a UUID
                  fragment to Xero believing it is an invoice number. */}
              <RailFact
                label={invoice.number ? 'Invoice number' : 'Invoice ID'}
                value={reference}
                isPrivate
              />
              <RailFact
                label="Due date"
                value={formatDate(invoice.dueDate)}
                highlight={overdue}
              />
              {isAdmin && (payUrl || xeroPayUrl) && (
                <div className="flex flex-col" style={{ gap: '0.125rem' }}>
                  <span
                    className="uppercase"
                    style={{ fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.05em', color: 'var(--color-text-subtle)' }}
                  >
                    Pay pages
                  </span>
                  {/* "Copy Payment Link" above asks Stripe for it again; these
                      are the links we already stored, visible without a click
                      so Liam can see whether a bill is actually payable and
                      open exactly what the client was sent.

                      Both rails, side by side. A Xero pay page only exists once
                      the invoice has been approved inside Xero (the push holds
                      it at DRAFT on purpose), so an empty Xero slot on a
                      Xero-rail invoice is the one-glance answer to "why has the
                      client not paid this". */}
                  <div className="flex flex-col items-start" style={{ gap: '0.125rem' }}>
                    {payUrl && <PayPageLink href={payUrl} label="Client pay page" />}
                    {xeroPayUrl && <PayPageLink href={xeroPayUrl} label="Xero pay page" />}
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>
                    What the client sees when they pay.
                  </span>
                </div>
              )}
            </RailFacts>
          </SidebarCard>

          <SidebarCard title="Dates" icon={<CalendarClock size={13} aria-hidden="true" />}>
            <RailFacts>
              <RailFact label="Created" value={formatDate(invoice.createdAt)} />
              {invoice.sentAt && <RailFact label="Sent" value={formatDate(invoice.sentAt)} />}
              {invoice.viewedAt && <RailFact label="Viewed" value={formatDate(invoice.viewedAt)} />}
              {invoice.paidAt && <RailFact label="Paid" value={formatDate(invoice.paidAt)} />}
            </RailFacts>
          </SidebarCard>

          {isAdmin && (invoice.stripeInvoiceId || invoice.xeroInvoiceId) && (
            <SidebarCard title="Linked records" icon={<Link2 size={13} aria-hidden="true" />}>
              <RailFacts>
                {invoice.stripeInvoiceId && (
                  <RailFact label="Stripe ID" value={invoice.stripeInvoiceId} isPrivate />
                )}
                {invoice.xeroInvoiceId && (
                  <RailFact label="Xero ID" value={invoice.xeroInvoiceId.slice(0, 8)} isPrivate />
                )}
              </RailFacts>
            </SidebarCard>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirming === 'void'}
        title="Void this invoice?"
        description="This will also void it in Xero if linked."
        confirmLabel="Void invoice"
        variant="danger"
        onCancel={() => setConfirming(null)}
        onConfirm={async () => {
          await patchStatus('written_off')
          setConfirming(null)
        }}
      />
      <ConfirmDialog
        open={confirming === 'delete'}
        title="Delete this invoice?"
        description="Are you sure you want to delete this invoice? This cannot be undone."
        confirmLabel="Delete invoice"
        variant="danger"
        onCancel={() => setConfirming(null)}
        onConfirm={async () => {
          await deleteInvoice()
          setConfirming(null)
        }}
      />

      {/* Mobile bottom nav spacer */}
      <div className="h-28 md:hidden" aria-hidden="true" />
    </div>
  )
}

/** One line of the totals stack. Fixed width so the figures line up. */
function TotalRow({ label, strong, children }: { label: string; strong?: boolean; children: React.ReactNode }) {
  return (
    <div
      className="flex justify-between"
      style={{
        width: '15rem',
        maxWidth: '100%',
        gap: '1rem',
        paddingTop: strong ? '0.5rem' : undefined,
        borderTop: strong ? '1px solid var(--color-border-subtle)' : undefined,
      }}
    >
      <span style={{ fontSize: strong ? '0.9375rem' : '0.8125rem', fontWeight: strong ? 700 : 400, color: strong ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
        {label}
      </span>
      <span className="tabular-nums" style={{ fontSize: strong ? '0.9375rem' : '0.8125rem', color: 'var(--color-text)' }}>
        {children}
      </span>
    </div>
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
export function sendResultMessage(body: SendEmailResult): { message: string; tone: SendTone } {
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
    <div className="flex flex-col" style={{ gap: '0.5rem' }}>
      <TahiButton
        variant={primary ? 'primary' : 'secondary'}
        size="lg"
        disabled={disabled}
        loading={sending}
        iconLeft={<Mail style={{ width: '0.875rem', height: '0.875rem' }} aria-hidden="true" />}
        onClick={() => void send()}
      >
        {sending ? 'Sending...' : primary ? 'Email to client' : 'Resend email'}
      </TahiButton>
      {result && (
        <p
          role="status"
          style={{
            margin: 0,
            maxWidth: '22rem',
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

/** The inline warning / confirmation block the chase card answers with. */
function ChaseNote({ tone, children }: { tone: 'danger' | 'success'; children: React.ReactNode }) {
  const danger = tone === 'danger'
  return (
    <div
      role="status"
      style={{
        padding: '0.5rem 0.75rem',
        background: danger ? 'var(--color-danger-bg)' : 'var(--color-success-bg)',
        border: `1px solid ${danger ? 'var(--color-danger)' : 'var(--color-success)'}`,
        borderRadius: 'var(--radius-md)',
        fontSize: danger ? '0.75rem' : '0.8125rem',
        lineHeight: 1.5,
        color: danger ? 'var(--badge-danger-text)' : 'var(--badge-positive-text)',
      }}
    >
      {children}
    </div>
  )
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
    fontWeight: 700,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    color: 'var(--color-text-subtle)',
    marginBottom: '0.25rem',
    display: 'block',
  }

  const fieldStyle: React.CSSProperties = {
    width: '100%',
    fontSize: '0.8125rem',
    fontFamily: 'inherit',
    color: 'var(--color-text)',
    background: 'var(--color-bg)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    padding: '0.5rem 0.625rem',
  }

  return (
    <Card padding="md">
      <div className="flex items-center" style={{ gap: '0.5rem', marginBottom: '0.75rem' }}>
        <Sparkles style={{ width: '1rem', height: '1rem', color: 'var(--color-brand)' }} aria-hidden="true" />
        <h2 style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>
          Chase email
        </h2>
      </div>

      {sentTo && (
        <div style={{ marginBottom: '0.75rem' }}>
          <ChaseNote tone="success">Chase sent to {sentTo}.</ChaseNote>
        </div>
      )}

      {!draft ? (
        <div className="flex flex-col items-start" style={{ gap: '0.625rem' }}>
          <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-text-muted)', lineHeight: 1.55 }}>
            Draft a polite overdue-payment follow-up to {recipientLabel}&rsquo;s primary contact. Grounded in this
            invoice (number, amount, days overdue) and Tahi&rsquo;s tone. You review and send it yourself.
          </p>
          {error && <ChaseNote tone="danger">{error}</ChaseNote>}
          <TahiButton
            variant="primary"
            size="lg"
            loading={generating}
            iconLeft={<Sparkles style={{ width: '0.875rem', height: '0.875rem' }} aria-hidden="true" />}
            onClick={() => void generate()}
          >
            {generating ? 'Drafting...' : 'Draft chase email'}
          </TahiButton>
        </div>
      ) : (
        <div className="flex flex-col" style={{ gap: '0.75rem' }}>
          <div>
            <label htmlFor="chase-subject" style={labelStyle}>Subject</label>
            <input
              id="chase-subject"
              data-private
              className="tahi-focus-ring min-h-11 md:min-h-9"
              value={subjectEdit}
              onChange={e => setSubjectEdit(e.target.value)}
              placeholder="(no subject)"
              style={fieldStyle}
            />
          </div>
          <div>
            <label htmlFor="chase-body" style={labelStyle}>Body</label>
            <textarea
              id="chase-body"
              data-private
              className="tahi-focus-ring"
              value={bodyEdit}
              onChange={e => setBodyEdit(e.target.value)}
              rows={10}
              style={{ ...fieldStyle, lineHeight: 1.55, resize: 'vertical' }}
            />
          </div>

          {error && <ChaseNote tone="danger">{error}</ChaseNote>}

          <div className="flex flex-wrap items-center" style={{ gap: '0.5rem' }}>
            <TahiButton
              variant="primary"
              size="lg"
              loading={sending}
              disabled={!bodyEdit.trim()}
              iconLeft={<Send style={{ width: '0.875rem', height: '0.875rem' }} aria-hidden="true" />}
              onClick={() => void send()}
            >
              {sending ? 'Sending...' : 'Send chase'}
            </TahiButton>
            <TahiButton
              variant="secondary"
              size="lg"
              loading={generating}
              iconLeft={<RefreshCw style={{ width: '0.875rem', height: '0.875rem' }} aria-hidden="true" />}
              onClick={() => void generate()}
            >
              Regenerate
            </TahiButton>
            <TahiButton
              variant="ghost"
              size="lg"
              iconLeft={<X style={{ width: '0.875rem', height: '0.875rem' }} aria-hidden="true" />}
              onClick={() => void dismiss()}
            >
              Dismiss
            </TahiButton>
            {draft.tokensSpent != null && draft.tokensSpent > 0 && (
              <span className="tabular-nums" style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)', marginLeft: 'auto' }}>
                {draft.tokensSpent.toLocaleString()} tokens
              </span>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}
