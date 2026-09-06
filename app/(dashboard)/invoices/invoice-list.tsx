'use client'

import type * as React from 'react'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Plus, FileText, RefreshCw, Download, X as XIcon, Lock, AlertTriangle,
} from 'lucide-react'
import { type DateRange } from '@/components/tahi/date-range-picker'
import { apiPath } from '@/lib/api'
import { ApiError } from '@/lib/swr-fetcher'
// The client's rail, terms and currency decide what a new invoice opens on.
import {
  INVOICE_CHANNEL_SETTING_KEY,
  invoiceChannelLabel,
} from '@/lib/invoice-channel'
import { invoiceReference, paymentTermsLabel } from '@/lib/invoice-billing'
import {
  DEFAULT_INVOICE_CURRENCY,
  defaultCurrency,
  defaultDestination,
  defaultDueDate,
  localCalendarDay,
  resolveChannelDefaults,
} from '@/lib/invoice-defaults'
import {
  portalAdminLabel,
  portalMoneyDenial,
  portalInvoiceDenialCopy,
  type PortalPersonSummary,
} from '@/lib/portal-admin-label'
import { useToast } from '@/components/tahi/toast'
import { useImpersonation } from '@/components/tahi/impersonation-banner'
import { formatCurrency } from '@/lib/currency'
import { useDisplayCurrency } from '@/lib/display-currency-context'
import { PageHeader } from '@/components/tahi/page-header'
import { useUserPreference, oneOf } from '@/lib/use-user-preference'

import { TahiButton } from '@/components/tahi/tahi-button'
import { type BadgeTone } from '@/components/tahi/badge'
// Shared with the invoice detail page so the two surfaces cannot disagree
// about what raised a bill, or about what state it is in.
import { SourceBadge } from './source-badge'
import {
  InvoiceStatusBadge,
  effectiveInvoiceStatus,
  isInvoiceOverdue,
} from './invoice-status'
import { Card } from '@/components/tahi/card'
import { EmptyState } from '@/components/tahi/empty-state'
import { SlideOver } from '@/components/tahi/slide-over'
import { SegmentedControl, type SegmentedControlOption } from '@/components/tahi/segmented-control'
import { Input, Select, Textarea } from '@/components/tahi/input'
import { DataTable, type DataTableColumn } from '@/components/tahi/data-table'
import { FilterBar, type FilterDef, type ActiveFilter } from '@/components/tahi/filter-bar'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Invoice {
  id: string
  orgId: string
  orgName: string | null
  status: string
  /**
   * The real invoice number (migration 0096), e.g. INV-2026-0001. NULL on every
   * row raised before the column existed and on imports with nothing to carry
   * over, so it always goes through invoiceReference for the short-id fallback.
   */
  number?: string | null
  source: string | null
  // Admin projection only; the portal list withholds the integration ids.
  stripeInvoiceId?: string | null
  xeroInvoiceId?: string | null
  /** Stripe hosted invoice page, served to the client so they can pay. */
  payUrl?: string | null
  totalAmount: number
  currency: string | null
  dueDate: string | null
  createdAt: string
  updatedAt: string
}

// ─── Config ───────────────────────────────────────────────────────────────────

const SUPPORTED_CURRENCIES = ['NZD', 'USD', 'AUD', 'GBP', 'EUR'] as const

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

/** A bill the client still owes, with somewhere to pay it. */
function isPayable(inv: Invoice): boolean {
  return !!inv.payUrl && inv.status !== 'paid' && inv.status !== 'written_off'
}

// Height comes from the min-h-11 / md:min-h-9 utilities on the element so the
// touch target is 2.75rem on mobile without making every desktop row taller.
const PAY_LINK_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0.375rem 0.875rem',
  borderRadius: 'var(--radius-leaf-sm)',
  background: 'var(--color-brand)',
  color: 'var(--color-bg)',
  fontSize: '0.8125rem',
  fontWeight: 600,
  textDecoration: 'none',
  whiteSpace: 'nowrap',
}

// ─── Client mobile card ───────────────────────────────────────────────────────
// The client's column set (amount, status, due, created, pay) is about 41rem
// wide, so below md the table put Pay now off the right edge of a 375px screen
// behind a horizontal scroll. One invoice as a card instead: the amount and the
// status on the top line, the dates under it, and the pay button in the body
// where a thumb can reach it.

