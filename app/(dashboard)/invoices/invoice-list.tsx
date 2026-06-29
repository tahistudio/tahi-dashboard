'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import {
  Plus, FileText, RefreshCw, Download, X as XIcon,
} from 'lucide-react'
import { type DateRange } from '@/components/tahi/date-range-picker'
import { apiPath } from '@/lib/api'
import { useToast } from '@/components/tahi/toast'
import { useImpersonation } from '@/components/tahi/impersonation-banner'
import { formatCurrency } from '@/lib/currency'
import { useDisplayCurrency } from '@/lib/display-currency-context'
import { PageHeader } from '@/components/tahi/page-header'
import { useUserPreference, oneOf } from '@/lib/use-user-preference'

import { TahiButton } from '@/components/tahi/tahi-button'
import { Badge, type BadgeTone } from '@/components/tahi/badge'
import { Card } from '@/components/tahi/card'
import { EmptyState } from '@/components/tahi/empty-state'
import { SlideOver } from '@/components/tahi/slide-over'
import { Input, Select, Textarea } from '@/components/tahi/input'
import { DataTable, type DataTableColumn } from '@/components/tahi/data-table'
import { FilterBar, type FilterDef, type ActiveFilter } from '@/components/tahi/filter-bar'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Invoice {
  id: string
  orgId: string
  orgName: string | null
  status: string
  source: string | null
  stripeInvoiceId: string | null
  xeroInvoiceId: string | null
  totalAmount: number
  currency: string | null
  dueDate: string | null
  createdAt: string
  updatedAt: string
}

// ─── Config ───────────────────────────────────────────────────────────────────

// Status -> badge tone. paid=positive, overdue=danger, viewed=info,
// sent=warning, draft=neutral, written_off=neutral. Matches the
// spec's mapping from INVOICE_STATUS_CONFIG.
const STATUS_TONE: Record<string, { label: string; tone: BadgeTone }> = {
  draft:        { label: 'Draft',       tone: 'neutral'  },
  sent:         { label: 'Sent',        tone: 'warning'  },
  viewed:       { label: 'Viewed',      tone: 'info'     },
  overdue:      { label: 'Overdue',     tone: 'danger'   },
  paid:         { label: 'Paid',        tone: 'positive' },
  written_off:  { label: 'Written Off', tone: 'neutral'  },
}

// Source -> badge tone. Manual = neutral, Xero = teal (close to its
// brand cyan), Stripe = purple. Brand-correct enough to be obvious
// without hardcoding hex inside the row.
const SOURCE_TONE: Record<string, { label: string; tone: BadgeTone }> = {
  manual: { label: 'Manual', tone: 'neutral' },
  xero:   { label: 'Xero',   tone: 'teal'    },
  stripe: { label: 'Stripe', tone: 'purple'  },
}

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

function isOverdue(dueDate: string | null, status: string): boolean {
  if (!dueDate || status === 'paid' || status === 'written_off') return false
  return new Date(dueDate + 'T23:59:59') < new Date()
}

function effectiveStatus(inv: { status: string; dueDate: string | null }): string {
  return isOverdue(inv.dueDate, inv.status) && inv.status === 'sent' ? 'overdue' : inv.status
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status, dueDate }: { status: string; dueDate: string | null }) {
  const eff = effectiveStatus({ status, dueDate })
  const cfg = STATUS_TONE[eff] ?? STATUS_TONE['draft']
  return <Badge tone={cfg.tone} variant="soft" size="sm">{cfg.label}</Badge>
}

function SourceBadge({ source }: { source: string | null }) {
  const key = source ?? 'manual'
  const cfg = SOURCE_TONE[key] ?? SOURCE_TONE['manual']
  return <Badge tone={cfg.tone} variant="soft" size="sm">{cfg.label}</Badge>
}

// ─── Create Invoice Slide-over ────────────────────────────────────────────────

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
  // so re-opening is instant and no spinner flash occurs.
  const { data: clientsData } = useSWR<{ organisations?: Array<{ id: string; name: string }> }>(
    open ? '/api/admin/clients' : null
  )
  const orgOptions = clientsData?.organisations ?? []

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

  const [currency, setCurrency] = useState('NZD')
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Reset form when the slide-over closes
  useEffect(() => {
    if (open) return
    setOrgId('')
    setOrgSearch('')
    setSelectedOrgName('')
    setDestination('manual')
    setLineItems([{ description: '', quantity: '1', unitAmount: '' }])
    setCurrency('NZD')
    setDueDate('')
    setNotes('')
    setSaving(false)
    setError('')
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

  const destOptions: { value: 'manual' | 'xero' | 'stripe'; label: string; tone: BadgeTone }[] = [
    { value: 'manual', label: 'Dashboard only', tone: 'brand'  },
    { value: 'xero',   label: 'Xero draft',     tone: 'teal'   },
    { value: 'stripe', label: 'Stripe link',    tone: 'purple' },
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
        {/* Pre-flight warning: Stripe rejects customer creation without an email */}
        {destination === 'stripe' && orgId && orgHasEmailContact === false && (
          <div
            aria-live="polite"
            style={{
              background: 'var(--color-warning-bg)',
              border: '1px solid var(--color-warning)',
              borderRadius: '0.5rem',
              padding: '0.625rem 0.875rem',
              marginBottom: '1rem',
              color: 'var(--color-warning)',
              fontSize: '0.8125rem',
            }}
          >
            <strong data-private>{selectedOrgName}</strong> has no contact with an email. Stripe needs one to invoice them. Add a contact on the client&apos;s Contacts tab first.
          </div>
        )}
        <form id="create-invoice-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Destination toggle */}
          <div>
            <Label>Destination</Label>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {destOptions.map(opt => (
                <Badge
                  key={opt.value}
                  tone={opt.tone}
                  variant={destination === opt.value ? 'soft' : 'outline'}
                  selected={destination === opt.value}
                  onClick={() => setDestination(opt.value)}
                  size="md"
                >
                  {opt.label}
                </Badge>
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
  const error = !!fetchError

  // Client-side filtering: status chip + source chip + date range + search
  const filteredInvoices = useMemo(() => {
    const statusSet = new Set(activeFilters.find(f => f.id === 'status')?.values ?? [])
    const sourceSet = new Set(activeFilters.find(f => f.id === 'source')?.values ?? [])
    const q = search.trim().toLowerCase()
    return invoices.filter(inv => {
      // Compute effective status (overdue = sent + past due date)
      const eff = effectiveStatus(inv)

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
        if (!name.includes(q) && !id.includes(q)) return false
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
      sortValue: r => effectiveStatus(r),
      width: '8rem',
      render: r => <StatusBadge status={r.status} dueDate={r.dueDate} />,
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
          color: isOverdue(r.dueDate, r.status) ? 'var(--color-danger)' : 'var(--color-text-muted)',
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

    return cols
  }, [isAdmin, displayCurrency, formatNativeWithDisplay])

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
