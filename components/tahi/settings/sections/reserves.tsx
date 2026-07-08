'use client'

/**
 * ReservesSection - cash reserve pots that ringfence money so the
 * disposable-cash math on /financial-reports stays honest. Each pot has a
 * category (tax / buffer / deposits / other), an optional accrual rate the
 * daily cron uses to auto-top-up, and an accrued balance.
 *
 * Data is real: it reads /api/admin/reserves (GET) and writes through POST
 * (create) and PATCH /[id] (edit). New pots are created with sensible
 * defaults, then opened straight into the edit dialog (same flow as the
 * task-templates and kanban sections); the fresh row gets the design's
 * lrow-enter entrance. Removal is a soft-deactivate (PATCH active: false) so
 * historical accrual records survive; the GET already filters to active pots.
 *
 * accrualRate is stored as a fraction (0.28 = 28%). The edit dialog reads and
 * writes it as a percent string. The accrued balance is driven by the cron and
 * shown read-only, matching the design mock.
 *
 * Admin-only. Rendered inside the settings shell which already gates on admin.
 */

import { useState } from 'react'
import { Coins, Plus } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import {
  SectionShell,
  EditDialog,
  RowActions,
  EmptyRow,
  useToasts,
  Toasts,
} from '@/components/tahi/settings/primitives'

interface Reserve {
  id: string
  name: string
  category: string
  currency: string
  targetAmount: number | null
  accruedAmount: number
  accrualRate: number | null
  notes: string | null
}

interface ReservesResponse {
  reserves?: Reserve[]
  items?: Reserve[]
}

// category <-> label (schema values are the source of truth)
const CAT_TO_LABEL: Record<string, string> = {
  tax: 'Tax',
  buffer: 'Buffer',
  deposits: 'Deposits',
  other: 'Other',
}
const CAT_OPTS = ['Tax', 'Buffer', 'Deposits', 'Other']
function labelToCat(label: string): string {
  const hit = Object.entries(CAT_TO_LABEL).find(([, l]) => l === label)
  return hit ? hit[0] : 'other'
}

const CURRENCY_PREFIX: Record<string, string> = {
  NZD: 'NZ$',
  USD: 'US$',
  AUD: 'A$',
  GBP: '£',
  EUR: '€',
}

function formatAmount(amount: number, currency: string): string {
  const prefix = CURRENCY_PREFIX[currency] ?? currency + ' '
  const n = new Intl.NumberFormat('en-NZ', { maximumFractionDigits: 0 }).format(
    Math.round(amount),
  )
  return prefix + n
}

// fraction (0.28) -> display string ("28%"); null -> plain hyphen
function rateToLabel(rate: number | null): string {
  if (rate == null) return '-'
  return Math.round(rate * 1000) / 10 + '%'
}

// percent string ("28%" | "28" | "") -> fraction or null
function labelToRate(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.]/g, '').trim()
  if (!cleaned) return null
  const pct = Number.parseFloat(cleaned)
  if (Number.isNaN(pct)) return null
  return pct / 100
}

function SkeletonRow({ divider }: { divider?: boolean }) {
  return (
    <div
      className="lrow"
      aria-hidden="true"
      style={divider ? { borderTop: '1px solid var(--border-subtle)' } : undefined}
    >
      <span
        className="animate-pulse"
        style={{ width: 34, height: 34, background: 'var(--bg-secondary)', borderRadius: '0 10px 0 10px', flexShrink: 0 }}
      />
      <div className="lrow-t" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="animate-pulse" style={{ display: 'block', width: 120, height: 13, background: 'var(--bg-secondary)', borderRadius: 6 }} />
        <span className="animate-pulse" style={{ display: 'block', width: 170, height: 11, background: 'var(--bg-secondary)', borderRadius: 6 }} />
      </div>
      <div className="lrow-r">
        <span className="animate-pulse" style={{ display: 'block', width: 72, height: 14, background: 'var(--bg-secondary)', borderRadius: 6 }} />
      </div>
    </div>
  )
}