function InvoiceMobileCard({
  invoice,
  amountLabel,
  onOpen,
}: {
  invoice: Invoice
  amountLabel: string
  onOpen: () => void
}) {
  return (
    <div
      onClick={onOpen}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.625rem',
        padding: '0.875rem',
        borderBottom: '1px solid var(--color-border-subtle)',
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
        {/* A real link, so the card is reachable by keyboard as well as by tap
            (the wrapping div's onClick is the thumb-sized version of this). */}
        <Link
          data-private
          href={`/invoices/${invoice.id}`}
          className="tahi-focus-ring"
          onClick={e => e.stopPropagation()}
          style={{
            fontSize: '1.0625rem',
            fontWeight: 600,
            color: 'var(--color-text)',
            textDecoration: 'none',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          {amountLabel}
        </Link>
        <InvoiceStatusBadge status={invoice.status} dueDate={invoice.dueDate} />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', fontSize: '0.78125rem', color: 'var(--color-text-muted)' }}>
        {/* The card leads on the amount, so the identifier rides here with the
            dates. It is what the client quotes when they get in touch. */}
        <span data-private style={{ color: 'var(--color-text-subtle)' }}>
          {invoiceReference(invoice.id, invoice.number)}
        </span>
        <span style={{ color: isInvoiceOverdue(invoice.dueDate, invoice.status) ? 'var(--color-danger)' : 'var(--color-text-muted)' }}>
          Due {formatDate(invoice.dueDate)}
        </span>
        <span style={{ color: 'var(--color-text-subtle)' }}>Issued {formatDate(invoice.createdAt)}</span>
      </div>

      {isPayable(invoice) && invoice.payUrl && (
        <a
          href={invoice.payUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          className="tahi-focus-ring min-h-11"
          style={{ ...PAY_LINK_STYLE, alignSelf: 'flex-start' }}
        >
          Pay now
        </a>
      )}
    </div>
  )
}

// ─── Create Invoice Slide-over ────────────────────────────────────────────────

/**
 * A row from GET /api/admin/clients, narrowed to what the create form reads.
 * The three billing columns are nullable in the schema and free text in the
 * currency's case, so they stay `string | null` here and are normalised by the
 * lib/invoice-defaults helpers rather than trusted.
 */
interface ClientOption {
  id: string
  name: string
  /** organisations.invoiceChannel. null = fall back to the studio default. */
  invoiceChannel?: string | null
  /** organisations.paymentTerms. null = no net terms, so due today. */
  paymentTerms?: string | null
  /** organisations.preferredCurrency. */
  preferredCurrency?: string | null
}

function CreateInvoiceSlideOver({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (invoiceId?: string) => void
}) {
  const { showToast } = useToast()
  const [orgId, setOrgId] = useState('')
  const [orgSearch, setOrgSearch] = useState('')
  const [showOrgDropdown, setShowOrgDropdown] = useState(false)
  const [selectedOrgName, setSelectedOrgName] = useState('')
  const [destination, setDestination] = useState<'manual' | 'xero' | 'stripe'>('manual')
  const [lineItems, setLineItems] = useState([{ description: '', quantity: '1', unitAmount: '' }])

  // Fetch the client list when the slide-over is open; SWR caches it globally
  // so re-opening is instant and no spinner flash occurs. The list route does a
  // bare select over organisations, so the billing columns this form defaults
  // from are already on the wire: no second per-client request.
  const { data: clientsData } = useSWR<{ organisations?: ClientOption[] }>(
    open ? '/api/admin/clients' : null
  )
  const orgOptions = useMemo(() => clientsData?.organisations ?? [], [clientsData])

  // The studio-wide rail, read once when the slide-over opens. A client with no
  // channel of its own bills on this one, so it is half of the resolution.
  const { data: settingsData, isLoading: settingsLoading, error: settingsError } = useSWR<{
    settings?: Record<string, string | null>
  }>(open ? '/api/admin/settings' : null, { revalidateOnFocus: false })
  const studioDefaultChannel = settingsData?.settings?.[INVOICE_CHANNEL_SETTING_KEY]

  // Check if the selected org has at least one contact with an email.
  // Stripe rejects customer creation without one. keepPreviousData:false so
  // switching org never shows stale contact data from the previous org.
  const { data: contactsData, isLoading: contactsLoading } = useSWR<{ contacts?: Array<{ email?: string | null }> }>(
    orgId.trim() ? `/api/admin/clients/${orgId}/contacts` : null,
    { keepPreviousData: false }
  )
  // null = unknown (loading or no org selected); true/false = determined
  const orgHasEmailContact: boolean | null = (contactsLoading || !orgId.trim())
    ? null
    : contactsData?.contacts?.some(c => !!c.email) ?? false

  const [currency, setCurrency] = useState<string>(DEFAULT_INVOICE_CURRENCY)
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // ── Defaults from the client ───────────────────────────────────────────────
  // Picking a client used to change nothing: the form stayed on Dashboard only,
  // NZD and an empty due date whoever it was for. These three memos read the
  // client row instead, and the effect below lands them on the form ONCE per
  // pick, so the operator keeps every field afterwards.

  const selectedOrg = useMemo(
    () => orgOptions.find(o => o.id === orgId) ?? null,
    [orgOptions, orgId],
  )

  /**
   * Which rail this client is on, and whether that is a fact or a guess.
   *
   * The client's own column is kept apart from the resolved rail because the
   * two support different sentences: a client that names a channel has a
   * billing history the operator can contradict, a client that inherits the
   * studio default has none, and a studio default that could not be read is
   * not an answer at all. See lib/invoice-defaults.ts.
   */
  const {
    clientChannel,
    effectiveChannel,
    pending: studioDefaultPending,
    known: channelKnown,
  } = useMemo(
    () => resolveChannelDefaults(selectedOrg?.invoiceChannel, studioDefaultChannel, {
      loading: settingsLoading,
      failed: !!settingsError,
    }),
    [selectedOrg, studioDefaultChannel, settingsLoading, settingsError],
  )

  /**
   * What the note under the destination picker reports, for this client.
   *
   * Null while the studio default is still in flight, so the note cannot state
   * one rail and then flip to the other on a cold SWR cache. `channelLabel` is
   * null when the settings read failed outright and this client has no rail of
   * its own: the note then says nothing about the rail rather than presenting
   * the fallback as an answer nobody gave.
   */
  const clientDefaults = useMemo(() => {
    if (!selectedOrg) return null
    if (studioDefaultPending) return null
    return {
      channelLabel: channelKnown ? invoiceChannelLabel(effectiveChannel) : null,
      termsLabel: paymentTermsLabel(selectedOrg.paymentTerms),
      currency: defaultCurrency(selectedOrg.preferredCurrency, DEFAULT_INVOICE_CURRENCY, SUPPORTED_CURRENCIES),
    }
  }, [selectedOrg, effectiveChannel, channelKnown, studioDefaultPending])

  // Guards the apply-once rule. Holding the org id (not a boolean) means
  // switching client re-applies, while typing in the form never does.
  const defaultsAppliedFor = useRef<string | null>(null)

  useEffect(() => {
    if (!open) return
    if (!orgId) { defaultsAppliedFor.current = null; return }
    if (!selectedOrg) return
    // Wait for the studio default, or an unset client would flash onto Stripe
    // and then be left there once the real answer arrived.
    if (studioDefaultPending) return
    if (defaultsAppliedFor.current === orgId) return
    defaultsAppliedFor.current = orgId
    // Currency and terms are read straight off the client row, so they land
    // either way. The rail only lands when it is known: if the settings read
    // failed, the form stays on "Dashboard only", which pushes nowhere and so
    // asserts nothing about a studio default nobody could read.
    if (channelKnown) setDestination(defaultDestination(effectiveChannel))
    setCurrency(defaultCurrency(selectedOrg.preferredCurrency, DEFAULT_INVOICE_CURRENCY, SUPPORTED_CURRENCIES))
    setDueDate(defaultDueDate(selectedOrg.paymentTerms, localCalendarDay(new Date())))
  }, [open, orgId, selectedOrg, studioDefaultPending, channelKnown, effectiveChannel])

  /** True when the operator has moved to the rail this client does NOT bill on. */
  const destinationOverridesClient =
    !!selectedOrg && channelKnown && destination !== 'manual' && destination !== effectiveChannel

  // Reset form when the slide-over closes
  useEffect(() => {
    if (open) return
    setOrgId('')
    setOrgSearch('')
    setSelectedOrgName('')
    setDestination('manual')
    setLineItems([{ description: '', quantity: '1', unitAmount: '' }])
    setCurrency(DEFAULT_INVOICE_CURRENCY)
    setDueDate('')
    setNotes('')
    setSaving(false)
    setError('')
    defaultsAppliedFor.current = null
  }, [open])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    const validItems = lineItems.filter(li => li.description.trim() && li.unitAmount)
    if (!orgId.trim() || validItems.length === 0) {
      setError('Client and at least one line item (description + amount) are required.')
      return
    }
    // Stripe needs a customer email. Block before we create the local
    // invoice so we don't end up with a draft + manual source ghost row.
    if (destination === 'stripe' && orgHasEmailContact === false) {
      setError(`${selectedOrgName || 'This client'} has no contact with an email. Add one on the client's Contacts tab before creating a Stripe link.`)
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await fetch(apiPath('/api/admin/invoices'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: orgId.trim(),
          currency,
          source: destination,
          lineItems: validItems.map(li => ({
            description: li.description.trim(),
            quantity: parseFloat(li.quantity) || 1,
            unitAmount: parseFloat(li.unitAmount),
          })),
          dueDate: dueDate || undefined,
          notes: notes || undefined,
        }),
      })
      if (!res.ok) {
        const json = await res.json() as { error?: string }
        setError(json.error ?? 'Failed to create invoice.')
        return
      }
      const json = await res.json() as { id?: string }

      // Push to destination after local creation
      if (destination === 'xero' && json.id) {
        try {
          await fetch(apiPath('/api/admin/invoices/xero-sync'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ invoiceIds: [json.id] }),
          })
          showToast('Invoice created as Xero draft')
        } catch {
          showToast('Invoice created (Xero sync failed)')
        }
      } else if (destination === 'stripe' && json.id) {
        try {
          const stripeRes = await fetch(apiPath('/api/admin/invoices/stripe-create'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ invoiceId: json.id }),
          })
          if (stripeRes.ok) {
            const stripeData = await stripeRes.json() as { payUrl?: string }
            if (stripeData.payUrl) {
              await navigator.clipboard.writeText(stripeData.payUrl)
              showToast('Stripe invoice created, payment link copied to clipboard')
            } else {
              showToast('Stripe invoice created')
            }
          } else {
            // Surface the actual Stripe error inline so the user can fix it
            // (e.g. "Missing email" -> add a contact). The local invoice is
            // already saved as draft + source=stripe so it can be retried.
            const stripeJson = await stripeRes.json().catch(() => ({})) as { error?: string; message?: string }
            const detail = stripeJson.message || stripeJson.error || `HTTP ${stripeRes.status}`
            setError(`Invoice saved as draft, but Stripe link failed: ${detail}`)
            return
          }
        } catch (err) {
          const detail = err instanceof Error ? err.message : 'unknown error'
          setError(`Invoice saved as draft, but Stripe call failed: ${detail}`)
          return
        }
      } else {
        showToast('Invoice created successfully')
      }
      onCreated(json.id)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }, [orgId, lineItems, currency, dueDate, notes, destination, orgHasEmailContact, selectedOrgName, onCreated, showToast])

  const filteredOrgOptions = orgOptions.filter(o => !orgSearch || o.name.toLowerCase().includes(orgSearch.toLowerCase()))

  const destOptions: SegmentedControlOption<'manual' | 'xero' | 'stripe'>[] = [
    { value: 'manual', label: 'Dashboard only' },
    { value: 'xero',   label: 'Xero draft'     },
    { value: 'stripe', label: 'Stripe link'    },
  ]

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      icon={<FileText size={15} />}
      title="Create invoice"
      subtitle="Generate a new invoice in the dashboard, Xero or Stripe."
      maxWidth="48rem"
    >
      <SlideOver.Body>
        {error && (
          <div
            aria-live="polite"
            style={{
              background: 'var(--color-danger-bg)',
              border: '1px solid var(--color-danger)',
              borderRadius: '0.5rem',
              padding: '0.625rem 0.875rem',
              marginBottom: '1rem',
              color: 'var(--color-danger)',
              fontSize: '0.8125rem',
            }}
          >
            {error}
          </div>
        )}
        {/* Pre-flight warning: Stripe rejects customer creation without an email.
            On the --badge-warning-* trio, not --color-warning-bg /
            --color-warning: globals.css deliberately leaves that pair
            unresolved for dark, and this warning can now render directly above
            the destination override one, so the two would have been a proper
            amber chip and a near-white tint side by side. */}
        {destination === 'stripe' && orgId && orgHasEmailContact === false && (
          <div
            aria-live="polite"
            style={{
              background: 'var(--badge-warning-bg)',
              border: '1px solid var(--badge-warning-border)',
              borderRadius: '0.5rem',
              padding: '0.625rem 0.875rem',
              marginBottom: '1rem',
              color: 'var(--badge-warning-text)',
              fontSize: '0.8125rem',
            }}
          >
            <strong data-private>{selectedOrgName}</strong> has no contact with an email. Stripe needs one to invoice them. Add a contact on the client&apos;s Contacts tab first.
          </div>
        )}
        <form id="create-invoice-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Destination toggle */}
          <div>
            {/* A span, not a label: the control below owns its own accessible
                name through ariaLabel, and a bare <label> pointing at nothing
                is not one. */}
            <Label as="span">Destination</Label>
            {/* The shared segmented control rather than three chips. Badge
                paints its selected state as an INLINE box-shadow, which
                outranks .tahi-focus-ring:focus-visible, so the selected chip
                (the one the operator most often tabs onto) showed no focus
                indicator at all. .tahi-seg-b deliberately paints no box-shadow
                so the ring resolves on every option, and every .tahi-seg-b is
                a 2.75rem target below md, which also retires the min-h-11
                override the chips needed. This picker decides where real money
                goes: it cannot be the control without a focus state.

                size="sm" keeps the 0.75rem label the chips had, so three
                nowrap labels still sit on one line inside the 375px
                slide-over; the touch target below md is the same 2.75rem at
                either size. */}
            <SegmentedControl<'manual' | 'xero' | 'stripe'>
              role="radiogroup"
              ariaLabel="Destination"
              value={destination}
              onChange={setDestination}
              options={destOptions}
              size="sm"
            />
            {/* Where the defaults came from, and a nudge when the operator
                leaves the client's own rail. Dashboard only never warns: it
                pushes nowhere, so it contradicts nothing.

                The live region is mounted unconditionally. A region has to be
                in the accessibility tree BEFORE its content changes to be
                announced, so inserting the wrapper together with its first
                sentence (what picking a client used to do) announced nothing
                at all. */}
            <div aria-live="polite" style={{ marginTop: clientDefaults ? '0.5rem' : undefined }}>
              {clientDefaults && (destinationOverridesClient ? (
                // --badge-warning-* rather than --color-warning-bg /
                // --color-warning: globals.css only re-resolves the badge
                // pair for dark, so the colour pair would have worn a
                // near-white tint on the dark slide-over.
                <p
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.375rem',
                    margin: 0,
                    padding: '0.375rem 0.5rem',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--badge-warning-bg)',
                    color: 'var(--badge-warning-text)',
                    fontSize: '0.75rem',
                    lineHeight: 1.4,
                  }}
                >
                  <AlertTriangle size={13} aria-hidden="true" style={{ flexShrink: 0, marginTop: '0.0625rem' }} />
                  {/* Two sentences, because the resolver answers two
                      different questions. A client that names a rail has a
                      billing history to contradict; a client with a NULL
                      column (almost every row today) has none, and telling
                      the operator it "usually bills through Stripe" would
                      invent one. */}
                  {clientChannel ? (
                    <span>
                      <strong data-private style={{ fontWeight: 600 }}>{selectedOrgName}</strong>
                      {' '}usually bills through {invoiceChannelLabel(clientChannel)}.
                    </span>
                  ) : (
                    <span>
                      No channel set for <strong data-private style={{ fontWeight: 600 }}>{selectedOrgName}</strong>.
                      {' '}The studio default is {invoiceChannelLabel(effectiveChannel)}.
                    </span>
                  )}
                </p>
              ) : (
                <p style={{ margin: 0, fontSize: '0.75rem', lineHeight: 1.4, color: 'var(--color-text-muted)' }}>
                  Defaults from <span data-private>{selectedOrgName}</span>:{' '}
                  {clientDefaults.channelLabel ? `${clientDefaults.channelLabel}, ` : ''}
                  {clientDefaults.termsLabel}, {clientDefaults.currency}.
                </p>
              ))}
            </div>
          </div>

          {/* Client search */}
          <div style={{ position: 'relative' }}>
            <Label htmlFor="ci-org-search">Client</Label>
            {selectedOrgName ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.5rem 0.75rem',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '0.875rem',
                  border: '1px solid var(--color-brand)',
                  background: 'var(--color-brand-50)',
                  color: 'var(--color-brand-dark)',
                }}
              >
                <span data-private style={{ fontWeight: 500 }}>{selectedOrgName}</span>
                <button
                  type="button"
                  onClick={() => { setOrgId(''); setSelectedOrgName(''); setOrgSearch('') }}
                  aria-label="Clear client"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-brand-dark)', display: 'inline-flex' }}
                >
                  <XIcon size={14} aria-hidden="true" />
                </button>
              </div>
            ) : (
              <>
                <Input
                  id="ci-org-search"
                  type="text"
                  placeholder="Search clients..."
                  value={orgSearch}
                  onChange={e => { setOrgSearch(e.target.value); setShowOrgDropdown(true) }}
                  onFocus={() => setShowOrgDropdown(true)}
                  inputSize="md"
                />
                {showOrgDropdown && (
                  <div
                    style={{
                      position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                      background: 'var(--color-bg)', border: '1px solid var(--color-border)',
                      borderRadius: '0.5rem', maxHeight: '12rem', overflowY: 'auto',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)', marginTop: '0.25rem',
                    }}
                  >
                    {filteredOrgOptions.map(o => (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => { setOrgId(o.id); setSelectedOrgName(o.name); setShowOrgDropdown(false); setOrgSearch('') }}
                        style={{
                          padding: '0.5rem 0.75rem',
                          fontSize: '0.8125rem',
                          color: 'var(--color-text)',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                        data-private
                      >
                        {o.name}
                      </button>
                    ))}
                    {filteredOrgOptions.length === 0 && (
                      <p style={{ padding: '0.5rem 0.75rem', fontSize: '0.8125rem', color: 'var(--color-text-subtle)' }}>
                        No clients found
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Line items */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Label as="span" style={{ margin: 0 }}>Line items</Label>
              <Select
                value={currency}
                onChange={e => setCurrency(e.target.value)}
                selectSize="sm"
                options={SUPPORTED_CURRENCIES.map(cur => ({ value: cur, label: cur }))}
              />
            </div>
            {lineItems.map((item, i) => (
              <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <div style={{ flex: 3 }}>
                  <Input
                    type="text"
                    placeholder="Description"
                    value={item.description}
                    onChange={e => {
                      const updated = [...lineItems]
                      updated[i] = { ...updated[i], description: e.target.value }
                      setLineItems(updated)
                    }}
                    inputSize="md"
                    style={{ width: '100%' }}
                  />
                </div>
                <div style={{ flex: '0 0 4.5rem' }}>
                  <Input
                    type="number"
                    placeholder="Qty"
                    min="0"
                    step="0.01"
                    value={item.quantity}
                    onChange={e => {
                      const updated = [...lineItems]
                      updated[i] = { ...updated[i], quantity: e.target.value }
                      setLineItems(updated)
                    }}
                    inputSize="md"
                    style={{ width: '100%' }}
                  />
                </div>
                <div style={{ flex: '0 0 7rem' }}>
                  <Input
                    type="number"
                    placeholder="Amount"
                    min="0"
                    step="0.01"
                    value={item.unitAmount}
                    onChange={e => {
                      const updated = [...lineItems]
                      updated[i] = { ...updated[i], unitAmount: e.target.value }
                      setLineItems(updated)
                    }}
                    inputSize="md"
                    style={{ width: '100%' }}
                  />
                </div>
                {lineItems.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setLineItems(lineItems.filter((_, j) => j !== i))}
                    aria-label="Remove line item"
                    style={{
                      padding: '0.375rem',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--color-text-subtle)',
                      display: 'inline-flex',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-danger)' }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-subtle)' }}
                  >
                    <XIcon size={14} aria-hidden="true" />
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setLineItems([...lineItems, { description: '', quantity: '1', unitAmount: '' }])}
              style={{
                fontSize: '0.75rem',
                color: 'var(--color-brand)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                textAlign: 'left',
                fontWeight: 500,
              }}
            >
              + Add line item
            </button>
          </div>

          {/* Two-col: due date + notes */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.75rem' }}>
            <div>
              <Label htmlFor="ci-due-date">Due date</Label>
              <Input
                id="ci-due-date"
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                inputSize="md"
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <Label htmlFor="ci-notes">Notes</Label>
              <Textarea
                id="ci-notes"
                rows={3}
                placeholder="Optional notes for the client..."
                value={notes}
                onChange={e => setNotes(e.target.value)}
              />
            </div>
          </div>
        </form>
      </SlideOver.Body>
      <SlideOver.Footer>
        <TahiButton variant="secondary" size="sm" onClick={onClose}>
          Cancel
        </TahiButton>
        <div style={{ flex: 1 }} />
        <TahiButton
          type="submit"
          form="create-invoice-form"
          size="sm"
          disabled={saving}
          iconLeft={saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
        >
          {saving
            ? 'Creating...'
            : destination === 'xero' ? 'Create Xero draft'
            : destination === 'stripe' ? 'Create + get payment link'
            : 'Create invoice'}
        </TahiButton>
      </SlideOver.Footer>
    </SlideOver>
  )
}

// Small label primitive matching the docs slide-over form spacing.
function Label({
  children,
  htmlFor,
  as: Tag = 'label',
  style,
}: {
  children: React.ReactNode
  htmlFor?: string
  as?: 'label' | 'span'
  style?: React.CSSProperties
}) {
  return (
    <Tag
      htmlFor={htmlFor}
      style={{
        display: 'block',
        fontSize: '0.625rem',
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--color-text-subtle)',
        marginBottom: '0.3125rem',
        ...style,
      }}
    >
      {children}
    </Tag>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface InvoiceListProps {
  isAdmin: boolean
}

export function InvoiceList({ isAdmin: isAdminProp }: InvoiceListProps) {
  const { isImpersonatingClient } = useImpersonation()
  const { showToast } = useToast()
  const { displayCurrency, formatNativeWithDisplay } = useDisplayCurrency()
  // Only switch to client view when impersonating a client, not a team member
  const isAdmin = isAdminProp && !isImpersonatingClient
  const router = useRouter()

  const [showCreate, setShowCreate] = useState(false)
  const [importing, setImporting] = useState(false)

  // Persisted active tab. Kept as a multiselect chip filter; the
  // useUserPreference key still encodes a single value so existing
  // prefs continue to work.
  const [activeTab, setActiveTab] = useUserPreference(
    'invoices.activeTab',
    'all',
    { validator: oneOf(['all', 'draft', 'sent', 'overdue', 'paid', 'written_off']) },
  )
  const [sourceFilter, setSourceFilter] = useState<string>('all')
  const [dateRange, setDateRange] = useState<DateRange>({ from: null, to: null })
  const [search, setSearch] = useState('')

  // Active FilterBar entries — single multi-value chip per dimension.
  // Empty values array on a multiselect chip means "no filter" so the
  // chip stays visible without filtering anything down.
  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([
    { id: 'status', values: activeTab && activeTab !== 'all' ? [activeTab] : [] },
    { id: 'source', values: sourceFilter && sourceFilter !== 'all' ? [sourceFilter] : [] },
  ])

  // Push FilterBar changes back into the underlying state used by
  // the filter + persistence (useUserPreference).
  const onFiltersChange = useCallback((next: ActiveFilter[]) => {
    setActiveFilters(next)
    const status = next.find(f => f.id === 'status')?.values ?? []
    const source = next.find(f => f.id === 'source')?.values ?? []
    setActiveTab(status[0] ?? 'all')
    setSourceFilter(source[0] ?? 'all')
  }, [setActiveTab])

  // Fetch all invoices once and filter client-side for accurate overdue detection.
  // The server returns at most 50 rows per default; pagination is a follow-up task.
  const invoiceKey = isAdmin ? '/api/admin/invoices?status=all' : '/api/portal/invoices'
  const { data: invoiceData, isLoading: loading, error: fetchError, mutate } = useSWR<{ items?: Invoice[] }>(invoiceKey)
  const invoices = invoiceData?.items ?? []

  // Money is scoped to workspace admins of the client org, so /api/portal/invoices
  // 403s a plain member seat by design (lib/portal-access.ts). That is a rule,
  // not a failure, and it used to render as "Failed to load invoices." with a
  // Retry that could never work. Split it out: a 403 on the CLIENT endpoint gets
  // an honest explanation, every other error keeps the retryable failure state.
  // The admin endpoint is never read this way, so the admin page is unchanged.
  //
  // A 403 there has more than one meaning, though: the feature can be switched
  // off for the whole org, and the login may not be linked to an org at all. So
  // classify the body rather than assuming the seat. Unknown bodies keep the
  // member-seat reading, which is what a bare Forbidden means on those routes.
  const denial = !isAdmin && fetchError instanceof ApiError && fetchError.status === 403
    ? portalMoneyDenial(fetchError.info)
    : null
  const restricted = denial !== null
  const error = !!fetchError && !restricted

  // Who to ask. Fetched ONLY for the seat that is being turned away, and only
  // for the denial whose copy actually names somebody, so no other session pays
  // for it; any signed-in contact may read their own org's roster. Falls back to
  // a generic phrase if the read fails or names nobody.
  const { data: peopleData } = useSWR<{ items?: PortalPersonSummary[] }>(
    denial === 'member_seat' ? '/api/portal/people' : null,
  )
  const denialCopy = denial
    ? portalInvoiceDenialCopy(denial, portalAdminLabel(peopleData?.items))
    : null

  // Client-side filtering: status chip + source chip + date range + search
  const filteredInvoices = useMemo(() => {
    const statusSet = new Set(activeFilters.find(f => f.id === 'status')?.values ?? [])
    const sourceSet = new Set(activeFilters.find(f => f.id === 'source')?.values ?? [])
    const q = search.trim().toLowerCase()
    return invoices.filter(inv => {
      // Compute effective status (overdue = sent + past due date)
      const eff = effectiveInvoiceStatus(inv)

      // Status chip: empty = all
      if (statusSet.size > 0 && !statusSet.has(eff)) return false

      // Source chip: empty = all. Map null -> 'manual' to match the
      // option value.
      if (sourceSet.size > 0) {
        const invSource = inv.source ?? 'manual'
        if (!sourceSet.has(invSource)) return false
      }

      // Date range filter
      if (dateRange.from && dateRange.to) {
        const d = new Date(inv.dueDate ?? inv.createdAt).getTime()
        if (d < dateRange.from.getTime() || d > dateRange.to.getTime()) return false
      }

      // Search across client name + invoice id (handy when a Stripe/Xero
      // hosted URL paste lands the user back here).
      if (q) {
        const name = (inv.orgName ?? '').toLowerCase()
        const id = inv.id.toLowerCase()
        // The number is what an operator actually types, and what a client
        // quotes back over email, so it searches before the raw id does.
        const reference = invoiceReference(inv.id, inv.number).toLowerCase()
        if (!name.includes(q) && !id.includes(q) && !reference.includes(q)) return false
      }

      return true
    })
  }, [invoices, activeFilters, dateRange, search])

  const handleCreated = useCallback((invoiceId?: string) => {
    setShowCreate(false)
    if (invoiceId) {
      router.push(`/invoices/${invoiceId}`)
    } else {
      void mutate()
    }
  }, [mutate, router])

  // FilterBar definitions. Both chips are nonRemovable so they remain
  // visible without the "+ Add filter" button. Tones map to the same
  // Badge tones used in the row cells so the filter UI matches.
  const filterDefs: FilterDef[] = useMemo(() => ([
    {
      id: 'status',
      label: 'Status',
      kind: 'multiselect',
      nonRemovable: true,
      options: [
        { value: 'draft',       label: 'Draft',       tone: 'neutral'  },
        { value: 'sent',        label: 'Sent',        tone: 'warning'  },
        { value: 'viewed',      label: 'Viewed',      tone: 'info'     },
        { value: 'overdue',     label: 'Overdue',     tone: 'danger'   },
        { value: 'paid',        label: 'Paid',        tone: 'positive' },
        { value: 'written_off', label: 'Written Off', tone: 'neutral'  },
      ],
    },
    ...(isAdmin ? [{
      id: 'source',
      label: 'Source',
      kind: 'multiselect' as const,
      nonRemovable: true,
      options: [
        { value: 'manual', label: 'Manual', tone: 'neutral' as BadgeTone },
        { value: 'xero',   label: 'Xero',   tone: 'teal' as BadgeTone    },
        { value: 'stripe', label: 'Stripe', tone: 'purple' as BadgeTone  },
      ],
    }] : []),
  ]), [isAdmin])

  // Column defs for the DataTable. Sortable headers do their own
  // sorting through DataTable's internal state.
  const columns: DataTableColumn<Invoice>[] = useMemo(() => {
    const cols: DataTableColumn<Invoice>[] = []

    // The identifier, first, for both audiences. Until now the list showed the
    // amount as the only thing you could read a row by, so two bills for the
    // same client at the same price were indistinguishable and neither matched
    // anything the client had been sent.
    cols.push({
      key: 'number',
      header: 'Invoice',
      sortable: true,
      sortValue: r => invoiceReference(r.id, r.number),
      width: '10rem',
      render: r => (
        <span
          data-private
          style={{
            fontFamily: 'var(--font-mono, ui-monospace, monospace)',
            fontSize: '0.78125rem',
            color: 'var(--color-text)',
            whiteSpace: 'nowrap',
          }}
        >
          {invoiceReference(r.id, r.number)}
        </span>
      ),
    })

    if (isAdmin) {
      cols.push({
        key: 'client',
        header: 'Client',
        sortable: true,
        sortValue: r => (r.orgName ?? '').toLowerCase(),
        minWidth: '14rem',
        link: {
          href: r => r.orgId ? `/clients/${r.orgId}` : null,
        },
        render: r => (
          <span data-private style={{
            fontWeight: 500,
            color: 'var(--color-text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {r.orgName ?? 'Unknown'}
          </span>
        ),
      })
    }

    cols.push({
      key: 'amount',
      header: 'Amount',
      sortable: true,
      sortValue: r => r.totalAmount,
      align: 'right',
      width: '10rem',
      render: r => (
        <div style={{ textAlign: 'right' }}>
          <div data-private style={{ fontWeight: 600, color: 'var(--color-text)' }}>
            {formatInvoiceCurrency(r.totalAmount, r.currency)}
          </div>
          {r.currency && r.currency !== displayCurrency && (
            <div data-private style={{ fontSize: '0.7rem', fontWeight: 400, color: 'var(--color-text-subtle)', marginTop: '0.125rem' }}>
              {formatNativeWithDisplay(r.totalAmount, r.currency).split('≈ ')[1] ?? ''}
            </div>
          )}
        </div>
      ),
    })

    cols.push({
      key: 'status',
      header: 'Status',
      sortable: true,
      sortValue: r => effectiveInvoiceStatus(r),
      width: '8rem',
      render: r => <InvoiceStatusBadge status={r.status} dueDate={r.dueDate} />,
    })

    if (isAdmin) {
      cols.push({
        key: 'source',
        header: 'Source',
        sortable: true,
        sortValue: r => r.source ?? 'manual',
        width: '7rem',
        render: r => <SourceBadge source={r.source} />,
      })
    }

    cols.push({
      key: 'dueDate',
      header: 'Due',
      sortable: true,
      sortValue: r => r.dueDate ?? '',
      width: '8rem',
      render: r => (
        <span style={{
          fontSize: '0.8125rem',
          color: isInvoiceOverdue(r.dueDate, r.status) ? 'var(--color-danger)' : 'var(--color-text-muted)',
        }}>
          {formatDate(r.dueDate)}
        </span>
      ),
    })

    cols.push({
      key: 'createdAt',
      header: 'Created',
      sortable: true,
      sortValue: r => r.createdAt,
      width: '8rem',
      muted: true,
      render: r => (
        <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
          {formatDate(r.createdAt)}
        </span>
      ),
    })

    // Client-only pay affordance. A row still opens the invoice; this is the
    // one-click path to Stripe's hosted page for a bill that is actually owed.
    // Rendered by hand rather than through the `link` column config, because
    // that renders an empty focusable button on every row without an href.
    if (!isAdmin) {
      cols.push({
        key: 'pay',
        header: '',
        align: 'right',
        width: '7rem',
        render: r => (isPayable(r) && r.payUrl ? (
          <a
            href={r.payUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="tahi-focus-ring min-h-11 md:min-h-9"
            style={PAY_LINK_STYLE}
          >
            Pay now
          </a>
        ) : null),
      })
    }

    return cols
  }, [isAdmin, displayCurrency, formatNativeWithDisplay])

  // Cards below md for the client audience only: theirs is the column set that
  // pushed Pay now off a 375px screen. The admin table keeps its h-scroll.
  const renderMobileCard = useCallback((r: Invoice) => (
    <InvoiceMobileCard
      invoice={r}
      amountLabel={formatInvoiceCurrency(r.totalAmount, r.currency)}
      onOpen={() => router.push(`/invoices/${r.id}`)}
    />
  ), [router])

  // ── Client denied their org's money surface ────────────────────────────────
  // Whatever the reason, these invoices are not theirs to see right now, so say
  // which reason plainly instead of shipping them a filter bar over a table they
  // will never fill and a Retry that cannot succeed. Every hook above has
  // already run, so this early return is order-safe. Deep links and bookmarks
  // land here; the nav no longer does.
  if (denialCopy) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <PageHeader title="Invoices" subtitle="Billing for your organisation." />
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader
        title="Invoices"
        subtitle={isAdmin ? 'All invoices across every client.' : 'Your invoice history and outstanding payments.'}
      >
        {isAdmin && (
          <>
            <TahiButton
              variant="secondary"
              size="sm"
              onClick={() => {
                const link = document.createElement('a')
                link.href = apiPath('/api/admin/export/invoices')
                link.download = 'invoices.csv'
                link.click()
              }}
              iconLeft={<Download className="w-3.5 h-3.5" />}
            >
              Export CSV
            </TahiButton>
            <TahiButton
              variant="secondary"
              size="sm"
              disabled={importing}
              onClick={async () => {
                if (importing) return
                setImporting(true)
                try {
                  const res = await fetch(apiPath('/api/admin/integrations/stripe/import-invoices'), { method: 'POST' })
                  const json = await res.json() as { imported?: number; updated?: number; skipped?: number; error?: string; message?: string }
                  if (res.ok) {
                    showToast(`Stripe: ${json.imported ?? 0} imported, ${json.updated ?? 0} updated, ${json.skipped ?? 0} skipped`)
                    handleCreated()
                  } else {
                    showToast(json.message ?? json.error ?? 'Import failed')
                  }
                } catch {
                  showToast('Import failed, check connection')
                } finally {
                  setImporting(false)
                }
              }}
              iconLeft={<RefreshCw className={`w-3.5 h-3.5 ${importing ? 'animate-spin' : ''}`} />}
              title="Pull new invoices from Stripe into the dashboard"
            >
              {importing ? 'Importing...' : 'Import from Stripe'}
            </TahiButton>
            <TahiButton
              size="sm"
              onClick={() => setShowCreate(true)}
              iconLeft={<Plus className="w-3.5 h-3.5" />}
            >
              Create invoice
            </TahiButton>
          </>
        )}
      </PageHeader>

      {/* Filter row — search + Status + Source multiselect chips.
          Date range stays as a tight inline control on the right so
          users can scope by due date without leaving the page. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '14rem' }}>
          <FilterBar
            filters={filterDefs}
            active={activeFilters}
            onChange={onFiltersChange}
            search={{
              value: search,
              onChange: setSearch,
              placeholder: isAdmin ? 'Search client or invoice ID' : 'Search invoices',
            }}
            size="sm"
          />
        </div>
        {/* Date range — kept inline because FilterBar doesn't support a
            date kind yet. Same visual height as the chip row. */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', fontWeight: 500 }}>Due:</span>
          <input
            type="date"
            value={dateRange.from ? dateRange.from.toISOString().split('T')[0] : ''}
            onChange={e => setDateRange(prev => ({ ...prev, from: e.target.value ? new Date(e.target.value) : null }))}
            style={{
              padding: '0.25rem 0.5rem',
              fontSize: '0.75rem',
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg)',
              color: 'var(--color-text)',
              borderRadius: 'var(--radius-md)',
              height: '1.875rem',
            }}
          />
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>to</span>
          <input
            type="date"
            value={dateRange.to ? dateRange.to.toISOString().split('T')[0] : ''}
            onChange={e => setDateRange(prev => ({ ...prev, to: e.target.value ? new Date(e.target.value) : null }))}
            style={{
              padding: '0.25rem 0.5rem',
              fontSize: '0.75rem',
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg)',
              color: 'var(--color-text)',
              borderRadius: 'var(--radius-md)',
              height: '1.875rem',
            }}
          />
          {(dateRange.from || dateRange.to) && (
            <button
              onClick={() => setDateRange({ from: null, to: null })}
              style={{
                fontSize: '0.75rem',
                color: 'var(--color-text-subtle)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <Card padding="none">
        {error && !loading ? (
          <div
            style={{
              padding: '3rem 1.5rem',
              textAlign: 'center',
              color: 'var(--color-text-muted)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '0.75rem',
            }}
          >
            <p style={{ fontSize: '0.875rem' }}>Failed to load invoices.</p>
            <TahiButton
              size="sm"
              variant="secondary"
              iconLeft={<RefreshCw className="w-3.5 h-3.5" />}
              onClick={() => void mutate()}
            >
              Retry
            </TahiButton>
          </div>
        ) : (
          <DataTable<Invoice>
            ariaLabel="Invoices"
            columns={columns}
            rows={filteredInvoices}
            getRowId={r => r.id}
            defaultSort={{ key: 'createdAt', dir: 'desc' }}
            loading={loading}
            mobileCard={isAdmin ? undefined : renderMobileCard}
            empty={
              <EmptyState
                icon={<FileText className="w-6 h-6" />}
                title={invoices.length === 0
                  ? (isAdmin ? 'No invoices yet' : 'No invoices')
                  : 'No matches'}
                description={invoices.length === 0
                  ? (isAdmin
                      ? 'Create your first invoice to get started.'
                      : 'Invoices from Tahi Studio will appear here.')
                  : 'Try clearing a filter or adjusting your search.'}
                action={
                  invoices.length === 0 && isAdmin ? (
                    <TahiButton size="sm" onClick={() => setShowCreate(true)} iconLeft={<Plus className="w-3.5 h-3.5" />}>
                      Create invoice
                    </TahiButton>
                  ) : undefined
                }
              />
            }
            onRowClick={(r) => router.push(`/invoices/${r.id}`)}
          />
        )}
      </Card>

      {/* Create Invoice Slide-over */}
      <CreateInvoiceSlideOver
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={handleCreated}
      />
    </div>
  )
}
