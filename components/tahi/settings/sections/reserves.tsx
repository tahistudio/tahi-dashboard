'use client'

/**
 * ReservesSection - cash reserve pots that ringfence money so the
 * disposable-cash math on /financial-reports stays honest. Each pot has a
 * category (tax / buffer / deposits / other), an optional accrual rate the
 * daily cron uses to auto-top-up, and an accrued balance.
 *
 * Data is real: it reads /api/admin/reserves (GET) and writes through POST
 * (create), PATCH /[id] (edit) and DELETE /[id]. New pots are created with
 * sensible defaults, then opened straight into the edit dialog (same flow as
 * the task-templates and kanban sections).
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

// fraction (0.28) -> display string ("28%"); null -> em-free dash
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

export function ReservesSection(_props: { isAdmin?: boolean } = {}) {
  const [editId, setEditId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
      setEditId(json.id)
    } catch {
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
    } finally {
      setEditId(null)
      await mutate()
    }
  }

  async function deleteReserve(id: string) {
    try {
      const res = await fetch(apiPath(`/api/admin/reserves/${id}`), {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to delete reserve')
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
          <EmptyRow text="Loading reserves..." />
        ) : rows.length === 0 ? (
          <EmptyRow text="No reserve pots yet." />
        ) : (
          rows.map((r, i) => (
            <div
              key={r.id}
              className="lrow"
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
                <b style={{ font: '600 14px Manrope', color: 'var(--text)' }}>
                  {formatAmount(r.accruedAmount, r.currency)}
                </b>
                <RowActions
                  onEdit={() => setEditId(r.id)}
                  onDelete={() => deleteReserve(r.id)}
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
    </SectionShell>
  )
}
