'use client'

/**
 * The client's Invoices list.
 *
 * The port of the portal-money design pack. It replaces the `!isAdmin` branch
 * of the shared admin invoice list, which handed a client admin vocabulary
 * (Sent, Viewed, Written Off, "Source: Xero"), admin chrome (a due-date range
 * picker over a field the portal never returns, a search across an org name
 * the portal never returns) and admin omissions (nothing to do about a Xero
 * bill with no hosted pay page).
 *
 * What a client gets here:
 *   three words   Awaiting payment, Overdue, Paid. Nothing else, ever.
 *   their money   every figure in the invoice's own currency, never converted
 *   an action     Pay now when a link exists, How to pay when the bank block
 *                 does, and a way to ask when neither helps
 *   no rail       no Source badge, no channel, no Stripe or Xero id
 *
 * The three honest denial states (member seat, feature off, unlinked login)
 * come from lib/portal-admin-label.ts unchanged: it is already the best
 * written copy on this surface.
 */

import * as React from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle, ArrowRight, CreditCard, Landmark, Lock, MessageSquare,
  RefreshCw, Receipt, Search, X as XIcon,
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
  formatCurrencyTotals,
  formatPortalDate,
  formatPortalMoney,
  isPortalInvoiceOpen,
  portalDueLabel,
  portalDueRelative,
  portalInvoiceLabel,
  portalInvoiceState,
  sumByCurrency,
  yearOf,
} from '@/lib/portal-invoice-view'
import { PageHeader } from '@/components/tahi/page-header'
import { Card } from '@/components/tahi/card'
import { EmptyState } from '@/components/tahi/empty-state'
import { TahiButton } from '@/components/tahi/tahi-button'
import { SegmentedControl } from '@/components/tahi/segmented-control'
import {
  PortalAskSheet, PortalLeafIcon, PortalMoney, PortalSkeleton, PortalStatusPill,
} from '@/components/tahi/portal/portal-money-kit'

// ── Types ─────────────────────────────────────────────────────────────────────

/** Exactly what GET /api/portal/invoices returns. Nothing studio-side. */
export interface PortalInvoiceRow {
  id: string
  orgId: string
  status: string
  totalAmount: number
  currency: string | null
  dueDate: string | null
  sentAt: string | null
  paidAt: string | null
  payUrl: string | null
  howToPay?: InvoiceHowToPay
  createdAt: string
  updatedAt: string
}

type Tab = 'all' | 'open' | 'paid'

const READ_ONLY_REASON = 'Read only while viewing as a client'

