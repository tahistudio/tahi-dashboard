'use client'

import { useState } from 'react'
import useSWR from 'swr'
import {
  ShoppingBag, Plus, RefreshCw, Tag, Loader2, Ticket, Trash2, Pencil, Lock,
} from 'lucide-react'
import { apiPath } from '@/lib/api'
import { Badge } from '@/components/tahi/badge'
import { SearchableSelect } from '@/components/tahi/searchable-select'
import { SegmentedControl } from '@/components/tahi/segmented-control'

// ---- Types -------------------------------------------------------------------

interface ServiceItem {
  id: string
  name: string
  description: string | null
  price: number
  currency: string
  isRecurring: number
  recurringInterval: string | null
  showInCatalog: number
  category: string | null
  /** null = a global row every client sees. Set = private to that client. */
  orgId: string | null
  /** 'public' | 'hidden'. Hidden keeps the row out of the portal either way. */
  visibility: string
  createdAt: string
  updatedAt: string
}

interface ClientOption {
  id: string
  name: string
}

/** Everyone, or one named client. The two states of the audience control. */
type Audience = 'everyone' | 'client'

interface CouponItem {
  code: string
  discountPercent: number
  maxUses: number | null
  usedCount: number
  expiresAt: string | null
  createdAt: string
}

// ---- Helpers -----------------------------------------------------------------

