'use client'

/*
 * BrandsSection - Client portal > Brands
 *
 * Design source: the `function Brands(){...}` block in settings-app.jsx renders
 * a client's brand assets (logos, colours, fonts, guidelines) as a managed
 * add / edit / delete list, each row showing a name, a format / detail line and
 * a "Linked" chip.
 *
 * Backend reality today: each client org has brand record(s) in the `brands`
 * table carrying a SINGLE logo URL and a SINGLE primary colour (plus website /
 * notes). There is no storage yet for multiple logos, full colour palettes,
 * typeface files or guideline PDFs - those need R2 uploads and a brand_assets
 * schema (a later gap, called out in the note below).
 *
 * So the list is seeded from the real brand record(s) returned for the signed-in
 * client. Add / edit / delete operate on the in-session list only (there is no
 * per-asset persistence endpoint yet); the note makes that explicit.
 */

import { useState } from 'react'
import { Palette, Plus } from 'lucide-react'
import { useResource } from '@/lib/use-resource'
import {
  SectionShell,
  useManaged,
  EditDialog,
  RowActions,
  EmptyRow,
} from '@/components/tahi/settings/primitives'

const TITLE = 'Brands'
const LEDE =
  'Your logos, colours, fonts and guidelines - so the studio always uses the right assets.'

interface PortalBrand {
  id: string
  name: string
  logoUrl: string | null
  website: string | null
  primaryColour: string | null
  notes: string | null
}

interface BrandsResponse {
  items: PortalBrand[]
}

interface AssetRow extends Record<string, unknown> {
  name: string
  type: string
  url: string
  colour: string
  meta: string
}

// Expand each real brand record into the asset rows we can honestly show today
// (logo, primary colour, website). Prefix with the brand name when the org has
// more than one brand so rows stay unambiguous.
function seedAssets(brands: PortalBrand[]): AssetRow[] {
  const many = brands.length > 1
  const rows: AssetRow[] = []
  for (const b of brands) {
    const prefix = many ? b.name + ' - ' : ''
    if (b.logoUrl) {
      rows.push({
        name: prefix + 'Primary logo',
        type: 'Logo image',
        url: b.logoUrl,
        colour: '',
        meta: 'Linked',
      })
    }
    if (b.primaryColour) {
      rows.push({
        name: prefix + 'Brand colour',
        type: b.primaryColour.toUpperCase(),
        url: '',
        colour: b.primaryColour,
        meta: 'Linked',
      })
    }
    if (b.website) {
      rows.push({
        name: prefix + 'Website',
        type: b.website,
        url: b.website,
        colour: '',
        meta: 'Linked',
      })
    }
  }
  return rows
}

function LoadingShell() {
  return (
    <SectionShell title={TITLE} lede={LEDE}>
      <div className="set-card lrow-wrap">
        <div className="lrow" style={{ color: 'var(--text-faint)', font: '500 13px Manrope' }}>
          Loading brand assets...
        </div>
      </div>
    </SectionShell>
  )
}

export function BrandsSection({ isAdmin: _isAdmin }: { isAdmin?: boolean } = {}) {
  const { data, error, isLoading } = useResource<BrandsResponse>('/api/portal/brands')

  if (isLoading && !data) return <LoadingShell />

  if (error) {
    return (
      <SectionShell title={TITLE} lede={LEDE}>
        <div className="set-card lrow-wrap">
          <EmptyRow text="Could not load your brand assets. Try again shortly." />
        </div>
      </SectionShell>
    )
  }

  const brands = data?.items ?? []
  return <BrandsList key={brands.map((b) => b.id).join(',')} seed={seedAssets(brands)} />
}

function BrandsList({ seed }: { seed: AssetRow[] }) {
  const L = useManaged<AssetRow>(seed)
  const [ed, setEd] = useState<string | null>(null)

  const editingRow = ed ? L.rows.find((r) => r._id === ed) ?? null : null

  return (
    <SectionShell
      title={TITLE}
      lede={LEDE}
      action={
        <button
          type="button"
          className="btn1"
          onClick={() => {
            const id = L.add({ name: 'New asset', type: 'Link', url: '', colour: '', meta: 'Linked' })
            setEd(id)
          }}
        >
          <Plus size={15} />
          Add asset
        </button>
      }
    >
      <div className="set-card lrow-wrap">
        {L.rows.map((r, i) => (
          <div
            key={r._id}
            className={'lrow' + (r._new ? ' lrow-enter' : '')}
            style={i ? { borderTop: '1px solid var(--border-subtle)' } : undefined}
          >
            {r.colour ? (
              <span
                className="lrow-ic"
                aria-hidden="true"
                style={{
                  background: r.colour,
                  boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.12)',
                }}
              />
            ) : (
              <span className="lrow-ic leaf">
                <Palette size={16} />
              </span>
            )}
            <div className="lrow-t">
              <b>{r.name}</b>
              <small style={r.url ? { fontFamily: 'ui-monospace, monospace', fontSize: 12 } : undefined}>
                {r.url || r.type}
              </small>
            </div>
            <div className="lrow-r">
              <span className="chip neutral">{r.meta || 'Linked'}</span>
              <RowActions onEdit={() => setEd(r._id)} onDelete={() => L.remove(r._id)} />
            </div>
          </div>
        ))}
        {!L.rows.length && <EmptyRow text="No brand assets yet." />}
      </div>

      <p className="set-lede" style={{ marginTop: 12, marginBottom: 0 }}>
        Logos, colours and links come straight from your brand record. Uploaded
        typefaces, full colour palettes and guideline files are coming soon - they
        need file storage, so edits here are not saved yet.
      </p>

      {editingRow && (
        <EditDialog
          heading="Edit brand asset"
          row={editingRow}
          fields={[
            { key: 'name', label: 'Asset name' },
            { key: 'type', label: 'Format / detail' },
            { key: 'url', label: 'Link (Figma / Drive / Notion)', ph: 'https://' },
          ]}
          onSave={(v) => {
            L.patch(ed as string, v)
            setEd(null)
          }}
          onClose={() => setEd(null)}
        />
      )}
    </SectionShell>
  )
}
