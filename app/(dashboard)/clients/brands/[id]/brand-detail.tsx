'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { apiPath } from '@/lib/api'
import { Breadcrumb } from '@/components/tahi/breadcrumb'
import {
  Globe,
  Building2,
  Palette,
  Users,
  Layers,
  ChevronRight,
  FileText,
} from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'

// ── Types ───────────────────────────────────────────────────────────────────

interface BrandContact {
  id: string
  name: string
  email: string
  role: string | null
  isPrimary: boolean | number | null
}

interface BrandData {
  id: string
  orgId: string
  name: string
  logoUrl: string | null
  website: string | null
  primaryColour: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  orgName: string | null
  requestCount: number
  contacts: BrandContact[]
}

// ── Main component ──────────────────────────────────────────────────────────

export function BrandDetail({ brandId }: { brandId: string }) {
  const router = useRouter()
  const [brand, setBrand] = useState<BrandData | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiPath(`/api/admin/brands/${brandId}`))
      if (!res.ok) {
        router.push('/clients')
        return
      }
      setBrand(await res.json() as BrandData)
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId])

  useEffect(() => { void load() }, [load])

  if (loading) return <LoadingSkeleton />
  if (!brand) return null

  return (
    <div className="flex flex-col min-h-0">
      {/* Header */}
      <div className="border-b border-[var(--color-border)] bg-[var(--color-bg)]">
        <div className="pb-1.5">
          <div style={{ marginBottom: '0.75rem' }}>
            <Breadcrumb
              items={[
                { label: 'Clients', href: '/clients' },
                ...(brand.orgName
                  ? [{ label: brand.orgName, href: `/clients/${brand.orgId}` }]
                  : []),
                { label: brand.name },
              ]}
            />
          </div>

          <div className="flex flex-col gap-3 mb-5 sm:flex-row sm:items-start">
            <div className="flex items-start gap-3 flex-1 min-w-0">
              {/* Brand icon / colour swatch */}
              {brand.logoUrl ? (
                <img
                  src={brand.logoUrl}
                  alt={brand.name}
                  className="flex-shrink-0 object-contain"
                  style={{
                    width: '3rem',
                    height: '3rem',
                    borderRadius: 'var(--radius-leaf)',
                    border: '1px solid var(--color-border)',
                  }}
                />
              ) : (
                <div
                  className="flex-shrink-0 flex items-center justify-center"
                  style={{
                    width: '3rem',
                    height: '3rem',
                    borderRadius: 'var(--radius-leaf)',
                    background: brand.primaryColour
                      ? brand.primaryColour
                      : 'linear-gradient(135deg, var(--color-brand), var(--color-brand-dark))',
                  }}
                >
                  <Palette
                    className="text-white"
                    style={{ width: '1.25rem', height: '1.25rem' }}
                  />
                </div>
              )}

              <div className="flex-1 min-w-0">
                <h1 className="text-xl font-bold text-[var(--color-text)] md:text-2xl break-words">
                  {brand.name}
                </h1>
                <div className="flex items-center gap-3 flex-wrap mt-1.5">
                  {brand.primaryColour && (
                    <div className="flex items-center gap-1.5">
                      <div
                        className="flex-shrink-0 border border-[var(--color-border)]"
                        style={{
                          width: '1rem',
                          height: '1rem',
                          borderRadius: '0.25rem',
                          background: brand.primaryColour,
                        }}
                      />
                      <span className="text-xs text-[var(--color-text-muted)] font-mono">
                        {brand.primaryColour}
                      </span>
                    </div>
                  )}
                  {brand.website && (
                    <a
                      href={brand.website.startsWith('http') ? brand.website : `https://${brand.website}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-brand)]"
                    >
                      <Globe className="w-3.5 h-3.5" />
                      {brand.website.replace(/^https?:\/\//, '')}
                    </a>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column */}
          <div className="lg:col-span-1 space-y-6">
            {/* Organisation link */}
            {brand.orgName && (
              <div
                className="bg-[var(--color-bg)] border border-[var(--color-border)] cursor-pointer transition-colors hover:border-[var(--color-brand)]"
                style={{ borderRadius: '0.75rem', padding: '1.25rem' }}
                onClick={() => router.push(`/clients/${brand.orgId}`)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/clients/${brand.orgId}`) }}
              >
                <h2
                  className="text-xs font-semibold uppercase text-[var(--color-text-muted)] mb-3"
                  style={{ letterSpacing: '0.05em' }}
                >
                  Organisation
                </h2>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Building2 className="w-4 h-4 text-[var(--color-brand)] flex-shrink-0" />
                    <p className="text-sm font-medium text-[var(--color-text)] truncate">
                      {brand.orgName}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-[var(--color-text-subtle)] flex-shrink-0" />
                </div>
              </div>
            )}

            {/* Brand details card */}
            <div
              className="bg-[var(--color-bg)] border border-[var(--color-border)]"
              style={{ borderRadius: '0.75rem', padding: '1.25rem' }}
            >
              <h2
                className="text-xs font-semibold uppercase text-[var(--color-text-muted)] mb-4"
                style={{ letterSpacing: '0.05em' }}
              >
                Brand Details
              </h2>

              <div className="space-y-3">
                {brand.primaryColour && (
                  <div className="flex items-center gap-2.5">
                    <Palette className="w-4 h-4 text-[var(--color-text-subtle)]" />
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-[var(--color-text)]">Primary Colour</span>
                      <div
                        className="border border-[var(--color-border)]"
                        style={{
                          width: '1.5rem',
                          height: '1.5rem',
                          borderRadius: '0.25rem',
                          background: brand.primaryColour,
                        }}
                      />
                      <span className="text-xs text-[var(--color-text-muted)] font-mono">
                        {brand.primaryColour}
                      </span>
                    </div>
                  </div>
                )}
                {brand.website && (
                  <div className="flex items-center gap-2.5">
                    <Globe className="w-4 h-4 text-[var(--color-text-subtle)]" />
                    <a
                      href={brand.website.startsWith('http') ? brand.website : `https://${brand.website}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-[var(--color-brand)] hover:underline truncate"
                    >
                      {brand.website.replace(/^https?:\/\//, '')}
                    </a>
                  </div>
                )}
                <div className="flex items-center gap-2.5">
                  <Layers className="w-4 h-4 text-[var(--color-text-subtle)]" />
                  <span className="text-sm text-[var(--color-text)]">
                    {brand.requestCount} request{brand.requestCount !== 1 ? 's' : ''} tagged
                  </span>
                </div>
                <div className="flex items-center gap-2.5">
                  <Users className="w-4 h-4 text-[var(--color-text-subtle)]" />
                  <span className="text-sm text-[var(--color-text)]">
                    {brand.contacts.length} contact{brand.contacts.length !== 1 ? 's' : ''} linked
                  </span>
                </div>
              </div>

              {brand.notes && (
                <div className="mt-4 pt-4 border-t border-[var(--color-border-subtle)]">
                  <h3 className="text-xs font-medium text-[var(--color-text-muted)] mb-1.5">Notes</h3>
                  <p className="text-sm text-[var(--color-text)] whitespace-pre-wrap">
                    {brand.notes}
                  </p>
                </div>
              )}

              <div className="mt-3 pt-3 border-t border-[var(--color-border-subtle)]">
                <p className="text-xs text-[var(--color-text-subtle)]">
                  Created {new Date(brand.createdAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </p>
              </div>
            </div>
          </div>

          {/* Right column */}
          <div className="lg:col-span-2 space-y-6">
            {/* Contacts linked to this brand */}
            <div
              className="bg-[var(--color-bg)] border border-[var(--color-border)]"
              style={{ borderRadius: '0.75rem', padding: '1.25rem' }}
            >
              <h2
                className="text-xs font-semibold uppercase text-[var(--color-text-muted)] mb-4"
                style={{ letterSpacing: '0.05em' }}
              >
                <Users className="w-3.5 h-3.5 inline mr-1.5" style={{ verticalAlign: '-0.125em' }} />
                Contacts ({brand.contacts.length})
              </h2>

              {brand.contacts.length === 0 ? (
                <EmptyBlock
                  icon={<Users className="w-5 h-5" />}
                  title="No contacts linked"
                  description="Link contacts to this brand from the client detail page."
                />
              ) : (
                <div className="space-y-2">
                  {brand.contacts.map((contact) => {
                    const isPrimary = contact.isPrimary === true || contact.isPrimary === 1
                    return (
                      <div
                        key={contact.id}
                        className="flex items-center gap-3 cursor-pointer hover:bg-[var(--color-bg-secondary)] transition-colors"
                        style={{ borderRadius: '0.375rem', padding: '0.625rem 0.5rem' }}
                        onClick={() => router.push(`/clients/contacts/${contact.id}`)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/clients/contacts/${contact.id}`) }}
                      >
                        {/* Avatar */}
                        <div
                          className="flex-shrink-0 flex items-center justify-center text-white font-semibold"
                          style={{
                            width: '2rem',
                            height: '2rem',
                            borderRadius: 'var(--radius-leaf-sm)',
                            background: 'var(--color-brand)',
                            fontSize: '0.75rem',
                          }}
                        >
                          {contact.name.charAt(0).toUpperCase()}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-[var(--color-text)] truncate">
                              {contact.name}
                            </span>
                            {isPrimary && (
                              <span
                                className="text-xs px-1.5 py-0.5 rounded-full flex-shrink-0"
                                style={{ background: 'var(--color-success-bg)', color: 'var(--color-brand)' }}
                              >
                                Primary
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-0.5">
                            <span className="text-xs text-[var(--color-text-muted)] truncate">
                              {contact.email}
                            </span>
                            {contact.role && (
                              <span className="text-xs text-[var(--color-text-subtle)]">
                                {contact.role}
                              </span>
                            )}
                          </div>
                        </div>

                        <ChevronRight className="w-4 h-4 text-[var(--color-text-subtle)] flex-shrink-0" />
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Requests summary */}
            <div
              className="bg-[var(--color-bg)] border border-[var(--color-border)]"
              style={{ borderRadius: '0.75rem', padding: '1.25rem' }}
            >
              <h2
                className="text-xs font-semibold uppercase text-[var(--color-text-muted)] mb-4"
                style={{ letterSpacing: '0.05em' }}
              >
                <Layers className="w-3.5 h-3.5 inline mr-1.5" style={{ verticalAlign: '-0.125em' }} />
                Tagged Requests
              </h2>

              {brand.requestCount === 0 ? (
                <EmptyBlock
                  icon={<FileText className="w-5 h-5" />}
                  title="No requests tagged"
                  description="Requests can be tagged with this brand when creating or editing them."
                />
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-2xl font-bold text-[var(--color-text)]">
                      {brand.requestCount}
                    </p>
                    <p className="text-sm text-[var(--color-text-muted)]">
                      request{brand.requestCount !== 1 ? 's' : ''} tagged with this brand
                    </p>
                  </div>
                  <TahiButton
                    variant="secondary"
                    size="sm"
                    onClick={() => router.push(`/clients/${brand.orgId}`)}
                  >
                    View Client
                    <ChevronRight className="w-3.5 h-3.5" />
                  </TahiButton>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Mobile bottom nav spacer */}
        <div className="h-28 md:hidden" aria-hidden="true" />
      </div>
    </div>
  )
}

