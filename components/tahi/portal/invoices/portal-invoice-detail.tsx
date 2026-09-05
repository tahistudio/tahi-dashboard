'use client'

/**
 * The client's invoice.
 *
 * One bill, and everything a person needs to settle it or to argue with it:
 * the amount in its own currency, the due date in plain words, what they are
 * being charged for, how to pay it, and a way to ask about any of it.
 *
 * The three things this adds over the shared admin detail page:
 *
 *   How to pay   the client half of IC.4a. A Xero-rail invoice sits at DRAFT
 *                inside Xero until Liam approves it, so it has no hosted pay
 *                page for most of its life. Before this block a client held a
 *                real bill with nothing on the page to act on. Bank name,
 *                account name, account number, the reference and the amount,
 *                each with its own Copy.
 *   an ask       a Question about this invoice, and an Ask on every line, so
 *                a disputed charge does not have to become an email nobody
 *                can find later.
 *   no rail      the Source badge is gone. A client is never shown which of
 *                the studio's two billing rails raised their bill.
 */

import * as React from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import {
  AlertTriangle, ArrowLeft, Check, CreditCard, ExternalLink, FileText,
  Landmark, Lock, MessageSquare, RefreshCw,
} from 'lucide-react'
import { ApiError } from '@/lib/swr-fetcher'
import { useImpersonation } from '@/components/tahi/impersonation-banner'
import {
  portalAdminLabel,
  portalMoneyDenial,
  portalInvoiceDenialCopy,
  type PortalPersonSummary,
} from '@/lib/portal-admin-label'
import type { InvoiceHowToPay } from '@/lib/invoice-how-to-pay'
import { invoiceReference } from '@/lib/invoice-billing'
import {
  PORTAL_INVOICE_STATE_COPY,
  formatPortalDateLong,
  formatPortalMoney,
  isPortalInvoiceOpen,
  portalDueSentence,
  portalInvoiceLabel,
  portalInvoiceState,
} from '@/lib/portal-invoice-view'
import { Card } from '@/components/tahi/card'
import { EmptyState } from '@/components/tahi/empty-state'
import { TahiButton } from '@/components/tahi/tahi-button'
import { useToast } from '@/components/tahi/toast'
import {
  CLIPBOARD_REFUSED,
  PortalAskSheet, PortalCopyRow, PortalMoney, PortalPayLink, PortalSkeleton, PortalStatusPill,
  copyText,
} from '@/components/tahi/portal/portal-money-kit'

// ── Types ─────────────────────────────────────────────────────────────────────

/** The portal detail projection. No Stripe id, no Xero id, no rail. */
interface PortalInvoice {
  id: string
  orgId: string
  orgName: string | null
  status: string
  amountUsd: number
  taxAmountUsd: number
  discountAmountUsd: number
  totalUsd: number
  currency: string | null
  notes: string | null
  dueDate: string | null
  sentAt: string | null
  paidAt: string | null
  payUrl: string | null
  howToPay?: InvoiceHowToPay
  createdAt: string
}

interface PortalInvoiceItem {
  id: string
  description: string
  quantity: number | null
  unitPriceUsd: number
  totalUsd: number
}

const READ_ONLY_REASON = 'Read only while viewing as a client'

/** The jump link to the bank block. A secondary control, so secondary tokens. */
const ANCHOR_LINK_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.5rem',
  padding: '0.625rem 1.125rem',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-bg)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border-strong)',
  fontSize: '0.875rem',
  fontWeight: 500,
  lineHeight: 1,
  textDecoration: 'none',
  whiteSpace: 'nowrap',
}

