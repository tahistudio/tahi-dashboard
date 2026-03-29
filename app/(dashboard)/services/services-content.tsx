'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  ShoppingBag, Plus, RefreshCw, Tag, Loader2,
} from 'lucide-react'
import { apiPath } from '@/lib/api'

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
  createdAt: string
  updatedAt: string
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
  const [services, setServices] = useState<ServiceItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  const fetchServices = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiPath('/api/admin/services'))
      if (!res.ok) throw new Error('Failed')
      const data = (await res.json()) as { items: ServiceItem[] }
      setServices(data.items ?? [])
    } catch {
      setServices([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchServices()
  }, [fetchServices])

  return (
    <div className="space-y-6" style={{ maxWidth: '68.75rem' }}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Services</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            Manage your service catalogue. Clients see services marked as visible.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchServices}
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
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <th className="text-left text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider" style={{ padding: '0.75rem 1rem' }}>Name</th>
                  <th className="text-left text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider" style={{ padding: '0.75rem 1rem' }}>Price</th>
                  <th className="text-left text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider hidden sm:table-cell" style={{ padding: '0.75rem 1rem' }}>Type</th>
                  <th className="text-left text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider hidden md:table-cell" style={{ padding: '0.75rem 1rem' }}>Category</th>
                  <th className="text-center text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider" style={{ padding: '0.75rem 1rem' }}>Visible</th>
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
                      <div className="font-medium text-[var(--color-text)]">{svc.name}</div>
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
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full"
                        style={{
                          background: svc.showInCatalog
                            ? 'var(--color-success)'
                            : 'var(--color-border)',
                        }}
                        title={svc.showInCatalog ? 'Visible to clients' : 'Hidden from clients'}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showForm && (
        <CreateServiceDialog
          onClose={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false)
            fetchServices()
          }}
        />
      )}
    </div>
  )
}

// ---- Client Portal Services --------------------------------------------------

export function PortalServicesContent() {
  const [services, setServices] = useState<ServiceItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(apiPath('/api/portal/services'))
      .then(r => {
        if (!r.ok) throw new Error('Failed')
        return r.json() as Promise<{ items: ServiceItem[] }>
      })
      .then(data => setServices(data.items ?? []))
      .catch(() => setServices([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-6" style={{ maxWidth: '56.25rem' }}>
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Services</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">
          Browse available services and add-ons.
        </p>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="animate-pulse rounded-xl" style={{ height: '8rem', background: 'var(--color-bg-tertiary)' }} />
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
          <h3 className="text-base font-semibold text-[var(--color-text)] mb-2">No services available</h3>
          <p className="text-sm text-[var(--color-text-muted)] max-w-sm">
            Check back later for available services and add-ons.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {services.map(svc => (
            <div
              key={svc.id}
              className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl transition-shadow hover:shadow-md"
              style={{ padding: '1.25rem' }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-[var(--color-text)]">{svc.name}</h3>
                  {svc.description && (
                    <p className="text-xs text-[var(--color-text-muted)] mt-1 line-clamp-2">{svc.description}</p>
                  )}
                </div>
                {svc.category && (
                  <span
                    className="text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{
                      background: 'var(--color-bg-tertiary)',
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    {CATEGORY_LABELS[svc.category] ?? svc.category}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between mt-4">
                <span className="text-lg font-bold text-[var(--color-text)]">
                  {formatPrice(svc.price, svc.currency)}
                </span>
                {svc.isRecurring ? (
                  <span className="text-xs text-[var(--color-text-muted)]">
                    / {svc.recurringInterval === 'year' ? 'year' : 'month'}
                  </span>
                ) : (
                  <span className="text-xs text-[var(--color-text-muted)]">one-time</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---- Create Service Dialog ---------------------------------------------------

function CreateServiceDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [priceStr, setPriceStr] = useState('')
  const [currency, setCurrency] = useState('NZD')
  const [isRecurring, setIsRecurring] = useState(false)
  const [recurringInterval, setRecurringInterval] = useState('month')
  const [showInCatalog, setShowInCatalog] = useState(true)
  const [category, setCategory] = useState('')
  const [creating, setCreating] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const handleSubmit = async () => {
    if (!name.trim()) {
      setErrorMsg('Name is required')
      return
    }
    setCreating(true)
    setErrorMsg('')

    const priceInCents = Math.round(parseFloat(priceStr || '0') * 100)

    try {
      const res = await fetch(apiPath('/api/admin/services'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          price: priceInCents,
          currency,
          isRecurring,
          recurringInterval: isRecurring ? recurringInterval : undefined,
          showInCatalog,
          category: category || undefined,
        }),
      })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        throw new Error(data.error ?? 'Failed to create service')
      }
      onCreated()
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to create service')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0, 0, 0, 0.5)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-service-title"
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
        <h2 id="create-service-title" className="text-lg font-semibold text-[var(--color-text)] mb-4">
          Create Service
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

          {/* Visible in catalog */}
          <div className="flex items-center justify-between">
            <label htmlFor="svc-visible" className="text-sm font-medium text-[var(--color-text)]">Show in client catalogue</label>
            <button
              id="svc-visible"
              onClick={() => setShowInCatalog(!showInCatalog)}
              className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
              style={{ background: showInCatalog ? 'var(--color-brand)' : 'var(--color-border)' }}
              role="switch"
              aria-checked={showInCatalog}
            >
              <span
                className="inline-block h-4 w-4 rounded-full bg-white transition-transform"
                style={{ transform: showInCatalog ? 'translateX(1.375rem)' : 'translateX(0.25rem)' }}
              />
            </button>
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
              'Create Service'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
