'use client'

/**
 * <BrandsCard>. The org.brands JSON column, edited as chips. The brands
 * table itself lives on the People tab; this card is the legacy free-text
 * list kept alongside it.
 */

import { useState } from 'react'
import { Tag } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { Badge } from '@/components/tahi/badge'
import { Card } from '@/components/tahi/card'
import { TahiButton } from '@/components/tahi/tahi-button'
import type { Organisation } from './types'

// ── Brands card ────────────────────────────────────────────────────────────────

export function BrandsCard({ org, onUpdated }: { org: Organisation; onUpdated: () => void }) {
  const [brands, setBrands] = useState<string[]>(() => {
    try {
      return JSON.parse(org.brands ?? '[]') as string[]
    } catch {
      return []
    }
  })
  const [newBrand, setNewBrand] = useState('')
  const [saving, setSaving] = useState(false)

  const saveBrands = async (updated: string[]) => {
    setSaving(true)
    try {
      await fetch(apiPath(`/api/admin/clients/${org.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brands: JSON.stringify(updated) }),
      })
      setBrands(updated)
      onUpdated()
    } finally {
      setSaving(false)
    }
  }

  const addBrand = () => {
    const name = newBrand.trim()
    if (!name || brands.includes(name)) return
    const updated = [...brands, name]
    setNewBrand('')
    saveBrands(updated)
  }

  const removeBrand = (name: string) => {
    saveBrands(brands.filter(b => b !== name))
  }

  return (
    <Card>
      <Card.Header style={{ marginBottom: 'var(--space-3)' }}>
        <div className="flex items-center gap-2">
          <Tag className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
          <Card.Title style={{ fontSize: 'var(--text-sm)' }}>Brands</Card.Title>
        </div>
      </Card.Header>

      {brands.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {brands.map(b => (
            <Badge key={b} tone="brand" onRemove={saving ? undefined : () => removeBrand(b)}>
              {b}
            </Badge>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          value={newBrand}
          onChange={e => setNewBrand(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addBrand() }}
          placeholder="Add brand name..."
          className="flex-1 text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)]"
          style={{
            padding: '0.375rem 0.5rem',
            borderRadius: 'var(--radius-input)',
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg)',
            minHeight: '2rem',
          }}
        />
        <TahiButton
          variant="primary"
          size="sm"
          onClick={addBrand}
          disabled={!newBrand.trim() || saving}
          loading={saving}
        >
          Add
        </TahiButton>
      </div>
    </Card>
  )
}