const PAY_LINK_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.375rem',
  padding: '0.375rem 0.875rem',
  borderRadius: 'var(--radius-leaf-sm)',
  background: 'var(--color-brand)',
  color: 'var(--color-bg)',
  fontSize: '0.8125rem',
  fontWeight: 600,
  textDecoration: 'none',
  whiteSpace: 'nowrap',
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function PortalInvoiceList() {
  const router = useRouter()
  const { isImpersonatingClient } = useImpersonation()
  const readOnly = isImpersonatingClient

  const [tab, setTab] = React.useState<Tab>('all')
  const [year, setYear] = React.useState('all')
  const [search, setSearch] = React.useState('')
  const [askOpen, setAskOpen] = React.useState(false)

  const { data, isLoading, error: fetchError, mutate } = useSWR<{ items?: PortalInvoiceRow[] }>(
    '/api/portal/invoices',
  )

  // A 403 on this route has three meanings and only one of them is "ask your
  // admin", so the body is classified rather than assumed.
  const denial = fetchError instanceof ApiError && fetchError.status === 403
    ? portalMoneyDenial(fetchError.info)
    : null
  const failed = !!fetchError && denial === null

  const { data: peopleData } = useSWR<{ items?: PortalPersonSummary[] }>(
    denial === 'member_seat' ? '/api/portal/people' : null,
  )

  // No figure survives a state the data did not: on a failed load and while
  // loading, the tiles, the counts and the filters all stand down.
  const blocked = denial !== null || failed
  const invoices = React.useMemo(
    () => (blocked ? [] : (data?.items ?? [])),
    [blocked, data],
  )
  const open = invoices.filter(isPortalInvoiceOpen)
  const paid = invoices.filter(inv => !isPortalInvoiceOpen(inv))
  const overdue = invoices.filter(inv => portalInvoiceState(inv) === 'overdue')

  const thisYear = String(new Date().getFullYear())
  const paidThisYear = paid.filter(inv => yearOf(inv.paidAt) === thisYear)
  const nextDue = open
    .filter(inv => inv.dueDate)
    .slice()
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))[0] ?? null

  const years = React.useMemo(() => {
    const found = new Set<string>()
    for (const inv of invoices) {
      const y = yearOf(inv.sentAt ?? inv.createdAt)
      if (y) found.add(y)
    }
    return [...found].sort().reverse()
  }, [invoices])

  const rows = React.useMemo(() => {
    const query = search.trim().toLowerCase()
    return invoices.filter(inv => {
      if (tab === 'open' && !isPortalInvoiceOpen(inv)) return false
      if (tab === 'paid' && isPortalInvoiceOpen(inv)) return false
      if (year !== 'all' && yearOf(inv.sentAt ?? inv.createdAt) !== year) return false
      if (query) {
        const haystack = `${invoiceReference(inv.id)} ${portalInvoiceLabel(inv)}`.toLowerCase()
        if (!haystack.includes(query)) return false
      }
      return true
    })
  }, [invoices, tab, year, search])

  // ── Denials ────────────────────────────────────────────────────────────────
  if (denial) {
    const copy = portalInvoiceDenialCopy(denial, portalAdminLabel(peopleData?.items))
    return (
      <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
        <PageHeader title="Invoices" subtitle="Billing for your organisation." />
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

  const filteredEmpty = rows.length === 0 && invoices.length > 0

  return (
    <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
      <PageHeader
        title="Invoices"
        subtitle="What we have billed you, what is paid, and what is still due."
      >
        <TahiButton
          variant="secondary"
          size="md"
          iconLeft={<MessageSquare size={15} aria-hidden="true" />}
          onClick={() => setAskOpen(true)}
        >
          Ask about billing
        </TahiButton>
      </PageHeader>

      {/* Summary. Withheld entirely while loading and after a failure, so no
          figure is ever on screen that the data did not put there. */}
      {isLoading && !data ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map(i => (
            <Card key={i} padding="md">
              <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
                <PortalSkeleton width="4.5rem" />
                <PortalSkeleton width="7rem" height="1.25rem" />
                <PortalSkeleton width="5.5rem" height="0.5625rem" />
              </div>
            </Card>
          ))}
        </div>
      ) : invoices.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <SummaryTile
            label="Still to pay"
            value={<PortalMoney size="lg">{formatCurrencyTotals(sumByCurrency(open))}</PortalMoney>}
            sub={`${open.length} ${open.length === 1 ? 'invoice' : 'invoices'}${overdue.length ? `, ${overdue.length} overdue` : ''}`}
            danger={overdue.length > 0}
          />
          <SummaryTile
            label={nextDue && portalInvoiceState(nextDue) === 'overdue' ? 'Waiting longest' : 'Next due'}
            value={(
              <span style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--color-text)' }}>
                {nextDue ? formatPortalDate(nextDue.dueDate) : 'Nothing due'}
              </span>
            )}
            sub={nextDue
              ? `${invoiceReference(nextDue.id)}, ${portalDueLabel(nextDue).toLowerCase()}`
              : 'You are all square'}
          />
          <SummaryTile
            label={`Paid in ${thisYear}`}
            value={<PortalMoney size="lg">{formatCurrencyTotals(sumByCurrency(paidThisYear))}</PortalMoney>}
            sub={`${paidThisYear.length} ${paidThisYear.length === 1 ? 'invoice' : 'invoices'} settled`}
          />
        </div>
      ) : null}

      {/* Overdue callout. Never a figure without the rows behind it. */}
      {overdue.length > 0 && (
        <Card padding="md" style={{ borderColor: 'var(--color-danger)', background: 'var(--color-danger-bg)' }}>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <span className="shrink-0" style={{ color: 'var(--color-danger)' }}>
              <AlertTriangle size={18} aria-hidden="true" />
            </span>
            <div style={{ flex: 1 }}>
              <b style={{ display: 'block', fontSize: '0.875rem', color: 'var(--color-text)' }}>
                <span data-private="">{formatCurrencyTotals(sumByCurrency(overdue))}</span> is past its due date.
              </b>
              <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                If something is wrong with it, ask us and we will hold it while we sort it out.
              </span>
            </div>
            <Link
              href={`/invoices/${overdue[0].id}`}
              className="tahi-focus-ring"
              style={{ textDecoration: 'none' }}
            >
              <TahiButton variant="secondary" size="md">
                Open {invoiceReference(overdue[0].id)}
              </TahiButton>
            </Link>
          </div>
        </Card>
      )}

      {/* Filters */}
      {invoices.length > 0 && (
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <SegmentedControl
            value={tab}
            onChange={setTab}
            ariaLabel="Filter invoices"
            options={[
              { value: 'all', label: `All (${invoices.length})` },
              { value: 'open', label: `To pay (${open.length})` },
              { value: 'paid', label: `Paid (${paid.length})` },
            ]}
          />
          <div className="flex flex-1 flex-col sm:flex-row gap-3 md:justify-end">
            <div className="relative" style={{ flex: '1 1 12rem', maxWidth: '20rem' }}>
              <span
                className="absolute inset-y-0 left-0 flex items-center pl-3"
                style={{ color: 'var(--color-text-subtle)', pointerEvents: 'none' }}
              >
                <Search size={15} aria-hidden="true" />
              </span>
              <input
                type="search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search invoices"
                aria-label="Search invoices"
                className="tahi-focus-ring min-h-11 md:min-h-9 w-full"
                style={{
                  padding: '0.375rem 0.75rem 0.375rem 2.25rem',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg)',
                  color: 'var(--color-text)',
                  fontSize: '0.8125rem',
                }}
              />
            </div>
            {years.length > 1 && (
              <label
                className="flex items-center gap-2"
                style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}
              >
                Year
                <select
                  value={year}
                  onChange={e => setYear(e.target.value)}
                  className="tahi-focus-ring min-h-11 md:min-h-9"
                  style={{
                    padding: '0.375rem 0.625rem',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg)',
                    color: 'var(--color-text)',
                    fontSize: '0.8125rem',
                  }}
                >
                  <option value="all">All years</option>
                  {years.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </label>
            )}
          </div>
        </div>
      )}

      {/* The list */}
      <Card padding="none">
        {/* The column ruler stands down whenever this card is holding an
            empty, filtered or failed state instead of rows, so a ruler never
            floats over nothing. */}
        {rows.length > 0 && (
          <div className="hidden md:grid" style={HEAD_STYLE} aria-hidden="true">
            <span>Invoice</span>
            <span>Status</span>
            <span>Issued</span>
            <span>Due</span>
            <span style={{ textAlign: 'right' }}>Amount</span>
            <span />
          </div>
        )}

        {isLoading && !data ? (
          <div>{[0, 1, 2, 3].map(i => <SkeletonRow key={i} />)}</div>
        ) : failed ? (
          <EmptyState
            icon={<AlertTriangle className="w-8 h-8" aria-hidden="true" />}
            title="We could not load your invoices"
            description="This one is on us. Nothing has changed on your account, and nothing here is out of date, because nothing here loaded."
            action={(
              <TahiButton
                variant="primary"
                size="md"
                iconLeft={<RefreshCw size={15} aria-hidden="true" />}
                onClick={() => { void mutate() }}
              >
                Try again
              </TahiButton>
            )}
          />
        ) : invoices.length === 0 ? (
          <EmptyState
            icon={<PortalLeafIcon />}
            title="No invoices yet"
            description="When we bill you, the invoice lands here and in your inbox on the same day."
            action={(
              <TahiButton
                variant="secondary"
                size="md"
                iconLeft={<MessageSquare size={15} aria-hidden="true" />}
                onClick={() => setAskOpen(true)}
              >
                Ask about billing
              </TahiButton>
            )}
          />
        ) : filteredEmpty ? (
          <EmptyState
            icon={<Search className="w-8 h-8" aria-hidden="true" />}
            title="Nothing matches that"
            description="Try clearing the search, or widening the year."
            action={(
              <TahiButton
                variant="secondary"
                size="md"
                iconLeft={<XIcon size={15} aria-hidden="true" />}
                onClick={() => { setSearch(''); setTab('all'); setYear('all') }}
              >
                Clear filters
              </TahiButton>
            )}
          />
        ) : (
          rows.map((invoice, index) => (
            <InvoiceRow
              key={invoice.id}
              invoice={invoice}
              first={index === 0}
              readOnly={readOnly}
              onOpen={() => router.push(`/invoices/${invoice.id}`)}
            />
          ))
        )}
      </Card>

      {rows.length > 0 && (
        <p style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', margin: 0 }}>
          Showing {rows.length} of {invoices.length} {invoices.length === 1 ? 'invoice' : 'invoices'}.
          Anything older is here too, we do not hide it.
        </p>
      )}

      <PortalAskSheet
        open={askOpen}
        onClose={() => setAskOpen(false)}
        title="Ask about billing"
        subtitle="A question about your invoices, your terms or how you are billed."
        requestTitle="Question about our billing"
        emailSubject="Question about our billing"
        allowRequest={false}
        readOnly={readOnly}
        readOnlyReason={READ_ONLY_REASON}
      />
    </div>
  )
}