function formatPrice(cents: number, currency: string): string {
  const amount = cents / 100
  try {
    return new Intl.NumberFormat('en-NZ', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

const CATEGORY_LABELS: Record<string, string> = {
  service: 'Service',
  topup: 'Top-up',
  addon: 'Add-on',
}

// ---- Admin Services ----------------------------------------------------------

export function AdminServicesContent() {
  const { data: servicesData, isLoading: loading, mutate: mutateServices } = useSWR<{ items: ServiceItem[] }>('/api/admin/services')
  const services = servicesData?.items ?? []
  // The audience picker and the "Private to" badge both read this. Scoped to
  // whatever the caller may see, because that is what /api/admin/clients
  // already answers.
  const { data: clientsData } = useSWR<{ organisations: ClientOption[] }>('/api/admin/clients')
  const clients = clientsData?.organisations ?? []
  const clientName = (id: string | null): string | null =>
    id ? (clients.find(c => c.id === id)?.name ?? 'another client') : null
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<ServiceItem | null>(null)

  return (
    <div className="space-y-6" style={{ maxWidth: '68.75rem' }}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Services</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            Manage your service catalogue. Every client sees a service unless you make it private to one of them, and hidden keeps it out of the portal either way.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void mutateServices()}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors"
            style={{
              color: 'var(--color-text-muted)',
              background: 'var(--color-bg-secondary)',
              borderRadius: 'var(--radius-button)',
              border: '1px solid var(--color-border)',
              cursor: 'pointer',
              minHeight: '2.75rem',
            }}
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            Refresh
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white transition-colors"
            style={{
              background: 'var(--color-brand)',
              borderRadius: 'var(--radius-button)',
              border: 'none',
              cursor: 'pointer',
              minHeight: '2.75rem',
            }}
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            Create Service
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="animate-pulse rounded-xl" style={{ height: '4rem', background: 'var(--color-bg-tertiary)' }} />
          ))}
        </div>
      ) : services.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div
            className="w-16 h-16 brand-gradient flex items-center justify-center mb-4"
            style={{ borderRadius: 'var(--radius-leaf)' }}
          >
            <ShoppingBag className="w-8 h-8 text-white" aria-hidden="true" />
          </div>
          <h3 className="text-base font-semibold text-[var(--color-text)] mb-2">No services yet</h3>
          <p className="text-sm text-[var(--color-text-muted)] max-w-sm">
            Create your first service to build a catalogue for clients.
          </p>
          <button
            onClick={() => setShowForm(true)}
            className="mt-4 flex items-center gap-2 px-4 py-2 text-sm font-medium text-white transition-colors"
            style={{
              background: 'var(--color-brand)',
              borderRadius: 'var(--radius-button)',
              border: 'none',
              cursor: 'pointer',
              minHeight: '2.75rem',
            }}
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            Create Service
          </button>
        </div>
      ) : (
        <div
          className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl overflow-hidden"
        >
          <div className="h-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <th className="text-left text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider" style={{ padding: '0.75rem 1rem' }}>Name</th>
                  <th className="text-left text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider" style={{ padding: '0.75rem 1rem' }}>Price</th>
                  <th className="text-left text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider hidden sm:table-cell" style={{ padding: '0.75rem 1rem' }}>Type</th>
                  <th className="text-left text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider hidden md:table-cell" style={{ padding: '0.75rem 1rem' }}>Category</th>
                  <th className="text-center text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider" style={{ padding: '0.75rem 1rem' }}>Visible</th>
                  <th className="text-right text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider" style={{ padding: '0.75rem 1rem' }}><span className="sr-only">Edit</span></th>
                </tr>
              </thead>
              <tbody>
                {services.map((svc, i) => (
                  <tr
                    key={svc.id}
                    className="transition-colors hover:bg-[var(--color-bg-secondary)]"
                    style={{
                      borderBottom: i < services.length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
                    }}
                  >
                    <td style={{ padding: '0.75rem 1rem' }}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-[var(--color-text)]">{svc.name}</span>
                        {svc.orgId && (
                          <Badge tone="purple" variant="soft" size="sm">
                            Private to {clientName(svc.orgId)}
                          </Badge>
                        )}
                      </div>
                      {svc.description && (
                        <div className="text-xs text-[var(--color-text-muted)] mt-0.5 truncate" style={{ maxWidth: '20rem' }}>
                          {svc.description}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      <span className="font-semibold text-[var(--color-text)]">
                        {formatPrice(svc.price, svc.currency)}
                      </span>
                    </td>
                    <td className="hidden sm:table-cell" style={{ padding: '0.75rem 1rem' }}>
                      {svc.isRecurring ? (
                        <span
                          className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full"
                          style={{
                            background: 'var(--color-brand-50)',
                            color: 'var(--color-brand-dark)',
                          }}
                        >
                          <RefreshCw className="w-3 h-3" aria-hidden="true" />
                          {svc.recurringInterval === 'year' ? 'Yearly' : 'Monthly'}
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--color-text-muted)]">One-time</span>
                      )}
                    </td>
                    <td className="hidden md:table-cell" style={{ padding: '0.75rem 1rem' }}>
                      {svc.category ? (
                        <span
                          className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full"
                          style={{
                            background: 'var(--color-bg-tertiary)',
                            color: 'var(--color-text-muted)',
                          }}
                        >
                          <Tag className="w-3 h-3" aria-hidden="true" />
                          {CATEGORY_LABELS[svc.category] ?? svc.category}
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--color-text-subtle)]">--</span>
                      )}
                    </td>
                    <td className="text-center" style={{ padding: '0.75rem 1rem' }}>
                      {/* Both flags have to agree. The portal requires
                          show_in_catalog AND visibility, so a dot that read
                          only one of them would promise a client can see a row
                          the other flag is holding back. */}
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full"
                        style={{
                          background: isShown(svc)
                            ? 'var(--color-success)'
                            : 'var(--color-border)',
                        }}
                        title={isShown(svc)
                          ? (svc.orgId ? `Shown to ${clientName(svc.orgId)}` : 'Shown to every client')
                          : 'Hidden from the client portal'}
                      />
                    </td>
                    <td className="text-right" style={{ padding: '0.75rem 1rem' }}>
                      <button
                        onClick={() => setEditing(svc)}
                        className="inline-flex items-center justify-center text-[var(--color-text-subtle)] hover:text-[var(--color-brand)] focus-visible:text-[var(--color-brand)] transition-colors tahi-focus-ring"
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          minWidth: '2.75rem',
                          minHeight: '2.75rem',
                          borderRadius: 'var(--radius-button)',
                        }}
                        aria-label={`Edit ${svc.name}`}
                      >
                        <Pencil className="w-4 h-4" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <CouponsSection />

      {(showForm || editing) && (
        <ServiceDialog
          service={editing}
          clients={clients}
          onClose={() => { setShowForm(false); setEditing(null) }}
          onSaved={() => {
            setShowForm(false)
            setEditing(null)
            void mutateServices()
          }}
        />
      )}
    </div>
  )
}