// ── Empty block ─────────────────────────────────────────────────────────────

function EmptyBlock({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <div
        className="flex items-center justify-center mb-3"
        style={{
          width: '2.5rem',
          height: '2.5rem',
          borderRadius: 'var(--radius-leaf)',
          background: 'linear-gradient(135deg, var(--color-brand-50), var(--color-brand-100))',
          color: 'var(--color-brand)',
        }}
      >
        {icon}
      </div>
      <p className="text-sm font-medium text-[var(--color-text)]">{title}</p>
      <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{description}</p>
    </div>
  )
}

// ── Loading skeleton ────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="flex flex-col min-h-0">
      <div className="border-b border-[var(--color-border)] bg-[var(--color-bg)] pb-6">
        <div className="animate-pulse" style={{ marginBottom: '0.75rem' }}>
          <div style={{ width: '14rem', height: '0.875rem', background: 'var(--color-bg-tertiary)', borderRadius: '0.25rem' }} />
        </div>
        <div className="flex items-start gap-3">
          <div
            className="animate-pulse flex-shrink-0"
            style={{ width: '3rem', height: '3rem', borderRadius: 'var(--radius-leaf)', background: 'var(--color-bg-tertiary)' }}
          />
          <div className="space-y-2 flex-1">
            <div className="animate-pulse" style={{ width: '10rem', height: '1.5rem', background: 'var(--color-bg-tertiary)', borderRadius: '0.25rem' }} />
            <div className="animate-pulse" style={{ width: '8rem', height: '1rem', background: 'var(--color-bg-tertiary)', borderRadius: '0.25rem' }} />
          </div>
        </div>
      </div>
      <div className="py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-6">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="animate-pulse bg-[var(--color-bg)] border border-[var(--color-border)]"
                style={{ borderRadius: '0.75rem', padding: '1.25rem', height: '10rem' }}
              >
                <div style={{ width: '8rem', height: '0.75rem', background: 'var(--color-bg-tertiary)', borderRadius: '0.25rem', marginBottom: '1rem' }} />
                <div style={{ width: '100%', height: '0.75rem', background: 'var(--color-bg-tertiary)', borderRadius: '0.25rem', marginBottom: '0.5rem' }} />
                <div style={{ width: '60%', height: '0.75rem', background: 'var(--color-bg-tertiary)', borderRadius: '0.25rem' }} />
              </div>
            ))}
          </div>
          <div className="lg:col-span-2 space-y-6">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="animate-pulse bg-[var(--color-bg)] border border-[var(--color-border)]"
                style={{ borderRadius: '0.75rem', padding: '1.25rem', height: '12rem' }}
              >
                <div style={{ width: '10rem', height: '0.75rem', background: 'var(--color-bg-tertiary)', borderRadius: '0.25rem', marginBottom: '1rem' }} />
                <div className="space-y-3">
                  {[1, 2, 3].map((j) => (
                    <div key={j} style={{ width: '100%', height: '2rem', background: 'var(--color-bg-tertiary)', borderRadius: '0.25rem' }} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
