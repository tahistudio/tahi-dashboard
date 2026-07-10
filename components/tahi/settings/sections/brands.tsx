'use client'

/*
 * BrandsSection - Client portal > Brand.
 *
 * The design's brand-asset list: each row is a titled asset link (name +
 * format line + Linked chip) backed by a real row in the `brands` table for
 * the signed-in client's org (name -> asset name, notes -> format / detail,
 * website -> the link, primaryColour kept as an optional extra). Add / edit /
 * delete persist through /api/portal/brands, scoped to the caller's own org.
 * Workspace admins (contacts.portalRole === 'admin') manage; members read.
 *
 * Add asset follows the design flow: the row is created immediately (with the
 * lrow-enter animation) and the editor opens on it.
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
  Chip,
  Toasts,
  useToasts,
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

function LoadingShell() {
  return (
    <SectionShell title={TITLE} lede={LEDE}>
      <div className="set-card lrow-wrap">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="lrow animate-pulse"
            style={i ? { borderTop: '1px solid var(--border-subtle)' } : undefined}
            aria-hidden="true"
          >
            <span className="lrow-ic" />
            <div className="lrow-t">
              <span
                style={{ display: 'block', width: 120, height: 13, background: 'var(--bg-secondary)', borderRadius: 6 }}
              />
              <span
                style={{ display: 'block', width: 90, height: 11, marginTop: 5, background: 'var(--bg-secondary)', borderRadius: 6 }}
              />
            </div>
          </div>
        ))}
      </div>
    </SectionShell>
  )
}

export function BrandsSection({ isClientAdmin }: { isAdmin?: boolean; isClientAdmin?: boolean } = {}) {
  const { data, error, isLoading, mutate } = useResource<BrandsResponse>('/api/portal/brands')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [newId, setNewId] = useState<string | null>(null)
  const { toasts, toast } = useToasts()

  const canManage = !!isClientAdmin
  const brands = data?.items ?? []
  const editing = editingId ? brands.find((b) => b.id === editingId) : null

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

  // Design flow: Add asset inserts the row first (lrow-enter), then opens the
  // editor on it.
  async function addAsset() {
    setBusy(true)
    try {
      const res = await fetch(apiPath('/api/portal/brands'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New asset', notes: 'Link' }),
      })
      if (res.ok) {
        const created = (await res.json().catch(() => null)) as { id?: string } | null
        await mutate()
        if (created?.id) {
          setNewId(created.id)
          window.setTimeout(() => setNewId(null), 1400)
          setEditingId(created.id)
        }
      } else if (res.status === 403) {
        toast('Only workspace admins can manage brand assets.', 'err')
      } else {
        toast('Could not add the asset. Please try again shortly.', 'err')
      }
    } catch {
      toast('Could not add the asset. Please try again shortly.', 'err')
    } finally {
      setBusy(false)
    }
  }

  async function saveEdit(values: Record<string, string>) {
    if (!editing) return
    const name = (values.name ?? '').trim()
    if (!name) {
      toast('Asset name is required.', 'err')
      return
    }
    setBusy(true)
    try {
      const res = await fetch(apiPath('/api/portal/brands'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editing.id,
          name,
          notes: values.format ?? '',
          website: values.url ?? '',
          primaryColour: values.primaryColour ?? '',
        }),
      })
      if (res.ok) {
        setEditingId(null)
        await mutate()
        toast('Asset saved.')
      } else if (res.status === 403) {
        toast('Only workspace admins can manage brand assets.', 'err')
      } else {
        toast('Could not save this asset. Please try again shortly.', 'err')
      }
    } catch {
      toast('Could not save this asset. Please try again shortly.', 'err')
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
        toast('Asset removed.')
      } else if (res.status === 403) {
        toast('Only workspace admins can manage brand assets.', 'err')
      } else {
        toast('Could not remove this asset. Please try again shortly.', 'err')
      }
    } catch {
      toast('Could not remove this asset. Please try again shortly.', 'err')
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
          <button type="button" className="btn1" onClick={addAsset} disabled={busy}>
            <Plus size={15} />
            Add asset
          </button>
        ) : undefined
      }
    >
      <div className="set-card lrow-wrap">
        {brands.map((b, i) => (
          <div
            key={b.id}
            className={'lrow' + (b.id === newId ? ' lrow-enter' : '')}
            style={i ? { borderTop: '1px solid var(--border-subtle)' } : undefined}
          >
            <span className="lrow-ic leaf">
              <Palette size={16} />
            </span>
            <div className="lrow-t">
              <b>{b.name}</b>
              <small>
                {b.notes || (b.primaryColour ? b.primaryColour.toUpperCase() : 'Link')}
              </small>
            </div>
            <div className="lrow-r">
              {b.website ? (
                <a
                  className="chip neutral"
                  href={b.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={'Open ' + b.name}
                >
                  Linked
                </a>
              ) : (
                <Chip tone="outline">No link</Chip>
              )}
              {canManage && (
                <RowActions onEdit={() => setEditingId(b.id)} onDelete={() => remove(b.id)} />
              )}
            </div>
          </div>
        ))}
        {!brands.length && <EmptyRow text="No brand assets yet." />}
      </div>

      {!canManage && (
        <p className="set-lede" style={{ marginTop: 12, marginBottom: 0 }}>
          Only workspace admins can add or edit brand assets. Ask your Tahi contact if something
          needs changing.
        </p>
      )}

      {editing && (
        <EditDialog
          heading="Edit brand asset"
          row={{
            name: editing.name,
            format: editing.notes ?? '',
            url: editing.website ?? '',
            primaryColour: editing.primaryColour ?? '',
          }}
          fields={[
            { key: 'name', label: 'Asset name' },
            { key: 'format', label: 'Format / detail', ph: 'e.g. SVG + PNG' },
            { key: 'url', label: 'Link (Figma / Drive / Notion)', ph: 'https://' },
            { key: 'primaryColour', label: 'Primary colour', type: 'color' },
          ]}
          onSave={saveEdit}
          onClose={() => (busy ? undefined : setEditingId(null))}
        />
      )}

      <Toasts toasts={toasts} />
    </SectionShell>
  )
}