/**
 * Can a client see this row at all. The portal requires show_in_catalog AND
 * visibility = 'public' (migration 0097), so this has to require both too.
 */
function isShown(svc: ServiceItem): boolean {
  return svc.showInCatalog === 1 && svc.visibility !== 'hidden'
}

// ---- Coupons Section ---------------------------------------------------------

function CouponsSection() {
  const { data: couponsData, isLoading: loading, mutate: mutateCoupons } = useSWR<{ items: CouponItem[] }>('/api/admin/services/coupons')
  const coupons = couponsData?.items ?? []
  const [showForm, setShowForm] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const handleDelete = async (code: string) => {
    setDeleting(code)
    try {
      const res = await fetch(apiPath(`/api/admin/services/coupons?code=${encodeURIComponent(code)}`), {
        method: 'DELETE',
      })
      if (res.ok) {
        await mutateCoupons()
      }
    } finally {
      setDeleting(null)
    }
  }

  const isExpired = (expiresAt: string | null): boolean => {
    if (!expiresAt) return false
    return new Date(expiresAt) < new Date()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Ticket className="w-5 h-5 text-[var(--color-text-muted)]" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-[var(--color-text)]">Discount Coupons</h2>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white transition-colors"
          style={{
            background: 'var(--color-brand)',
            borderRadius: 'var(--radius-button)',
            border: 'none',
            cursor: 'pointer',
            minHeight: '2.75rem',
          }}
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          Create Coupon
        </button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map(i => (
            <div key={i} className="animate-pulse rounded-xl" style={{ height: '3.5rem', background: 'var(--color-bg-tertiary)' }} />
          ))}
        </div>
      ) : coupons.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center py-12 text-center bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl"
        >
          <Ticket className="w-8 h-8 text-[var(--color-text-subtle)] mb-2" aria-hidden="true" />
          <p className="text-sm text-[var(--color-text-muted)]">No coupons yet. Create one to offer discounts.</p>
        </div>
      ) : (
        <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl overflow-hidden">
          <div className="h-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <th className="text-left text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider" style={{ padding: '0.75rem 1rem' }}>Code</th>
                  <th className="text-left text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider" style={{ padding: '0.75rem 1rem' }}>Discount</th>
                  <th className="text-left text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider hidden sm:table-cell" style={{ padding: '0.75rem 1rem' }}>Uses</th>
                  <th className="text-left text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider hidden md:table-cell" style={{ padding: '0.75rem 1rem' }}>Expires</th>
                  <th className="text-center text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider" style={{ padding: '0.75rem 1rem' }}>Status</th>
                  <th className="text-right text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider" style={{ padding: '0.75rem 1rem' }}></th>
                </tr>
              </thead>
              <tbody>
                {coupons.map((coupon, i) => {
                  const expired = isExpired(coupon.expiresAt)
                  const exhausted = coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses
                  const active = !expired && !exhausted

                  return (
                    <tr
                      key={coupon.code}
                      className="transition-colors hover:bg-[var(--color-bg-secondary)]"
                      style={{
                        borderBottom: i < coupons.length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
                      }}
                    >
                      <td style={{ padding: '0.75rem 1rem' }}>
                        <span className="font-mono font-semibold text-[var(--color-text)]">{coupon.code}</span>
                      </td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        <span className="font-semibold text-[var(--color-brand-dark)]">{coupon.discountPercent}%</span>
                      </td>
                      <td className="hidden sm:table-cell" style={{ padding: '0.75rem 1rem' }}>
                        <span className="text-[var(--color-text-muted)]">
                          {coupon.usedCount}{coupon.maxUses !== null ? ` / ${coupon.maxUses}` : ' (unlimited)'}
                        </span>
                      </td>
                      <td className="hidden md:table-cell" style={{ padding: '0.75rem 1rem' }}>
                        <span className="text-[var(--color-text-muted)]">
                          {coupon.expiresAt
                            ? new Date(coupon.expiresAt).toLocaleDateString()
                            : 'Never'}
                        </span>
                      </td>
                      <td className="text-center" style={{ padding: '0.75rem 1rem' }}>
                        <span
                          className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full"
                          style={{
                            background: active ? 'var(--color-success-bg)' : 'var(--color-bg-tertiary)',
                            color: active ? 'var(--color-success)' : 'var(--color-text-subtle)',
                          }}
                        >
                          {expired ? 'Expired' : exhausted ? 'Exhausted' : 'Active'}
                        </span>
                      </td>
                      <td className="text-right" style={{ padding: '0.75rem 1rem' }}>
                        <button
                          onClick={() => handleDelete(coupon.code)}
                          disabled={deleting === coupon.code}
                          className="text-[var(--color-text-subtle)] hover:text-[var(--color-danger)] transition-colors"
                          style={{ cursor: 'pointer', background: 'none', border: 'none' }}
                          aria-label={`Delete coupon ${coupon.code}`}
                        >
                          {deleting === coupon.code ? (
                            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                          )}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showForm && (
        <CreateCouponDialog
          onClose={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false)
            void mutateCoupons()
          }}
        />
      )}
    </div>
  )
}

