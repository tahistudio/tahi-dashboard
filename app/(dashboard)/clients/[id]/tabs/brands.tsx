'use client'

/** The client Brands tab: the real brands table, with create, edit and
 *  delete. */

import { useState } from 'react'
import useSWR from 'swr'
import { Check, Loader2, Palette, Pencil, Plus, Trash2 } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { Card } from '@/components/tahi/card'
import { EmptyState } from '@/components/tahi/empty-state'
import { SkeletonList } from '@/components/tahi/skeletons'
import { TahiButton } from '@/components/tahi/tahi-button'
import { CountText, Grow, SubBar } from '../_kit/chrome'

// ── Brands tab ────────────────────────────────────────────────────────────────

export interface BrandRow {
  id: string
  name: string
  logoUrl: string | null
  website: string | null
  primaryColour: string | null
  notes: string | null
  contactCount: number
  requestCount: number
  createdAt: string
}

export function BrandsTab({ clientId }: { clientId: string }) {
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Create / Edit form state
  const [formName, setFormName] = useState('')
  const [formLogoUrl, setFormLogoUrl] = useState('')
  const [formWebsite, setFormWebsite] = useState('')
  const [formColour, setFormColour] = useState('#5A824E')
  const [formSaving, setFormSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [brokenLogos, setBrokenLogos] = useState<Set<string>>(new Set())

  const { data, isLoading: loading, mutate: load } = useSWR<{ items: BrandRow[] }>(
    `/api/admin/brands?orgId=${clientId}`,
  )
  const brands = data?.items ?? []

  const resetForm = () => {
    setFormName('')
    setFormLogoUrl('')
    setFormWebsite('')
    setFormColour('#5A824E')
    setFormError(null)
    setShowCreate(false)
    setEditingId(null)
  }

  const openEdit = (brand: BrandRow) => {
    setEditingId(brand.id)
    setFormName(brand.name)
    setFormLogoUrl(brand.logoUrl ?? '')
    setFormWebsite(brand.website ?? '')
    setFormColour(brand.primaryColour ?? '#5A824E')
    setFormError(null)
    setShowCreate(false)
  }

  const handleSave = async () => {
    if (!formName.trim()) {
      setFormError('Brand name is required')
      return
    }
    setFormSaving(true)
    setFormError(null)
    try {
      const body = {
        name: formName.trim(),
        logoUrl: formLogoUrl.trim() || null,
        website: formWebsite.trim() || null,
        primaryColour: formColour || null,
        ...(editingId ? {} : { orgId: clientId }),
      }

      const url = editingId
        ? apiPath(`/api/admin/brands/${editingId}`)
        : apiPath('/api/admin/brands')
      const method = editingId ? 'PATCH' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const data = await res.json() as { error?: string }
        setFormError(data.error ?? 'Failed to save brand')
        return
      }

      resetForm()
      void load()
    } catch {
      setFormError('Network error')
    } finally {
      setFormSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try {
      const res = await fetch(apiPath(`/api/admin/brands/${id}`), { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed')
      void load()
    } catch {
      // silently fail
    } finally {
      setDeletingId(null)
    }
  }

  if (loading) {
    return (
      <SkeletonList rows={4} />
    )
  }

  return (
    <div>
      <SubBar style={{ marginBottom: '0.75rem' }}>
        <CountText>
          {brands.length === 0
            ? 'One identity'
            : `${brands.length} ${brands.length === 1 ? 'brand' : 'brands'}`}
        </CountText>
        <Grow />
        <TahiButton
          size="sm"
          onClick={() => { resetForm(); setShowCreate(true) }}
          iconLeft={<Plus className="w-3.5 h-3.5" />}
        >
          Add a brand
        </TahiButton>
      </SubBar>

      {/* Create / Edit form */}
      {(showCreate || editingId) && (
        <Card className="mb-4">
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3">
            {editingId ? 'Edit brand' : 'New brand'}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
                Name <span className="text-[var(--color-danger)]">*</span>
              </label>
              <input
                type="text"
                value={formName}
                onChange={e => setFormName(e.target.value)}
                placeholder="Brand name"
                className="tahi-focus-ring min-h-[2.75rem] md:min-h-[2.375rem] w-full text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)]"
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: 'var(--radius-input)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg)',
                  minHeight: '2.375rem',
                }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Logo URL</label>
              <input
                type="url"
                value={formLogoUrl}
                onChange={e => setFormLogoUrl(e.target.value)}
                placeholder="https://..."
                className="tahi-focus-ring min-h-[2.75rem] md:min-h-[2.375rem] w-full text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)]"
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: 'var(--radius-input)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg)',
                  minHeight: '2.375rem',
                }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Website</label>
              <input
                type="url"
                value={formWebsite}
                onChange={e => setFormWebsite(e.target.value)}
                placeholder="https://example.com"
                className="tahi-focus-ring min-h-[2.75rem] md:min-h-[2.375rem] w-full text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)]"
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: 'var(--radius-input)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg)',
                  minHeight: '2.375rem',
                }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Primary Colour</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={formColour}
                  onChange={e => setFormColour(e.target.value)}
                  style={{
                    width: '2.375rem',
                    height: '2.375rem',
                    padding: '0.125rem',
                    borderRadius: 'var(--radius-input)',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg)',
                    cursor: 'pointer',
                  }}
                />
                <input
                  type="text"
                  value={formColour}
                  onChange={e => setFormColour(e.target.value)}
                  placeholder="#5A824E"
                  className="tahi-focus-ring min-h-[2.75rem] md:min-h-[2.375rem] flex-1 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)]"
                  style={{
                    padding: '0.5rem 0.75rem',
                    borderRadius: 'var(--radius-input)',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg)',
                    minHeight: '2.375rem',
                  }}
                />
              </div>
            </div>
          </div>

          {formError && (
            <p className="text-xs mt-2" style={{ color: 'var(--color-danger)' }}>{formError}</p>
          )}

          <div className="flex items-center gap-2 mt-4">
            <TahiButton size="sm" onClick={handleSave} disabled={formSaving}>
              {formSaving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
              ) : (
                <Check className="w-3.5 h-3.5 mr-1" />
              )}
              {editingId ? 'Save Changes' : 'Create Brand'}
            </TahiButton>
            <TahiButton variant="secondary" size="sm" onClick={resetForm}>
              Cancel
            </TahiButton>
          </div>
        </Card>
      )}

      {brands.length === 0 && !showCreate ? (
        <EmptyState
          variant="inline"
          icon={<Palette className="w-8 h-8" />}
          title="No brands for this client yet"
          description="Add brands to organise requests by sub-brand or product line."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {brands.map(brand => (
            <Card key={brand.id} padding="sm">
              {/* Logo + name row */}
              <div className="flex items-start gap-3 mb-3">
                {brand.logoUrl && !brokenLogos.has(brand.id) ? (
                  // A remote logo that 404s must fall back to the swatch, not
                  // leave a hole: hiding the <img> alone left an empty tile.
                  <img
                    src={brand.logoUrl}
                    alt={`${brand.name} logo`}
                    className="flex-shrink-0 rounded-lg object-contain"
                    style={{ width: '2.5rem', height: '2.5rem', border: '1px solid var(--color-border-subtle)' }}
                    onError={() => setBrokenLogos(prev => new Set(prev).add(brand.id))}
                  />
                ) : (
                  <div
                    className="flex-shrink-0 flex items-center justify-center rounded-lg"
                    style={{
                      width: '2.5rem',
                      height: '2.5rem',
                      background: brand.primaryColour ? `${brand.primaryColour}18` : 'var(--color-bg-tertiary)',
                      color: brand.primaryColour ?? 'var(--color-text-muted)',
                    }}
                  >
                    <Palette className="w-4 h-4" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[var(--color-text)] truncate">{brand.name}</p>
                  {brand.website && (
                    <a
                      href={brand.website.startsWith('http') ? brand.website : `https://${brand.website}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-brand)] truncate block"
                    >
                      {brand.website.replace(/^https?:\/\//, '')}
                    </a>
                  )}
                </div>
              </div>

              {/* Colour swatch */}
              {brand.primaryColour && (
                <div className="flex items-center gap-2 mb-3">
                  <div
                    className="rounded-full"
                    style={{
                      width: '1rem',
                      height: '1rem',
                      background: brand.primaryColour,
                      border: '1px solid var(--color-border-subtle)',
                    }}
                  />
                  <span className="text-xs text-[var(--color-text-muted)]">{brand.primaryColour}</span>
                </div>
              )}

              {/* Stats row */}
              <div className="flex items-center gap-3 text-xs text-[var(--color-text-subtle)] mb-3">
                <span>{brand.requestCount} request{brand.requestCount !== 1 ? 's' : ''}</span>
                <span>{brand.contactCount} contact{brand.contactCount !== 1 ? 's' : ''}</span>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openEdit(brand)}
                  className="tahi-focus-ring inline-flex items-center gap-1 min-h-[2.75rem] md:min-h-[1.5rem] text-xs font-medium text-[var(--color-brand)] hover:text-[var(--color-brand-dark)] transition-colors"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem 0' }}
                >
                  <Pencil className="w-3 h-3" />
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(brand.id)}
                  disabled={deletingId === brand.id}
                  className="tahi-focus-ring inline-flex items-center gap-1 min-h-[2.75rem] md:min-h-[1.5rem] text-xs font-medium transition-colors"
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: deletingId === brand.id ? 'not-allowed' : 'pointer',
                    padding: '0.25rem 0',
                    color: 'var(--color-text-subtle)',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-danger)' }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-subtle)' }}
                >
                  {deletingId === brand.id ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Trash2 className="w-3 h-3" />
                  )}
                  Delete
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
