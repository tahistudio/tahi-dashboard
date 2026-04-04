'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, Globe, Palette } from 'lucide-react'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'
import { apiPath } from '@/lib/api'

interface Brand {
  id: string
  name: string
  orgId: string
  logoUrl: string | null
  website: string | null
  primaryColour: string | null
  notes: string | null
}

export function BrandDetail({ brandId }: { brandId: string }) {
  const [brand, setBrand] = useState<Brand | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchBrand = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiPath(`/api/admin/brands/${brandId}`))
      if (!res.ok) throw new Error('Failed')
      const data = await res.json() as { brand: Brand }
      setBrand(data.brand ?? null)
    } catch { setBrand(null) }
    finally { setLoading(false) }
  }, [brandId])

  useEffect(() => { fetchBrand() }, [fetchBrand])

  if (loading) return <div className="p-6"><LoadingSkeleton rows={6} /></div>
  if (!brand) return <div className="p-6 text-center text-[var(--color-text-muted)]">Brand not found</div>

  return (
    <div className="max-w-3xl mx-auto p-6">
      <Link href="/clients" className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-brand)] mb-4 cursor-pointer">
        <ArrowLeft style={{ width: '0.875rem', height: '0.875rem' }} /> Back to Clients
      </Link>

      <div className="flex items-center gap-4 mb-6">
        {brand.primaryColour && (
          <div className="flex-shrink-0 rounded-xl" style={{ width: '3rem', height: '3rem', background: brand.primaryColour }} />
        )}
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text)]">{brand.name}</h1>
          <div className="flex items-center gap-3 mt-1">
            {brand.website && (
              <a href={brand.website} target="_blank" rel="noopener" className="flex items-center gap-1 text-xs text-[var(--color-brand)] hover:underline cursor-pointer">
                <Globe style={{ width: '0.625rem', height: '0.625rem' }} /> {brand.website}
              </a>
            )}
            {brand.primaryColour && (
              <span className="flex items-center gap-1 text-xs text-[var(--color-text-subtle)]">
                <Palette style={{ width: '0.625rem', height: '0.625rem' }} /> {brand.primaryColour}
              </span>
            )}
          </div>
        </div>
      </div>

      {brand.notes && (
        <div className="border border-[var(--color-border)] rounded-xl bg-[var(--color-bg)] p-4 mb-6">
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-2">Notes</h3>
          <p className="text-sm text-[var(--color-text-muted)] whitespace-pre-wrap">{brand.notes}</p>
        </div>
      )}
    </div>
  )
}
