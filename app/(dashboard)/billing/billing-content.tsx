'use client'

import { useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CreditCard, ExternalLink, FileText, RefreshCw, Lock, AlertTriangle } from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'
import { EmptyState } from '@/components/tahi/empty-state'
import { apiPath } from '@/lib/api'
import { PageHeader } from '@/components/tahi/page-header'
import { ApiError } from '@/lib/swr-fetcher'
import {
  portalAdminLabel,
  portalMoneyDenial,
  portalInvoiceDenialCopy,
  type PortalPersonSummary,
} from '@/lib/portal-admin-label'
import { invoiceReference } from '@/lib/invoice-billing'
import { Card } from '@/components/tahi/card'
import { Badge, type BadgeTone } from '@/components/tahi/badge'
import { DataTable, type DataTableColumn } from '@/components/tahi/data-table'
import { KPICard } from '@/components/tahi/kpi-card'
import { Money } from '@/components/tahi/money'
import { isOwedInvoice } from '@/lib/invoice-status'
import { formatCurrency } from '@/lib/currency'
import { cadenceWord } from '@/lib/next-invoice-date'
import {
  PORTAL_INVOICE_STATE_COPY,
  formatPortalDate,
  formatPortalMoney,
  portalDueLabel,
  portalInvoiceLabel,
  portalInvoiceState,
} from '@/lib/portal-invoice-view'
import { PortalMoney, PortalStatusPill, PortalLeafIcon } from '@/components/tahi/portal/portal-money-kit'
// Shared with the invoices list and detail so a subscription-adjacent invoice
// pill never disagrees with the one on /invoices. Relative import: this
// component lives at app/(dashboard)/billing, the shared vocabulary at
// app/(dashboard)/invoices.
import { InvoiceStatusBadge, isInvoiceOverdue } from '../invoices/invoice-status'

interface InvoiceRow {
  id: string
  status: string
  /** The real invoice number (migration 0096). NULL falls back to the short id. */
  number?: string | null
  amountUsd: number
  totalUsd: number
  totalAmount?: number
  currency: string
  dueDate: string | null
  sentAt?: string | null
  paidAt: string | null
  createdAt: string
}

/** Either amount field, whichever the endpoint that raised this row carries. */
function invoiceAmount(inv: InvoiceRow): number {
  return inv.totalUsd ?? inv.totalAmount ?? 0
}

interface SubscriptionRow {
  id: string
  planType: string
  planLabel?: string
  status: string
  billingInterval?: string
  includedAddons?: string[]
  addonDetails?: Array<{ key: string; label: string; monthlyValue: number }>
  currentPeriodEnd: string | null
  commitmentEndDate?: string | null
  /** 'stripe' | 'xero': which rail this client actually bills on. Used only
   *  to name the rail when there is no real or projected next-invoice date. */
  invoiceChannel?: string | null
  /** The real currentPeriodEnd, or a cadence projection from
   *  currentPeriodStart. Null only when neither is known. */
  nextInvoiceDate?: string | null
  /** False when the org has no Stripe customer: nothing to open, so no button. */
  canManagePayment?: boolean
}

interface PortalBilling {
  monthlyRate: number
  /** The currency monthlyRate and cycleTotal are actually billed in. */
  currency?: string
  cycleMonths: number
  cycleTotal: number
  monthlySavings: number
  cycleSavings: number
}

const INTERVAL_LABELS: Record<string, string> = {
  monthly: 'Monthly',
  quarterly: '3-Month',
  annual: '12-Month',
}

