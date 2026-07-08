'use client'

/*
 * BrandsSection - Client portal > Brand
 *
 * Each row is one real brand record from the `brands` table for the signed-in
 * client's org (name, primary colour, website, notes, single logo URL). Add /
 * edit / delete persist through /api/portal/brands, scoped to the caller's own
 * org. Workspace admins (contacts.portalRole === 'admin') can manage; members
 * get a read-only view.
 *
 * Not yet stored: multiple logos, full colour palettes, uploaded typefaces and
 * guideline PDFs - those need R2 storage + a brand_assets table (called out in
 * the note below).
 */

import { useState } from 'react'
import { Palette, Plus } from 'lucide-react'
import { useResource } from '@/lib/use-resource'
import { apiPath } from '@/lib/api'
import {
  SectionShell,
  EditDialog,
  RowActions,
  EmptyRow,
} from '@/components/tahi/settings/primitives'

const TITLE = 'Brand'
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

interface EditState {
  id: string | null // null = creating a new brand
  name: string
  primaryColour: string
  website: string
  notes: string
}

export function BrandsSection({ isClientAdmin }: { isAdmin?: boolean; isClientAdmin?: boolean } = {}) {
  const { data, error, isLoading, mutate } = useResource<BrandsResponse>('/api/portal/brands')
  const [ed, setEd] = useState<EditState | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  const canManage = !!isClientAdmin

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

  function flash(msg: string) {
    setNote(msg)
    window.setTimeout(() => setNote(''), 4600)
  }

  function startAdd() {
    setEd({ id: null, name: '', primaryColour: '#5A824E', website: '', notes: '' })
  }

  function startEdit(b: PortalBrand) {
    setEd({
      id: b.id,
      name: b.name,
      primaryColour: b.primaryColour ?? '#5A824E',
      website: b.website ?? '',
      notes: b.notes ?? '',
    })
  }

  async function saveEdit(values: Record<string, string>) {
    if (!ed) return
    const name = (values.name ?? '').trim()
    if (!name) {
      flash('Brand name is required.')
      return
    }
    setBusy(true)
    try {
      const isNew = ed.id === null
      const res = await fetch(apiPath('/api/portal/brands'), {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(isNew ? {} : { id: ed.id }),
          name,
          primaryColour: values.primaryColour ?? '',
          website: values.website ?? '',
          notes: values.notes ?? '',
        }),
      })
      if (res.ok) {
        setEd(null)
        await mutate()
      } else if (res.status === 403) {
        flash('Only workspace admins can manage brands.')
      } else {
        flash('Could not save this brand. Please try again shortly.')
      }
    } catch {
      flash('Could not save this brand. Please try again shortly.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    setBusy(true)
    try {
      const res = await fetch(apiPath('/api/portal/brands?id=' + encodeURIComponent(id)), {
        method: 'DELETE',
      })
      if (res.ok) {
        await mutate()
      } else if (res.status === 403) {
        flash('Only workspace admins can manage brands.')
      } else {
        flash('Could not remove this brand. Please try again shortly.')
      }
    } catch {
      flash('Could not remove this brand. Please try again shortly.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SectionShell
      title={TITLE}
      lede={LEDE}
      action={
        canManage ? (
          <button type="button" className="btn1" onClick={startAdd} disabled={busy}>
            <Plus size={15} />
            Add brand
          </button>
        ) : undefined
      }
    >
      <div className="set-card lrow-wrap">
        {brands.map((b, i) => (
          <div
            key={b.id}
            className="lrow"
            style={i ? { borderTop: '1px solid var(--border-subtle)' } : undefined}
          >
            {b.primaryColour ? (
              <span
                className="lrow-ic"
                aria-hidden="true"
                style={{ background: b.primaryColour, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.12)' }}
              />
            ) : (
              <span className="lrow-ic leaf">
                <Palette size={16} />
              </span>
            )}
            <div className="lrow-t">
              <b>{b.name}</b>
              <small style={b.website ? { fontFamily: 'ui-monospace, monospace', fontSize: 12 } : undefined}>
                {b.website || (b.primaryColour ? b.primaryColour.toUpperCase() : 'No colour set')}
              </small>
            </div>
            {canManage && (
              <div className="lrow-r">
                <RowActions onEdit={() => startEdit(b)} onDelete={() => remove(b.id)} />
              </div>
            )}
          </div>
        ))}
        {!brands.length && <EmptyRow text="No brands yet." />}
      </div>

      <p className="set-lede" style={{ marginTop: 12, marginBottom: 0 }}>
        {canManage
          ? 'Uploaded typefaces, full colour palettes and guideline files are coming soon - they need file storage.'
          : 'Only workspace admins can add or edit brands. Ask your Tahi contact if something needs changing.'}
      </p>

      {note && <div className="plan-note">{note}</div>}

      {ed && (
        <EditDialog
          heading={ed.id === null ? 'Add brand' : 'Edit brand'}
          row={{
            name: ed.name,
            primaryColour: ed.primaryColour,
            website: ed.website,
            notes: ed.notes,
          }}
          fields={[
            { key: 'name', label: 'Brand name' },
            { key: 'primaryColour', label: 'Primary colour', type: 'color' },
            { key: 'website', label: 'Website', ph: 'https://' },
            { key: 'notes', label: 'Notes', type: 'textarea' },
          ]}
          onSave={saveEdit}
          onClose={() => (busy ? undefined : setEd(null))}
        />
      )}
    </SectionShell>
  )
}