export function ReservesSection(_props: { isAdmin?: boolean } = {}) {
  const [editId, setEditId] = useState<string | null>(null)
  const [newId, setNewId] = useState<string | null>(null) // drives lrow-enter
  const [busy, setBusy] = useState(false)
  const { toasts, toast } = useToasts()

  const { data, isLoading, mutate } = useResource<ReservesResponse>('/api/admin/reserves')
  const rows = data?.reserves ?? data?.items ?? []

  async function createReserve() {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(apiPath('/api/admin/reserves'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New pot',
          category: 'other',
          currency: 'NZD',
          accruedAmount: 0,
          accrualRate: null,
        }),
      })
      if (!res.ok) throw new Error('Failed to create reserve')
      const json = (await res.json()) as { id: string }
      await mutate()
      setNewId(json.id)
      setEditId(json.id)
    } catch {
      toast('Could not create the pot', 'err')
      await mutate()
    } finally {
      setBusy(false)
    }
  }

  async function saveReserve(id: string, values: Record<string, string>) {
    const name = values.name?.trim()
    try {
      const res = await fetch(apiPath(`/api/admin/reserves/${id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name || 'Untitled pot',
          category: labelToCat(values.category ?? ''),
          accrualRate: labelToRate(values.rate ?? ''),
        }),
      })
      if (!res.ok) throw new Error('Failed to save reserve')
      setEditId(null)
      await mutate()
    } catch {
      // Keep the dialog open so nothing typed is lost.
      toast('Could not save the pot. Please try again.', 'err')
    }
  }

  // Soft-deactivate: the pot drops out of the disposable-cash math but its
  // accrual history survives (the GET only returns active pots).
  async function removeReserve(id: string) {
    try {
      const res = await fetch(apiPath(`/api/admin/reserves/${id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: false }),
      })
      if (!res.ok) throw new Error('Failed to remove reserve')
    } catch {
      toast('Could not remove the pot', 'err')
    } finally {
      await mutate()
    }
  }

  const editing = editId ? rows.find(r => r.id === editId) : null
  const editRow = editing
    ? {
        name: editing.name,
        category: CAT_TO_LABEL[editing.category] ?? 'Other',
        rate: editing.accrualRate == null ? '' : rateToLabel(editing.accrualRate),
      }
    : null

  return (
    <SectionShell
      title="Reserves"
      lede="Cash reserve pots that drive the disposable-cash math."
      action={
        <button type="button" className="btn1" onClick={createReserve} disabled={busy}>
          <Plus size={15} />
          New pot
        </button>
      }
    >
      <div className="set-card lrow-wrap">
        {isLoading ? (
          <>
            <SkeletonRow />
            <SkeletonRow divider />
            <SkeletonRow divider />
          </>
        ) : rows.length === 0 ? (
          <EmptyRow text="No reserve pots yet. Add one to start ringfencing cash." />
        ) : (
          rows.map((r, i) => (
            <div
              key={r.id}
              className={'lrow' + (r.id === newId ? ' lrow-enter' : '')}
              style={i ? { borderTop: '1px solid var(--border-subtle)' } : undefined}
            >
              <span className="lrow-ic leaf">
                <Coins size={16} />
              </span>
              <div className="lrow-t">
                <b>{r.name}</b>
                <small>
                  {CAT_TO_LABEL[r.category] ?? r.category} · accrual {rateToLabel(r.accrualRate)}
                </small>
              </div>
              <div className="lrow-r">
                {/* data-private: blurs under Private view, same convention as <Money sensitive> */}
                <b data-private style={{ font: '600 14px Manrope', color: 'var(--text)' }}>
                  {formatAmount(r.accruedAmount, r.currency)}
                </b>
                <RowActions
                  onEdit={() => setEditId(r.id)}
                  onDelete={() => removeReserve(r.id)}
                />
              </div>
            </div>
          ))
        )}
      </div>

      {editId && editRow && (
        <EditDialog
          heading="Edit reserve pot"
          row={editRow}
          fields={[
            { key: 'name', label: 'Pot name' },
            { key: 'category', label: 'Category', type: 'select', opts: CAT_OPTS },
            {
              key: 'rate',
              label: 'Accrual rate',
              ph: 'e.g. 28%',
              help: 'The daily cron adds this share of revenue to the pot. Leave blank for a fully manual pot.',
            },
          ]}
          onSave={v => saveReserve(editId, v)}
          onClose={() => setEditId(null)}
        />
      )}
      <Toasts toasts={toasts} />
    </SectionShell>
  )
}