interface AskState {
  title: string
  subtitle?: string
  seed?: string
  requestTitle: string
  emailSubject: string
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function PortalInvoiceDetail({
  invoiceId,
  preview = false,
}: {
  invoiceId: string
  preview?: boolean
}) {
  const { isImpersonatingClient } = useImpersonation()
  // The server picked this surface from the browser-wide impersonation cookie;
  // useImpersonation reads a per-tab store. A second tab has the cookie and an
  // empty store, so the pay link has to be refused by the prop as well.
  const readOnly = preview || isImpersonatingClient
  const { showToast } = useToast()
  const [ask, setAsk] = React.useState<AskState | null>(null)
  // The sheet keeps the last ask through its exit animation. SlideOver stays
  // mounted while it slides away and only draws its header when title is
  // truthy, so clearing ask on close dropped the header a frame early.
  const [askOpen, setAskOpen] = React.useState(false)

  const { data, isLoading, error: fetchError, mutate } = useSWR<{
    invoice?: PortalInvoice
    items?: PortalInvoiceItem[]
  }>(`/api/portal/invoices/${invoiceId}`)

  const denial = fetchError instanceof ApiError && fetchError.status === 403
    ? portalMoneyDenial(fetchError.info)
    : null
  const { data: peopleData } = useSWR<{ items?: PortalPersonSummary[] }>(
    denial === 'member_seat' ? '/api/portal/people' : null,
  )

  const invoice = data?.invoice ?? null
  const items = data?.items ?? []
  // A withdrawn invoice, and one belonging to another org, both come back as a
  // 404, which the fetcher throws. Without this the friendlier copy below was
  // unreachable and every 404 wore a Try again button that could never work.
  const missing = !denial
    && ((fetchError instanceof ApiError && fetchError.status === 404)
      || (!fetchError && !isLoading && !invoice))
  const failed = !denial && !missing && !!fetchError

  const back = (
    <Link
      href="/invoices"
      className="tahi-focus-ring min-h-11 md:min-h-8 inline-flex items-center gap-2"
      style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', textDecoration: 'none' }}
    >
      <ArrowLeft size={15} aria-hidden="true" />
      Invoices
    </Link>
  )

  if (denial) {
    const copy = portalInvoiceDenialCopy(denial, portalAdminLabel(peopleData?.items))
    return (
      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        {back}
        <Card padding="none">
          <EmptyState
            icon={<Lock className="w-8 h-8" aria-hidden="true" />}
            title={copy.title}
            description={copy.description}
          />
        </Card>
      </div>
    )
  }

  if (isLoading && !data) {
    return (
      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        {back}
        <Card padding="lg">
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <PortalSkeleton width="8rem" height="0.75rem" />
            <PortalSkeleton width="14rem" height="2rem" />
            <PortalSkeleton width="11rem" height="0.875rem" />
          </div>
        </Card>
        <Card padding="lg">
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <PortalSkeleton width="100%" height="0.875rem" />
            <PortalSkeleton width="80%" height="0.875rem" />
            <PortalSkeleton width="60%" height="0.875rem" />
          </div>
        </Card>
      </div>
    )
  }

  if (failed || missing || !invoice) {
    return (
      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        {back}
        <Card padding="none">
          <EmptyState
            icon={<AlertTriangle className="w-8 h-8" aria-hidden="true" />}
            title={failed ? 'We could not load this invoice' : 'Invoice not found'}
            description={failed
              ? 'This one is on us. Nothing has changed on your account, and nothing here is out of date, because nothing here loaded.'
              : 'It may have been withdrawn. Your other invoices are unaffected.'}
            action={failed
              ? (
                <TahiButton
                  variant="primary"
                  size="md"
                  iconLeft={<RefreshCw size={15} aria-hidden="true" />}
                  onClick={() => { void mutate() }}
                >
                  Try again
                </TahiButton>
              )
              : (
                <Link href="/invoices" className="tahi-focus-ring" style={{ textDecoration: 'none' }}>
                  <TahiButton variant="secondary" size="md">Back to invoices</TahiButton>
                </Link>
              )}
          />
        </Card>
      </div>
    )
  }

  const reference = invoiceReference(invoice.id)
  const state = portalInvoiceState(invoice)
  const stateCopy = PORTAL_INVOICE_STATE_COPY[state]
  const currency = invoice.currency ?? 'NZD'
  const settled = !isPortalInvoiceOpen(invoice)
  const subtotal = invoice.amountUsd > 0
    ? invoice.amountUsd
    : items.reduce((sum, item) => sum + (item.totalUsd ?? 0), 0)
  const tax = invoice.taxAmountUsd > 0
    ? invoice.taxAmountUsd
    : Math.max(0, invoice.totalUsd - subtotal + (invoice.discountAmountUsd ?? 0))

  const askAbout = (partial: Partial<AskState>) => {
    setAsk({
      title: `Question about ${reference}`,
      subtitle: 'Your studio contact picks this up. The invoice waits while we answer it.',
      requestTitle: `Question about invoice ${reference}`,
      emailSubject: `Question about invoice ${reference}`,
      ...partial,
    })
    setAskOpen(true)
  }

  const copyAll = async () => {
    const block = invoice.howToPay
    if (!block) return
    const lines = [
      block.bankName ? `Bank: ${block.bankName}` : null,
      block.accountName ? `Account name: ${block.accountName}` : null,
      block.accountNumber ? `Account number: ${block.accountNumber}` : null,
      `Reference: ${block.reference}`,
      `Amount: ${formatPortalMoney(block.amount, block.currency)}`,
      block.dueDate ? `Due: ${formatPortalDateLong(block.dueDate)}` : null,
    ].filter((line): line is string => line !== null)
    const ok = await copyText(lines.join('\n'))
    showToast(ok ? 'Payment details copied' : CLIPBOARD_REFUSED, ok ? 'success' : 'warning')
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <nav aria-label="Breadcrumb" className="flex items-center gap-2">
        {back}
        <span aria-hidden="true" style={{ color: 'var(--color-text-subtle)' }}>/</span>
        <span style={{ fontSize: '0.8125rem', color: 'var(--color-text)' }}>{reference}</span>
      </nav>

      {/* Hero */}
      <Card padding="lg">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between" style={{ gap: 'var(--space-5)' }}>
          <div style={{ display: 'grid', gap: 'var(--space-2)', minWidth: 0 }}>
            {invoice.orgName && (
              <span data-private="" style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                {invoice.orgName}
              </span>
            )}
            <h1 style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>
              {portalInvoiceLabel(invoice)}
            </h1>
            <div className="flex flex-wrap items-center gap-3">
              <PortalMoney size="hero">{formatPortalMoney(invoice.totalUsd, currency)}</PortalMoney>
              <PortalStatusPill label={stateCopy.label} tone={stateCopy.tone} />
            </div>
            <p
              style={{
                margin: 0,
                fontSize: '0.875rem',
                color: state === 'overdue' ? 'var(--color-danger)' : 'var(--color-text-muted)',
              }}
            >
              {portalDueSentence(invoice)}
            </p>
          </div>

          <div style={{ display: 'grid', gap: 'var(--space-2)', justifyItems: 'stretch' }}>
            {!settled && invoice.payUrl && (
              readOnly ? (
                <TahiButton
                  variant="primary"
                  size="lg"
                  disabled
                  title={READ_ONLY_REASON}
                  iconLeft={<CreditCard size={16} aria-hidden="true" />}
                >
                  Pay {formatPortalMoney(invoice.totalUsd, currency)}
                </TahiButton>
              ) : (
                <PortalPayLink href={invoice.payUrl} size="lg">
                  <CreditCard size={16} aria-hidden="true" />
                  Pay {formatPortalMoney(invoice.totalUsd, currency)}
                  <ExternalLink size={14} aria-hidden="true" />
                </PortalPayLink>
              )
            )}
            {!settled && !invoice.payUrl && invoice.howToPay && (
              <a
                href="#how-to-pay"
                className="tahi-focus-ring tahi-btn-lg"
                style={ANCHOR_LINK_STYLE}
              >
                <Landmark size={16} aria-hidden="true" />
                How to pay
              </a>
            )}
            <TahiButton
              variant="secondary"
              size="md"
              iconLeft={<MessageSquare size={15} aria-hidden="true" />}
              onClick={() => askAbout({})}
            >
              Question about this invoice
            </TahiButton>
            {!settled && invoice.payUrl && (
              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-subtle)', maxWidth: '18rem' }}>
                A secure payment page. Card or bank transfer, whichever suits you.
              </p>
            )}
          </div>
        </div>
      </Card>

      {/* Facts */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Reference" value={reference} />
        <Fact label="Issued" value={formatPortalDateLong(invoice.sentAt ?? invoice.createdAt)} />
        <Fact
          label="Due"
          value={formatPortalDateLong(invoice.dueDate)}
          tone={state === 'overdue' ? 'danger' : undefined}
        />
        {invoice.paidAt && <Fact label="Paid" value={formatPortalDateLong(invoice.paidAt)} />}
      </div>

      {/* Paid. The badge pair, not --color-success-bg: that fill is left
          un-overridden for dark mode (app/globals.css), so the chip painted a
          near-white tile on a near-black card. */}
      {settled && (
        <Card padding="md">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <span
              className="flex items-center justify-center shrink-0"
              style={{
                width: '2.25rem',
                height: '2.25rem',
                borderRadius: 'var(--radius-leaf-sm)',
                background: 'var(--badge-positive-bg)',
                color: 'var(--badge-positive-text)',
              }}
            >
              <Check size={18} aria-hidden="true" />
            </span>
            <div style={{ flex: 1 }}>
              <b style={{ display: 'block', fontSize: '0.875rem', color: 'var(--color-text)' }}>
                {invoice.paidAt ? `Paid ${formatPortalDateLong(invoice.paidAt)}` : 'Settled'}
              </b>
              <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                Nothing more to do on this one. Quote {reference} if you ever need to look it up.
              </span>
            </div>
          </div>
        </Card>
      )}

      {/* How to pay: only ever when the bill is owed and there is no link. */}
      {invoice.howToPay && (
        <Card padding="lg" id="how-to-pay">
          <div className="flex items-start gap-3" style={{ marginBottom: 'var(--space-3)' }}>
            <span
              className="flex items-center justify-center shrink-0"
              style={{
                width: '2.25rem',
                height: '2.25rem',
                borderRadius: 'var(--radius-leaf-sm)',
                background: 'var(--color-brand-50)',
                color: 'var(--color-brand-dark)',
              }}
            >
              <Landmark size={17} aria-hidden="true" />
            </span>
            <div>
              <h2 style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>
                How to pay
              </h2>
              <p style={{ margin: '0.125rem 0 0', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                Internet banking, from your account to ours. {invoice.howToPay.hint}
              </p>
            </div>
          </div>

          <div style={{ display: 'grid' }}>
            <PortalCopyRow
              label="Amount"
              value={formatPortalMoney(invoice.howToPay.amount, invoice.howToPay.currency)}
            />
            {invoice.howToPay.dueDate && (
              <PortalCopyRow label="Due" value={formatPortalDateLong(invoice.howToPay.dueDate)} />
            )}
            {invoice.howToPay.bankName && (
              <PortalCopyRow label="Bank" value={invoice.howToPay.bankName} />
            )}
            {invoice.howToPay.accountName && (
              <PortalCopyRow label="Account name" value={invoice.howToPay.accountName} />
            )}
            {invoice.howToPay.accountNumber && (
              <PortalCopyRow label="Account number" value={invoice.howToPay.accountNumber} mono />
            )}
            <PortalCopyRow label="Reference" value={invoice.howToPay.reference} mono />
          </div>

          <div className="flex flex-col sm:flex-row gap-2" style={{ marginTop: 'var(--space-4)' }}>
            <TahiButton
              variant="primary"
              size="md"
              onClick={() => { void copyAll() }}
            >
              Copy all details
            </TahiButton>
            <TahiButton
              variant="secondary"
              size="md"
              iconLeft={<CreditCard size={15} aria-hidden="true" />}
              onClick={() => askAbout({
                title: 'Ask for a card link',
                subtitle: `We will send a secure payment page for ${reference}.`,
                seed: `Could you send me a card payment link for ${reference}?`,
                requestTitle: `Card payment link for invoice ${reference}`,
                emailSubject: `Card payment link for invoice ${reference}`,
              })}
            >
              Pay by card instead
            </TahiButton>
          </div>
          <p style={{ margin: 'var(--space-3) 0 0', fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>
            Payments usually show against this invoice within one working day. If it has not moved by then,
            ask us and we will chase it.
          </p>
        </Card>
      )}

      {/* Line items */}
      <Card padding="none">
        <div
          className="flex items-start gap-3"
          style={{ padding: 'var(--space-4)', background: 'var(--color-bg-secondary)' }}
        >
          <span className="shrink-0" style={{ color: 'var(--color-text-muted)' }}>
            <FileText size={17} aria-hidden="true" />
          </span>
          <div>
            <h2 style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>
              What you are being charged for
            </h2>
            <p style={{ margin: '0.125rem 0 0', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
              Ask about any line and the invoice waits until we have answered.
            </p>
          </div>
        </div>

        {items.length === 0 ? (
          <p style={{ padding: 'var(--space-5)', margin: 0, fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
            This invoice is billed as a single amount, with no itemised lines. Ask us if you would like it broken down.
          </p>
        ) : (
          <>
            <div className="hidden lg:grid" style={LINE_HEAD_STYLE} aria-hidden="true">
              <span>Description</span>
              <span style={{ textAlign: 'right' }}>Qty</span>
              <span style={{ textAlign: 'right' }}>Unit</span>
              <span style={{ textAlign: 'right' }}>Amount</span>
              <span />
            </div>
            {items.map((item, index) => (
              <LineItem
                key={item.id}
                item={item}
                currency={currency}
                first={index === 0}
                onAsk={() => askAbout({
                  subtitle: `About one line on ${reference}.`,
                  seed: `About the line "${item.description}": `,
                })}
              />
            ))}
          </>
        )}

        <div
          style={{
            display: 'grid',
            gap: 'var(--space-2)',
            justifyItems: 'end',
            padding: 'var(--space-4)',
            borderTop: '1px solid var(--color-border-subtle)',
          }}
        >
          <TotalLine label="Subtotal" value={formatPortalMoney(subtotal, currency)} />
          {invoice.discountAmountUsd > 0 && (
            <TotalLine
              label="Discount"
              value={`-${formatPortalMoney(invoice.discountAmountUsd, currency)}`}
              tone="danger"
            />
          )}
          {tax > 0 && (
            <TotalLine
              label={currency === 'NZD' ? 'GST (15 percent)' : 'Tax'}
              value={formatPortalMoney(tax, currency)}
            />
          )}
          <TotalLine label={`Total ${currency}`} value={formatPortalMoney(invoice.totalUsd, currency)} strong />
        </div>
      </Card>

      {/* A note from the studio */}
      {invoice.notes && (
        <Card padding="md" style={{ background: 'var(--color-bg-secondary)' }}>
          <span
            style={{
              display: 'block',
              fontSize: '0.6875rem',
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: 'var(--color-text-subtle)',
              marginBottom: 'var(--space-2)',
            }}
          >
            A note from the studio
          </span>
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-text)', whiteSpace: 'pre-wrap' }}>
            {invoice.notes}
          </p>
        </Card>
      )}

      <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>
        Need this sent to someone else on your team, or a different due date? Ask us and we will sort it.
      </p>

      <PortalAskSheet
        open={askOpen}
        onClose={() => setAskOpen(false)}
        title={ask?.title ?? ''}
        subtitle={ask?.subtitle}
        seed={ask?.seed}
        requestTitle={ask?.requestTitle ?? `Question about invoice ${reference}`}
        emailSubject={ask?.emailSubject ?? `Question about invoice ${reference}`}
        placeholder="A sentence is plenty."
        readOnly={readOnly}
        readOnlyReason={READ_ONLY_REASON}
      />
    </div>
  )
}

// ── Pieces ────────────────────────────────────────────────────────────────────

/**
 * The line-item row, and the width it needs.
 *
 * 29.5rem of track minimums plus 3rem of gaps plus 2rem of row padding is
 * 34.5rem, or 552px. The dashboard content column is the viewport less the
 * 240px sidebar and the 3rem-a-side main padding, so it clears that from lg
 * (688px) but not at md (448px), where the old rule spilled the Amount and the
 * Ask off the right edge of a client's invoice. Below lg the card under it
 * carries the same four facts.
 */
const LINE_COLUMNS = 'minmax(8rem, 3fr) 4rem 6rem 6.5rem 5rem'

const LINE_HEAD_STYLE: React.CSSProperties = {
  gridTemplateColumns: LINE_COLUMNS,
  gap: 'var(--space-3)',
  alignItems: 'center',
  padding: 'var(--space-2) var(--space-4)',
  fontSize: '0.6875rem',
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--color-text-subtle)',
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: 'danger' }) {
  return (
    <Card padding="sm">
      <span style={{ display: 'block', fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--color-text-subtle)' }}>
        {label}
      </span>
      <span
        data-private=""
        style={{
          display: 'block',
          marginTop: '0.125rem',
          fontSize: '0.8125rem',
          fontWeight: 600,
          color: tone === 'danger' ? 'var(--color-danger)' : 'var(--color-text)',
        }}
      >
        {value}
      </span>
    </Card>
  )
}

function TotalLine({
  label,
  value,
  strong,
  tone,
}: {
  label: string
  value: string
  strong?: boolean
  tone?: 'danger'
}) {
  return (
    <div className="flex items-baseline justify-end gap-6" style={{ minWidth: '14rem' }}>
      <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{label}</span>
      <span
        data-private=""
        style={{
          fontSize: strong ? '1rem' : '0.875rem',
          fontWeight: strong ? 700 : 600,
          fontVariantNumeric: 'tabular-nums',
          color: tone === 'danger' ? 'var(--color-danger)' : 'var(--color-text)',
        }}
      >
        {value}
      </span>
    </div>
  )
}

/** One charge, with an always-visible Ask. Never revealed on hover. */
function LineItem({
  item,
  currency,
  first,
  onAsk,
}: {
  item: PortalInvoiceItem
  currency: string
  first: boolean
  onAsk: () => void
}) {
  const quantity = item.quantity ?? 1
  const divider: React.CSSProperties = first
    ? {}
    : { borderTop: '1px solid var(--color-border-subtle)' }

  const askButton = (
    <TahiButton
      variant="ghost"
      size="sm"
      className="w-full sm:w-auto"
      iconLeft={<MessageSquare size={13} aria-hidden="true" />}
      onClick={onAsk}
    >
      Ask
    </TahiButton>
  )

  return (
    <>
      <div
        className="hidden lg:grid"
        style={{
          ...divider,
          gridTemplateColumns: LINE_COLUMNS,
          gap: 'var(--space-3)',
          alignItems: 'center',
          padding: 'var(--space-3) var(--space-4)',
        }}
      >
        <span style={{ fontSize: '0.8125rem', color: 'var(--color-text)' }}>{item.description}</span>
        <span style={{ textAlign: 'right', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{quantity}</span>
        <span style={{ textAlign: 'right' }} data-private="">
          <PortalMoney>{formatPortalMoney(item.unitPriceUsd, currency)}</PortalMoney>
        </span>
        <span style={{ textAlign: 'right' }} data-private="">
          <PortalMoney>{formatPortalMoney(item.totalUsd, currency)}</PortalMoney>
        </span>
        <span className="flex justify-end">{askButton}</span>
      </div>

      <div
        className="lg:hidden"
        style={{ ...divider, display: 'grid', gap: 'var(--space-2)', padding: 'var(--space-4)' }}
      >
        <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text)' }}>{item.description}</span>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1" style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
          <span>Qty {quantity}</span>
          <span data-private="">Unit {formatPortalMoney(item.unitPriceUsd, currency)}</span>
          <span data-private="" style={{ fontWeight: 600, color: 'var(--color-text)' }}>
            {formatPortalMoney(item.totalUsd, currency)}
          </span>
        </span>
        {askButton}
      </div>
    </>
  )
}