// ── Pieces ────────────────────────────────────────────────────────────────────

const GRID_COLUMNS = 'minmax(9rem, 2fr) 9rem 7rem 9rem minmax(6rem, 1fr) 8.5rem'

const HEAD_STYLE: React.CSSProperties = {
  gridTemplateColumns: GRID_COLUMNS,
  gap: 'var(--space-3)',
  alignItems: 'center',
  padding: 'var(--space-3) var(--space-4)',
  background: 'var(--color-bg-secondary)',
  fontSize: '0.6875rem',
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--color-text-subtle)',
}

function SummaryTile({
  label,
  value,
  sub,
  danger,
}: {
  label: string
  value: React.ReactNode
  sub: string
  danger?: boolean
}) {
  return (
    <Card padding="md" style={danger ? { borderColor: 'var(--color-danger)' } : undefined}>
      <div style={{ display: 'grid', gap: '0.25rem' }}>
        <span style={{ fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--color-text-subtle)' }}>
          {label}
        </span>
        {value}
        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{sub}</span>
      </div>
    </Card>
  )
}

function SkeletonRow() {
  return (
    <div style={{ padding: 'var(--space-4)', display: 'grid', gap: 'var(--space-2)' }}>
      <PortalSkeleton width="9rem" height="0.875rem" />
      <PortalSkeleton width="13rem" height="0.6875rem" />
    </div>
  )
}

/**
 * One invoice.
 *
 * A row from md up and a card below it, with the same content in the same
 * order. The action is a full-width 2.75rem target on a phone, because paying
 * a bill is the one thing this page exists for.
 */
function InvoiceRow({
  invoice,
  first,
  readOnly,
  onOpen,
}: {
  invoice: PortalInvoiceRow
  first: boolean
  readOnly: boolean
  onOpen: () => void
}) {
  const state = portalInvoiceState(invoice)
  const copy = PORTAL_INVOICE_STATE_COPY[state]
  const reference = invoiceReference(invoice.id)
  const overdue = state === 'overdue'
  const dueTone = overdue ? 'var(--color-danger)' : 'var(--color-text-muted)'
  // Null once the due date is far enough away to speak for itself, so the
  // row never prints the same date twice in two different words.
  const relative = portalDueRelative(invoice)
  // Divider between siblings only, so no element carries a lone top border.
  const divider: React.CSSProperties = first
    ? {}
    : { borderTop: '1px solid var(--color-border-subtle)' }

  const title = (
    <button
      type="button"
      onClick={onOpen}
      className="tahi-focus-ring text-left"
      style={{
        display: 'grid',
        gap: '0.125rem',
        background: 'none',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        minWidth: 0,
      }}
    >
      <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text)' }}>
        {portalInvoiceLabel(invoice)}
      </span>
      <span style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>{reference}</span>
    </button>
  )

  return (
    <>
      {/* Row, from md up. Columns match the header exactly. */}
      <div
        className="hidden md:grid"
        style={{
          ...divider,
          gridTemplateColumns: GRID_COLUMNS,
          gap: 'var(--space-3)',
          alignItems: 'center',
          padding: 'var(--space-3) var(--space-4)',
        }}
      >
        {title}
        <span><PortalStatusPill label={copy.label} tone={copy.tone} /></span>
        <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
          {formatPortalDate(invoice.sentAt ?? invoice.createdAt)}
        </span>
        <span style={{ display: 'grid', gap: '0.0625rem' }}>
          <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: dueTone }}>
            {formatPortalDate(invoice.dueDate)}
          </span>
          {relative && (
            <span style={{ fontSize: '0.6875rem', color: dueTone }}>{relative}</span>
          )}
        </span>
        <span style={{ textAlign: 'right' }}>
          <PortalMoney>{formatPortalMoney(invoice.totalAmount, invoice.currency)}</PortalMoney>
        </span>
        <RowAction invoice={invoice} readOnly={readOnly} onOpen={onOpen} />
      </div>

      {/* Card, below md. Same content, same order, one full-width action. */}
      <div
        className="md:hidden"
        style={{ ...divider, display: 'grid', gap: 'var(--space-3)', padding: 'var(--space-4)' }}
      >
        <div className="flex items-start justify-between gap-3">
          {title}
          <PortalMoney>{formatPortalMoney(invoice.totalAmount, invoice.currency)}</PortalMoney>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <PortalStatusPill label={copy.label} tone={copy.tone} />
          <span style={{ fontSize: '0.75rem', color: dueTone }}>{portalDueLabel(invoice)}</span>
        </div>
        <RowAction invoice={invoice} readOnly={readOnly} onOpen={onOpen} />
      </div>
    </>
  )
}