export function BillingContent({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter()
  const [portalLoading, setPortalLoading] = useState(false)
  const [portalError, setPortalError] = useState('')

  // Portal-only fetches. Keys are null for admins so SWR skips them;
  // the admin path renders <AdminBillingView /> before these values are used.
  const {
    data: invoicesData,
    isLoading: invoicesLoading,
    error: invoicesError,
    mutate: mutateInvoices,
  } = useSWR<{ items: InvoiceRow[] }>(!isAdmin ? '/api/portal/invoices?status=all' : null)
  const {
    data: subData,
    isLoading: subLoading,
    error: subError,
    mutate: mutateSub,
  } = useSWR<{ subscription?: SubscriptionRow; billing?: PortalBilling }>(
    !isAdmin ? '/api/portal/subscription' : null
  )

  // Both portal reads behind this page are money, and both turn a plain member
  // seat away by design. Reaching /billing (the plan CTAs and the subscription
  // notification link both land here) used to answer that with an empty page:
  // no plan, no invoices, no reason. Same classifier and same sentences the
  // /invoices page uses, so the two money surfaces cannot say different things
  // to the same person.
  const moneyError = invoicesError ?? subError
  const denial = !isAdmin && moneyError instanceof ApiError && moneyError.status === 403
    ? portalMoneyDenial(moneyError.info)
    : null
  const { data: peopleData } = useSWR<{ items?: PortalPersonSummary[] }>(
    denial === 'member_seat' ? '/api/portal/people' : null,
  )
  const denialCopy = denial
    ? portalInvoiceDenialCopy(denial, portalAdminLabel(peopleData?.items))
    : null

  // A failure that is not a denial is honest, not silent: without this the
  // page used to fall straight through to "No active subscription found" and
  // "No invoices yet" on a load that never actually answered.
  const failed = !isAdmin && !!moneyError && !denial

  const invoices = invoicesData?.items ?? []
  const subscription = subData?.subscription ?? null
  const billing = subData?.billing ?? null
  const loading = invoicesLoading || subLoading

  async function refresh() {
    await Promise.all([mutateInvoices(), mutateSub()])
  }

  // A failure here used to go to the console, so the click looked like it did
  // nothing. Say it on the page instead, in the client's own vocabulary.
  const PORTAL_UNAVAILABLE = 'Payment management is not available on your account. Your studio contact can help.'

  async function openBillingPortal() {
    setPortalLoading(true)
    setPortalError('')
    try {
      const res = await fetch(apiPath('/api/portal/billing/session'))
      if (!res.ok) {
        setPortalError(PORTAL_UNAVAILABLE)
        return
      }
      const data = await res.json() as { url?: string }
      if (data.url) {
        window.open(data.url, '_blank')
      } else {
        setPortalError(PORTAL_UNAVAILABLE)
      }
    } catch {
      setPortalError('Could not open billing right now. Please try again.')
    } finally {
      setPortalLoading(false)
    }
  }

  // Admin billing dashboard
  if (isAdmin) {
    return <AdminBillingView />
  }

  // Denied, not broken. Every hook above has already run, so this early return
  // is order-safe.
  if (denialCopy) {
    return (
      <div className="space-y-6">
        <PageHeader title="Billing" subtitle="Your plan and invoices." />
        <Card padding="none">
          <EmptyState
            icon={<Lock className="w-6 h-6" />}
            title={denialCopy.title}
            description={denialCopy.description}
          />
        </Card>
      </div>
    )
  }

  // "TBC" used to be the only fallback here, which read as an operational gap
  // even for a Xero-rail client whose retainer has no Stripe period to point
  // at by design. The API projects a real date from the cadence when it can
  // (lib/next-invoice-date.ts); only when it truly cannot does this name the
  // rail instead, exactly like the client home does.
  const nextInvoiceLabel = subscription?.nextInvoiceDate
    ? formatPortalDate(subscription.nextInvoiceDate)
    : subscription?.invoiceChannel === 'xero'
      ? `Invoiced ${cadenceWord(subscription.billingInterval)} through Xero`
      : 'TBC'

  const invoiceHistoryColumns: DataTableColumn<InvoiceRow>[] = [
    {
      key: 'invoice',
      header: 'Invoice',
      sortable: true,
      sortValue: r => r.dueDate ?? r.createdAt,
      minWidth: '11rem',
      render: r => (
        <div style={{ display: 'grid', gap: '0.125rem' }}>
          <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)' }}>
            {portalInvoiceLabel(r)}
          </span>
          <span data-private style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>
            {invoiceReference(r.id, r.number)}
          </span>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      sortValue: r => portalInvoiceState(r),
      width: '9rem',
      render: r => {
        const copy = PORTAL_INVOICE_STATE_COPY[portalInvoiceState(r)]
        return <PortalStatusPill label={copy.label} tone={copy.tone} />
      },
    },
    {
      key: 'due',
      header: 'Due',
      sortable: true,
      sortValue: r => r.dueDate ?? '',
      width: '9rem',
      render: r => (
        <span style={{
          fontSize: '0.8125rem',
          color: portalInvoiceState(r) === 'overdue' ? 'var(--color-danger)' : 'var(--color-text-muted)',
        }}>
          {portalDueLabel(r)}
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      sortable: true,
      sortValue: r => invoiceAmount(r),
      align: 'right',
      width: '8rem',
      render: r => <PortalMoney>{formatPortalMoney(invoiceAmount(r), r.currency)}</PortalMoney>,
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing"
        subtitle="View your plan, invoices, and manage billing."
      >
        <TahiButton variant="secondary" size="sm" onClick={() => void refresh()} iconLeft={<RefreshCw className="w-3.5 h-3.5" />}>
          Refresh
        </TahiButton>
      </PageHeader>

      {loading ? (
        <LoadingSkeleton rows={5} />
      ) : failed ? (
        <Card padding="none">
          <EmptyState
            icon={<AlertTriangle className="w-6 h-6" />}
            title="We could not load your billing"
            description="This one is on us. Nothing has changed on your account. Try again in a moment."
            action={
              <TahiButton size="sm" variant="secondary" iconLeft={<RefreshCw className="w-3.5 h-3.5" />} onClick={() => void refresh()}>
                Try again
              </TahiButton>
            }
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Current Plan */}
          <Card padding="md">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h2 className="text-lg font-semibold text-[var(--color-text)] mb-1">Current Plan</h2>
                {subscription ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-[var(--color-text)] capitalize">
                        {subscription.planLabel ?? subscription.planType}
                      </span>
                      <Badge tone={subscription.status === 'active' ? 'positive' : 'neutral'} variant="soft" size="sm">
                        {subscription.status}
                      </Badge>
                      {subscription.billingInterval && subscription.billingInterval !== 'monthly' && (
                        <Badge tone="brand" variant="soft" size="sm">
                          {INTERVAL_LABELS[subscription.billingInterval] ?? subscription.billingInterval}
                        </Badge>
                      )}
                    </div>

                    {/* Billing details */}
                    <div className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                      <p>
                        Next invoice: <span className="text-[var(--color-text)]">{nextInvoiceLabel}</span>
                      </p>
                      {billing && billing.monthlyRate > 0 && (
                        <p>
                          {billing.cycleMonths > 1 ? `${billing.cycleMonths}-month` : 'Monthly'} total:{' '}
                          <Money
                            native={billing.cycleTotal}
                            currency={billing.currency ?? 'NZD'}
                            className="text-[var(--color-text)] font-medium"
                          />
                        </p>
                      )}
                    </div>

                    {/* Included add-ons */}
                    {subscription.addonDetails && subscription.addonDetails.length > 0 && (
                      <div
                        className="rounded-lg p-3 mt-1"
                        style={{ background: 'var(--color-brand-50)', border: '1px solid var(--color-brand-100)' }}
                      >
                        <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--color-brand-dark)' }}>Included with your plan</p>
                        <div className="flex flex-col gap-1">
                          {subscription.addonDetails.map(addon => (
                            <div key={addon.key} className="flex items-center justify-between text-xs">
                              <span style={{ color: 'var(--color-brand)' }}>{addon.label}</span>
                              {/* Add-on values are the studio's estimated NZD
                                  worth (lib/billing.ts ADDON_VALUES), not a
                                  figure this client was ever billed, so it is
                                  never converted to their negotiated currency. */}
                              <span className="text-[var(--color-text-muted)]">{formatCurrency(addon.monthlyValue, 'NZD')}/mo value</span>
                            </div>
                          ))}
                        </div>
                        {billing && billing.monthlySavings > 0 && (
                          <p className="text-xs font-medium mt-2" style={{ color: 'var(--color-brand)' }}>
                            You save {formatCurrency(billing.monthlySavings * 12, 'NZD')}/yr vs paying monthly for add-ons
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-[var(--color-text-muted)]">No active subscription found.</p>
                )}
              </div>
              {/* Only a Stripe-rail client has a portal to manage. A client
                  invoiced through Xero has no Stripe customer, so the button
                  would 404 on every press. */}
              {subscription?.canManagePayment && (
                <TahiButton
                  size="sm"
                  onClick={openBillingPortal}
                  disabled={portalLoading}
                  iconLeft={<ExternalLink className="w-3.5 h-3.5" />}
                >
                  {portalLoading ? 'Loading...' : 'Manage Billing'}
                </TahiButton>
              )}
            </div>
            {portalError && (
              <p className="text-xs mt-3" role="status" style={{ color: 'var(--color-danger)' }}>
                {portalError}
              </p>
            )}
          </Card>

          {/* Invoice History */}
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4">Invoice History</h2>
            <Card padding="none">
              <DataTable<InvoiceRow>
                ariaLabel="Invoice history"
                columns={invoiceHistoryColumns}
                rows={invoices}
                getRowId={r => r.id}
                defaultSort={{ key: 'due', dir: 'desc' }}
                mobileCard={inv => (
                  <InvoiceHistoryMobileCard invoice={inv} onOpen={() => router.push(`/invoices/${inv.id}`)} />
                )}
                onRowClick={r => router.push(`/invoices/${r.id}`)}
                empty={
                  <EmptyState
                    icon={<PortalLeafIcon />}
                    title="No invoices yet"
                    description="Your invoice history will appear here once invoices are generated."
                  />
                }
              />
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * One invoice, as a full-width tappable card. The four-column table
 * (Invoice, Status, Due, Amount) clears about 37rem before it needs to
 * scroll, well past a 375px phone, so below md this replaces the table
 * entirely rather than handing the client a horizontal scrollbar.
 */
function InvoiceHistoryMobileCard({
  invoice,
  onOpen,
}: {
  invoice: InvoiceRow
  onOpen: () => void
}) {
  const state = portalInvoiceState(invoice)
  const copy = PORTAL_INVOICE_STATE_COPY[state]
  return (
    <button
      type="button"
      onClick={onOpen}
      className="tahi-focus-ring w-full text-left min-h-11"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        padding: '0.875rem',
        border: 'none',
        borderBottom: '1px solid var(--color-border-subtle)',
        background: 'none',
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
        <span style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-text)' }}>
          {portalInvoiceLabel(invoice)}
        </span>
        <PortalMoney>{formatPortalMoney(invoiceAmount(invoice), invoice.currency)}</PortalMoney>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.625rem' }}>
        <PortalStatusPill label={copy.label} tone={copy.tone} />
        <span data-private style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>
          {invoiceReference(invoice.id, invoice.number)}
        </span>
      </div>
      <span style={{
        fontSize: '0.75rem',
        color: state === 'overdue' ? 'var(--color-danger)' : 'var(--color-text-muted)',
      }}>
        {portalDueLabel(invoice)}
      </span>
    </button>
  )
}

// -- Admin Billing View --

interface AdminSubscription {
  id: string
  orgId: string
  orgName: string
  planType: string
  status: string
  hasPrioritySupport: boolean
  currentPeriodEnd: string | null
  billingInterval?: string
}

/**
 * The subscription lifecycle vocabulary (active / trialing / past_due /
 * paused / cancelled), distinct from an invoice's own six-word vocabulary.
 * The old badge here read every subscription status through
 * INVOICE_STATUS_TONE, which has no 'active' key, so a healthy retainer
 * silently fell back to the Draft tone (neutral grey) while still printing
 * the word "active": right label, wrong colour, on every row.
 */
const SUBSCRIPTION_STATUS_CONFIG: Record<string, { label: string; tone: BadgeTone }> = {
  active:    { label: 'Active',    tone: 'positive' },
  trialing:  { label: 'Trialing',  tone: 'info'      },
  past_due:  { label: 'Past due',  tone: 'danger'    },
  paused:    { label: 'Paused',    tone: 'warning'   },
  cancelled: { label: 'Cancelled', tone: 'neutral'   },
}

function SubscriptionStatusBadge({ status }: { status: string }) {
  const cfg = SUBSCRIPTION_STATUS_CONFIG[status]
    ?? { label: status.replace(/_/g, ' '), tone: 'neutral' as BadgeTone }
  return <Badge tone={cfg.tone} variant="soft" size="sm">{cfg.label}</Badge>
}

/** Whole-dollar, matching /invoices' own admin Amount column (Decision #045). */
function formatInvoiceCurrency(amount: number, currency: string | null): string {
  return formatCurrency(amount, currency ?? 'NZD')
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-'
  try {
    const d = new Date(dateStr.includes('T') ? dateStr : dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch { return '-' }
}

function AdminBillingView() {
  const router = useRouter()
  const {
    data: subsData,
    isLoading: subsLoading,
    error: subsError,
    mutate: mutateSubs,
  } = useSWR<{ items: AdminSubscription[] }>('/api/admin/subscriptions')
  const {
    data: invData,
    isLoading: invLoading,
    error: invError,
    mutate: mutateInv,
  } = useSWR<{ items: InvoiceRow[] }>('/api/admin/invoices?limit=10')

  const subs = subsData?.items ?? []
  const recentInvoices = invData?.items ?? []
  const loading = subsLoading || invLoading
  const failed = !loading && (!!subsError || !!invError)

  async function refresh() {
    await Promise.all([mutateSubs(), mutateInv()])
  }

  const activeSubs = subs.filter(s => s.status === 'active')

  // Group active subs by billing interval
  const intervalCounts: Record<string, number> = {}
  for (const sub of activeSubs) {
    const interval = sub.billingInterval ?? 'monthly'
    intervalCounts[interval] = (intervalCounts[interval] ?? 0) + 1
  }

  const outstandingTotal = recentInvoices
    .filter(i => isOwedInvoice(i.status))
    .reduce((s, i) => s + invoiceAmount(i), 0)

  const subscriptionColumns: DataTableColumn<AdminSubscription>[] = [
    {
      key: 'client',
      header: 'Client',
      sortable: true,
      sortValue: r => r.orgName.toLowerCase(),
      minWidth: '12rem',
      link: { href: r => `/clients/${r.orgId}` },
      render: r => (
        <span style={{ fontWeight: 500, color: 'var(--color-text)' }}>{r.orgName}</span>
      ),
    },
    {
      key: 'plan',
      header: 'Plan',
      sortable: true,
      sortValue: r => r.planType,
      width: '8rem',
      render: r => (
        <span className="capitalize" style={{ fontSize: '0.8125rem', color: 'var(--color-text)' }}>
          {r.planType}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      sortValue: r => r.status,
      width: '8rem',
      render: r => <SubscriptionStatusBadge status={r.status} />,
    },
    {
      key: 'interval',
      header: 'Interval',
      width: '8rem',
      render: r => (
        <Badge tone="neutral" variant="soft" size="sm">
          {INTERVAL_LABELS[r.billingInterval ?? 'monthly'] ?? 'Monthly'}
        </Badge>
      ),
    },
    {
      key: 'priority',
      header: 'Priority',
      width: '6rem',
      render: r => (
        <span style={{ color: 'var(--color-text-muted)' }}>{r.hasPrioritySupport ? 'Yes' : 'No'}</span>
      ),
    },
    {
      key: 'nextBilling',
      header: 'Next Billing',
      sortable: true,
      sortValue: r => r.currentPeriodEnd ?? '',
      width: '8rem',
      render: r => (
        <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
          {formatDate(r.currentPeriodEnd)}
        </span>
      ),
    },
  ]

  const recentInvoiceColumns: DataTableColumn<InvoiceRow>[] = [
    {
      key: 'number',
      header: 'Invoice',
      width: '10rem',
      render: r => (
        <span style={{ fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: '0.78125rem', color: 'var(--color-text)' }}>
          {invoiceReference(r.id, r.number)}
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      width: '8rem',
      render: r => (
        <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>
          {formatInvoiceCurrency(invoiceAmount(r), r.currency)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '8rem',
      render: r => <InvoiceStatusBadge status={r.status} dueDate={r.dueDate} />,
    },
    {
      key: 'dueDate',
      header: 'Due Date',
      width: '8rem',
      render: r => (
        <span style={{
          fontSize: '0.8125rem',
          color: isInvoiceOverdue(r.dueDate, r.status) ? 'var(--color-danger)' : 'var(--color-text-muted)',
        }}>
          {formatDate(r.dueDate)}
        </span>
      ),
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <PageHeader
        title="Billing"
        subtitle="Subscriptions, invoices, and revenue overview."
      >
        <TahiButton variant="secondary" size="sm" onClick={() => void refresh()} iconLeft={<RefreshCw className="w-3.5 h-3.5" />}>
          Refresh
        </TahiButton>
      </PageHeader>

      {loading ? (
        <LoadingSkeleton rows={6} />
      ) : failed ? (
        <Card padding="none">
          <EmptyState
            icon={<AlertTriangle className="w-6 h-6" />}
            title="We could not load billing"
            description="Nothing has changed on any account. Try again in a moment."
            action={
              <TahiButton size="sm" variant="secondary" iconLeft={<RefreshCw className="w-3.5 h-3.5" />} onClick={() => void refresh()}>
                Try again
              </TahiButton>
            }
          />
        </Card>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard label="Active Subscriptions" value={activeSubs.length} />
            <KPICard label="Total Clients" value={subs.length} />
            <KPICard label="Recent Invoices" value={recentInvoices.length} />
            <KPICard label="Outstanding" value={formatInvoiceCurrency(outstandingTotal, 'NZD')} />
          </div>

          {/* Billing Interval Summary (T470) */}
          {Object.keys(intervalCounts).length > 0 && (
            <div>
              <h2 className="text-base font-semibold mb-3" style={{ color: 'var(--color-text)' }}>
                Clients by Billing Interval
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {(['monthly', 'quarterly', 'annual'] as const).map(interval => {
                  const count = intervalCounts[interval] ?? 0
                  return (
                    <Card key={interval} padding="md">
                      <div className="flex items-center gap-3">
                        <div
                          className="flex items-center justify-center flex-shrink-0"
                          style={{
                            width: '2.5rem',
                            height: '2.5rem',
                            borderRadius: 'var(--radius-leaf-sm)',
                            background: count > 0 ? 'var(--color-brand-50)' : 'var(--color-bg-tertiary)',
                            color: count > 0 ? 'var(--color-brand)' : 'var(--color-text-subtle)',
                          }}
                        >
                          <CreditCard className="w-4 h-4" aria-hidden="true" />
                        </div>
                        <div>
                          <p className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                            {INTERVAL_LABELS[interval] ?? interval}
                          </p>
                          <p className="text-xl font-bold" style={{ color: 'var(--color-text)' }}>
                            {count} {count === 1 ? 'client' : 'clients'}
                          </p>
                        </div>
                      </div>
                    </Card>
                  )
                })}
              </div>
            </div>
          )}

          {/* Active Subscriptions */}
          <div>
            <h2 className="text-base font-semibold mb-3" style={{ color: 'var(--color-text)' }}>
              Active Subscriptions
            </h2>
            <Card padding="none">
              <DataTable<AdminSubscription>
                ariaLabel="Active subscriptions"
                columns={subscriptionColumns}
                rows={subs}
                getRowId={r => r.id}
                defaultSort={{ key: 'client', dir: 'asc' }}
                empty={
                  <EmptyState
                    icon={<CreditCard className="w-6 h-6" />}
                    title="No subscriptions"
                    description="Client subscriptions will appear here."
                  />
                }
              />
            </Card>
          </div>

          {/* Recent Invoices */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
                Recent Invoices
              </h2>
              <Link href="/invoices" className="text-sm font-medium" style={{ color: 'var(--color-brand)', textDecoration: 'none', cursor: 'pointer' }}>
                View all
              </Link>
            </div>
            <Card padding="none">
              <DataTable<InvoiceRow>
                ariaLabel="Recent invoices"
                columns={recentInvoiceColumns}
                rows={recentInvoices}
                getRowId={r => r.id}
                onRowClick={r => router.push(`/invoices/${r.id}`)}
                empty={
                  <EmptyState
                    icon={<FileText className="w-6 h-6" />}
                    title="No invoices yet"
                    description="Invoices will appear here once created."
                  />
                }
              />
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