// ---- Create Coupon Dialog ----------------------------------------------------

function CreateCouponDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const [code, setCode] = useState('')
  const [discountPercent, setDiscountPercent] = useState('')
  const [maxUses, setMaxUses] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [creating, setCreating] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const handleSubmit = async () => {
    if (!code.trim()) {
      setErrorMsg('Coupon code is required')
      return
    }
    const pct = parseInt(discountPercent, 10)
    if (!pct || pct < 1 || pct > 100) {
      setErrorMsg('Discount must be between 1 and 100')
      return
    }

    setCreating(true)
    setErrorMsg('')

    try {
      const res = await fetch(apiPath('/api/admin/services/coupons'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code.trim(),
          discountPercent: pct,
          maxUses: maxUses ? parseInt(maxUses, 10) : null,
          expiresAt: expiresAt || null,
        }),
      })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        throw new Error(data.error ?? 'Failed to create coupon')
      }
      onCreated()
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to create coupon')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center"
      style={{ background: 'rgba(0, 0, 0, 0.5)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-coupon-title"
    >
      <div
        className="w-full max-w-md"
        style={{
          background: 'var(--color-bg)',
          borderRadius: 'var(--radius-card)',
          boxShadow: 'var(--shadow-lg)',
          padding: '1.5rem',
        }}
      >
        <h2 id="create-coupon-title" className="text-lg font-semibold text-[var(--color-text)] mb-4">
          Create Coupon
        </h2>

        <div className="space-y-4">
          <div>
            <label htmlFor="coupon-code" className="block text-sm font-medium text-[var(--color-text)] mb-1">Coupon Code</label>
            <input
              id="coupon-code"
              type="text"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. SAVE20"
              className="w-full text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] font-mono"
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: 'var(--radius-input)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
                minHeight: '2.75rem',
              }}
            />
          </div>

          <div>
            <label htmlFor="coupon-discount" className="block text-sm font-medium text-[var(--color-text)] mb-1">Discount (%)</label>
            <input
              id="coupon-discount"
              type="number"
              min="1"
              max="100"
              value={discountPercent}
              onChange={e => setDiscountPercent(e.target.value)}
              placeholder="e.g. 20"
              className="w-full text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)]"
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: 'var(--radius-input)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
                minHeight: '2.75rem',
              }}
            />
          </div>

          <div>
            <label htmlFor="coupon-max-uses" className="block text-sm font-medium text-[var(--color-text)] mb-1">Max Uses (optional)</label>
            <input
              id="coupon-max-uses"
              type="number"
              min="1"
              value={maxUses}
              onChange={e => setMaxUses(e.target.value)}
              placeholder="Leave empty for unlimited"
              className="w-full text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)]"
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: 'var(--radius-input)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
                minHeight: '2.75rem',
              }}
            />
          </div>

          <div>
            <label htmlFor="coupon-expires" className="block text-sm font-medium text-[var(--color-text)] mb-1">Expiry Date (optional)</label>
            <input
              id="coupon-expires"
              type="date"
              value={expiresAt}
              onChange={e => setExpiresAt(e.target.value)}
              className="w-full text-sm text-[var(--color-text)]"
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: 'var(--radius-input)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
                minHeight: '2.75rem',
              }}
            />
          </div>

          {errorMsg && (
            <div aria-live="polite" className="text-sm" style={{ color: 'var(--color-danger)' }}>
              {errorMsg}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium transition-colors"
            style={{
              color: 'var(--color-text-muted)',
              background: 'var(--color-bg-secondary)',
              borderRadius: 'var(--radius-button)',
              border: '1px solid var(--color-border)',
              cursor: 'pointer',
              minHeight: '2.75rem',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={creating}
            className="px-4 py-2 text-sm font-medium text-white transition-colors"
            style={{
              background: 'var(--color-brand)',
              borderRadius: 'var(--radius-button)',
              border: 'none',
              cursor: creating ? 'not-allowed' : 'pointer',
              opacity: creating ? 0.7 : 1,
              minHeight: '2.75rem',
            }}
          >
            {creating ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                Creating...
              </span>
            ) : (
              'Create Coupon'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---- Service Dialog ----------------------------------------------------------

const AUDIENCE_OPTIONS = [
  { value: 'everyone' as const, label: 'Everyone' },
  { value: 'client' as const, label: 'One client' },
]

const VISIBILITY_OPTIONS = [
  { value: 'public' as const, label: 'Shown' },
  { value: 'hidden' as const, label: 'Hidden' },
]

/**
 * Create or edit one catalogue row. `service` null means create.
 *
 * Two controls carry the CT.11 audience decision:
 *
 *   Audience    Everyone (org_id null) or one named client (org_id set). A
 *               private row is the only way a per-client retainer name can
 *               exist without every other client reading it off their portal.
 *   Visibility  Shown or Hidden. This writes BOTH `visibility` and the older
 *               `showInCatalog` flag, deliberately: the portal requires both,
 *               so two separate switches in here would let the studio set one
 *               to Shown and still watch the row not appear.
 */
function ServiceDialog({
  service,
  clients,
  onClose,
  onSaved,
}: {
  service: ServiceItem | null
  clients: ClientOption[]
  onClose: () => void
  onSaved: () => void
}) {
  const editing = service !== null
  const [name, setName] = useState(service?.name ?? '')
  const [description, setDescription] = useState(service?.description ?? '')
  const [priceStr, setPriceStr] = useState(service ? String(service.price / 100) : '')
  const [currency, setCurrency] = useState(service?.currency ?? 'NZD')
  const [isRecurring, setIsRecurring] = useState(service ? service.isRecurring === 1 : false)
  const [recurringInterval, setRecurringInterval] = useState(service?.recurringInterval ?? 'month')
  const [visibility, setVisibility] = useState<'public' | 'hidden'>(
    service && !isShown(service) ? 'hidden' : 'public',
  )
  const [audience, setAudience] = useState<Audience>(service?.orgId ? 'client' : 'everyone')
  const [audienceOrgId, setAudienceOrgId] = useState<string | null>(service?.orgId ?? null)
  const [category, setCategory] = useState(service?.category ?? '')
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const clientOptions = clients.map(c => ({ value: c.id, label: c.name }))

  const handleSubmit = async () => {
    if (!name.trim()) {
      setErrorMsg('Name is required')
      return
    }
    if (audience === 'client' && !audienceOrgId) {
      setErrorMsg('Pick the client this service is private to, or set the audience back to Everyone')
      return
    }
    setSaving(true)
    setErrorMsg('')

    const priceInCents = Math.round(parseFloat(priceStr || '0') * 100)
    const shown = visibility === 'public'

    try {
      const res = await fetch(
        apiPath(editing ? `/api/admin/services/${service.id}` : '/api/admin/services'),
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            description: description.trim() || null,
            price: priceInCents,
            currency,
            isRecurring,
            recurringInterval: isRecurring ? recurringInterval : null,
            // One control, both flags. See the note above the component.
            showInCatalog: shown,
            visibility,
            category: category || null,
            orgId: audience === 'client' ? audienceOrgId : null,
          }),
        },
      )
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        throw new Error(data.error ?? 'Failed to save service')
      }
      onSaved()
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save service')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center"
      style={{ background: 'rgba(0, 0, 0, 0.5)', padding: '1rem' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="service-dialog-title"
    >
      <div
        className="w-full max-w-md"
        style={{
          background: 'var(--color-bg)',
          borderRadius: 'var(--radius-card)',
          boxShadow: 'var(--shadow-lg)',
          padding: '1.5rem',
          maxHeight: 'calc(100vh - 2rem)',
          overflowY: 'auto',
        }}
      >
        <h2 id="service-dialog-title" className="text-lg font-semibold text-[var(--color-text)] mb-4">
          {editing ? 'Edit Service' : 'Create Service'}
        </h2>

        <div className="space-y-4">
          {/* Name */}
          <div>
            <label htmlFor="svc-name" className="block text-sm font-medium text-[var(--color-text)] mb-1">Name</label>
            <input
              id="svc-name"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Website Redesign"
              className="w-full text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)]"
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: 'var(--radius-input)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
                minHeight: '2.75rem',
              }}
            />
          </div>

          {/* Description */}
          <div>
            <label htmlFor="svc-desc" className="block text-sm font-medium text-[var(--color-text)] mb-1">Description</label>
            <textarea
              id="svc-desc"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Brief description of the service..."
              rows={2}
              className="w-full text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] resize-none"
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: 'var(--radius-input)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
              }}
            />
          </div>

          {/* Price + Currency */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="svc-price" className="block text-sm font-medium text-[var(--color-text)] mb-1">Price</label>
              <input
                id="svc-price"
                type="number"
                min="0"
                step="0.01"
                value={priceStr}
                onChange={e => setPriceStr(e.target.value)}
                placeholder="0.00"
                className="w-full text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)]"
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: 'var(--radius-input)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg)',
                  minHeight: '2.75rem',
                }}
              />
            </div>
            <div>
              <label htmlFor="svc-currency" className="block text-sm font-medium text-[var(--color-text)] mb-1">Currency</label>
              <select
                id="svc-currency"
                value={currency}
                onChange={e => setCurrency(e.target.value)}
                className="w-full text-sm text-[var(--color-text)]"
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: 'var(--radius-input)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg)',
                  minHeight: '2.75rem',
                }}
              >
                <option value="NZD">NZD</option>
                <option value="USD">USD</option>
                <option value="AUD">AUD</option>
                <option value="GBP">GBP</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
          </div>

          {/* Recurring */}
          <div className="flex items-center justify-between">
            <label htmlFor="svc-recurring" className="text-sm font-medium text-[var(--color-text)]">Recurring</label>
            <button
              id="svc-recurring"
              onClick={() => setIsRecurring(!isRecurring)}
              className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
              style={{ background: isRecurring ? 'var(--color-brand)' : 'var(--color-border)' }}
              role="switch"
              aria-checked={isRecurring}
            >
              <span
                className="inline-block h-4 w-4 rounded-full bg-white transition-transform"
                style={{ transform: isRecurring ? 'translateX(1.375rem)' : 'translateX(0.25rem)' }}
              />
            </button>
          </div>

          {isRecurring && (
            <div>
              <label htmlFor="svc-interval" className="block text-sm font-medium text-[var(--color-text)] mb-1">Billing Interval</label>
              <select
                id="svc-interval"
                value={recurringInterval}
                onChange={e => setRecurringInterval(e.target.value)}
                className="w-full text-sm text-[var(--color-text)]"
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: 'var(--radius-input)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg)',
                  minHeight: '2.75rem',
                }}
              >
                <option value="month">Monthly</option>
                <option value="year">Yearly</option>
              </select>
            </div>
          )}

          {/* Category */}
          <div>
            <label htmlFor="svc-category" className="block text-sm font-medium text-[var(--color-text)] mb-1">Category</label>
            <select
              id="svc-category"
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="w-full text-sm text-[var(--color-text)]"
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: 'var(--radius-input)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
                minHeight: '2.75rem',
              }}
            >
              <option value="">No category</option>
              <option value="service">Service</option>
              <option value="topup">Top-up</option>
              <option value="addon">Add-on</option>
            </select>
          </div>

          {/* Audience: everyone, or one client */}
          <div>
            <span className="block text-sm font-medium text-[var(--color-text)] mb-1">Audience</span>
            <SegmentedControl
              value={audience}
              onChange={setAudience}
              options={AUDIENCE_OPTIONS}
              ariaLabel="Who this service is for"
              describedBy="svc-audience-help"
              role="radiogroup"
              size="sm"
              fill
            />
            <p id="svc-audience-help" className="text-xs text-[var(--color-text-muted)] mt-1">
              {audience === 'everyone'
                ? 'Every client sees this on their Services page.'
                : 'Only the client below sees it. Use this for a retainer named after them.'}
            </p>
            {audience === 'client' && (
              <div className="mt-2">
                <SearchableSelect
                  options={clientOptions}
                  value={audienceOrgId}
                  onChange={setAudienceOrgId}
                  placeholder="Select a client..."
                  searchPlaceholder="Search clients..."
                  emptyMessage="No clients found."
                  allowClear
                />
              </div>
            )}
          </div>

          {/* Visibility */}
          <div>
            <span className="block text-sm font-medium text-[var(--color-text)] mb-1">Visibility</span>
            <SegmentedControl
              value={visibility}
              onChange={setVisibility}
              options={VISIBILITY_OPTIONS}
              ariaLabel="Whether clients can see this service"
              describedBy="svc-visibility-help"
              role="radiogroup"
              size="sm"
              fill
            />
            <p id="svc-visibility-help" className="text-xs text-[var(--color-text-muted)] mt-1 flex items-start gap-1.5">
              {visibility === 'hidden' && <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />}
              <span>
                {visibility === 'hidden'
                  ? 'Kept out of the client portal entirely, whoever it is for.'
                  : 'Published to the Services page of whoever the audience is.'}
              </span>
            </p>
          </div>

          {errorMsg && (
            <div aria-live="polite" className="text-sm" style={{ color: 'var(--color-danger)' }}>
              {errorMsg}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium transition-colors"
            style={{
              color: 'var(--color-text-muted)',
              background: 'var(--color-bg-secondary)',
              borderRadius: 'var(--radius-button)',
              border: '1px solid var(--color-border)',
              cursor: 'pointer',
              minHeight: '2.75rem',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white transition-colors"
            style={{
              background: 'var(--color-brand)',
              borderRadius: 'var(--radius-button)',
              border: 'none',
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.7 : 1,
              minHeight: '2.75rem',
            }}
          >
            {saving ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                {editing ? 'Saving...' : 'Creating...'}
              </span>
            ) : (
              editing ? 'Save Service' : 'Create Service'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