/** The one thing this row wants the client to do. */
function RowAction({
  invoice,
  readOnly,
  onOpen,
}: {
  invoice: PortalInvoiceRow
  readOnly: boolean
  onOpen: () => void
}) {
  const settled = !isPortalInvoiceOpen(invoice)

  if (settled) {
    return (
      <div className="flex md:justify-end">
        <TahiButton
          variant="ghost"
          size="md"
          className="w-full md:w-auto"
          iconLeft={<Receipt size={15} aria-hidden="true" />}
          onClick={onOpen}
        >
          View receipt
        </TahiButton>
      </div>
    )
  }

  if (invoice.payUrl) {
    if (readOnly) {
      return (
        <div className="flex md:justify-end">
          <TahiButton
            variant="primary"
            size="md"
            className="w-full md:w-auto"
            disabled
            title={READ_ONLY_REASON}
            iconLeft={<CreditCard size={15} aria-hidden="true" />}
          >
            Pay now
          </TahiButton>
        </div>
      )
    }
    return (
      <div className="flex md:justify-end">
        <a
          href={invoice.payUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          className="tahi-focus-ring min-h-11 md:min-h-9 w-full md:w-auto"
          style={PAY_LINK_STYLE}
        >
          <CreditCard size={15} aria-hidden="true" />
          Pay now
        </a>
      </div>
    )
  }

  if (invoice.howToPay) {
    return (
      <div className="flex md:justify-end">
        <TahiButton
          variant="secondary"
          size="md"
          className="w-full md:w-auto"
          iconLeft={<Landmark size={15} aria-hidden="true" />}
          onClick={onOpen}
        >
          How to pay
        </TahiButton>
      </div>
    )
  }

  return (
    <div className="flex md:justify-end">
      <TahiButton
        variant="ghost"
        size="md"
        className="w-full md:w-auto"
        icon={<ArrowRight size={15} aria-hidden="true" />}
        onClick={onOpen}
      >
        Open invoice
      </TahiButton>
    </div>
  )
}
