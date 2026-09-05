'use client'

/** The client Profitability tab: gross margin for this client (revenue minus
 *  billable time at the default hourly rate plus logged client costs), with a
 *  form to add cost entries. */

import { useState } from 'react'
import useSWR from 'swr'
import { DollarSign, Plus, Trash2 } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { Badge } from '@/components/tahi/badge'
import { Card } from '@/components/tahi/card'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { EmptyState } from '@/components/tahi/empty-state'
import { SkeletonList } from '@/components/tahi/skeletons'
import { TahiButton } from '@/components/tahi/tahi-button'
import { useToast } from '@/components/tahi/toast'

// ── Profitability tab (T595) ─────────────────────────────────────────────────
// Shows gross margin for this client (revenue minus costs including
// billable time × default hourly rate + logged client_costs). Includes a
// form to add cost entries.

export interface ProfitabilityData {
  orgId: string
  orgName: string
  hourlyRateNzd: number
  revenueNzd: number
  costNzd: number
  marginNzd: number
  marginPct: number
  byCategory: Record<string, number>
  timeCost: { hours: number; rate: number; cost: number }
  byMonth: Array<{ month: string; revenue: number; cost: number; margin: number }>
}

export interface ClientCostRow {
  id: string
  description: string
  amount: number
  currency: string
  category: 'contractor' | 'software' | 'hours' | 'other'
  date: string
  recurring: boolean
}

export function ProfitabilityTab({ clientId }: { clientId: string }) {
  const { showToast } = useToast()
  // Deleting a cost changes a margin number, so it asks first, through the
  // design-system dialog rather than a browser confirm().
  const [pendingDelete, setPendingDelete] = useState<ClientCostRow | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({
    description: '',
    amount: '',
    currency: 'NZD',
    category: 'other' as ClientCostRow['category'],
    date: new Date().toISOString().slice(0, 10),
    recurring: false,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Profitability + costs load together (both must succeed) via an inline SWR
  // fetcher. `mutate` (aliased loadAll) refetches after a cost is added/removed.
  const { data: combined, isLoading: loading, mutate: loadAll } = useSWR<{ profit: ProfitabilityData; costs: ClientCostRow[] }>(
    `client-profitability:${clientId}`,
    async () => {
      const [profitRes, costsRes] = await Promise.all([
        fetch(apiPath(`/api/admin/clients/${clientId}/profitability`)).then(r => r.ok ? r.json() : Promise.reject()),
        fetch(apiPath(`/api/admin/clients/${clientId}/costs`)).then(r => r.ok ? r.json() : Promise.reject()),
      ])
      return {
        profit: profitRes as ProfitabilityData,
        costs: ((costsRes as { costs?: ClientCostRow[] }).costs) ?? [],
      }
    },
  )
  const data = combined?.profit ?? null
  const costs = combined?.costs ?? []

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const amount = parseFloat(form.amount)
    if (!form.description.trim() || !Number.isFinite(amount)) {
      setError('Description and a numeric amount are required.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(apiPath(`/api/admin/clients/${clientId}/costs`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: form.description.trim(),
          amount,
          currency: form.currency,
          category: form.category,
          date: form.date,
          recurring: form.recurring,
        }),
      })
      if (!res.ok) {
        const json = await res.json() as { error?: string }
        setError(json.error ?? 'Failed to save cost')
        return
      }
      setForm({
        description: '', amount: '', currency: form.currency, category: 'other',
        date: new Date().toISOString().slice(0, 10), recurring: false,
      })
      setShowAdd(false)
      await loadAll()
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  // ConfirmDialog has no catch of its own, so a thrown fetch here would reject
  // out of its handler while the dialog closed and the row stayed. The failure
  // is caught, reported, and leaves the dialog open so the operator can retry.
  async function handleDelete() {
    const cost = pendingDelete
    if (!cost) return
    try {
      const res = await fetch(apiPath(`/api/admin/clients/${clientId}/costs/${cost.id}`), { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json().catch(() => null) as { error?: string } | null
        showToast(json?.error ?? 'That cost was not deleted. Please try again.', 'error')
        return
      }
      showToast('Cost deleted', 'success')
      setPendingDelete(null)
      await loadAll()
    } catch {
      showToast('That cost was not deleted. Please try again.', 'error')
    }
  }

  if (loading) {
    return (
      <SkeletonList rows={4} />
    )
  }

  if (!data) {
    return (
      <Card>
        <p className="text-sm text-[var(--color-text-muted)]">Unable to load profitability data.</p>
      </Card>
    )
  }

  const nzd = (n: number) => new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD', maximumFractionDigits: 0 }).format(n)
  const marginColour = data.marginPct >= 50 ? 'var(--color-brand)'
    : data.marginPct >= 25 ? 'var(--color-warning)'
    : 'var(--color-danger)'

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card padding="sm">
          <div className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Revenue (paid)</div>
          <div className="text-xl font-bold text-[var(--color-text)] mt-1">{nzd(data.revenueNzd)}</div>
        </Card>
        <Card padding="sm">
          <div className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Total cost</div>
          <div className="text-xl font-bold text-[var(--color-text)] mt-1">{nzd(data.costNzd)}</div>
          <div className="text-xs text-[var(--color-text-subtle)] mt-0.5">
            {data.timeCost.hours.toFixed(1)}h × ${data.timeCost.rate}/h = {nzd(data.timeCost.cost)}
          </div>
        </Card>
        <Card padding="sm">
          <div className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Gross margin</div>
          <div className="text-xl font-bold mt-1" style={{ color: marginColour }}>{nzd(data.marginNzd)}</div>
        </Card>
        <Card padding="sm">
          <div className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Margin %</div>
          <div className="text-xl font-bold mt-1" style={{ color: marginColour }}>
            {data.marginPct.toFixed(1)}%
          </div>
        </Card>
      </div>

      {/* By category */}
      <Card>
        <h3 className="font-semibold text-[var(--color-text)] mb-3">Cost breakdown</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {(['contractor', 'software', 'hours', 'other', 'timeCost'] as const).map(cat => (
            <div key={cat} className="rounded-lg p-3" style={{ background: 'var(--color-bg-secondary)' }}>
              <div className="text-xs text-[var(--color-text-muted)] capitalize">{cat === 'timeCost' ? 'Time (hours × rate)' : cat}</div>
              <div className="text-sm font-semibold text-[var(--color-text)] mt-1">
                {nzd(data.byCategory[cat] ?? 0)}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Costs list + add form */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-[var(--color-text)]">Logged costs</h3>
          <TahiButton
            variant={showAdd ? 'secondary' : 'primary'}
            size="sm"
            onClick={() => setShowAdd(v => !v)}
            iconLeft={showAdd ? undefined : <Plus className="w-3.5 h-3.5" />}
          >
            {showAdd ? 'Cancel' : 'Add cost'}
          </TahiButton>
        </div>

        {showAdd && (
          <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4 p-3 rounded" style={{ background: 'var(--color-bg-secondary)' }}>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Description</label>
              <input
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="e.g. Webflow Pro plan, designer subcontract"
                className="tahi-focus-ring w-full min-h-[2.75rem] md:min-h-[2.375rem] px-3 py-2 text-sm border rounded-lg"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Amount</label>
              <input
                type="number"
                step="0.01"
                value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                className="tahi-focus-ring w-full min-h-[2.75rem] md:min-h-[2.375rem] px-3 py-2 text-sm border rounded-lg"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Currency</label>
              <select
                value={form.currency}
                onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}
                className="tahi-focus-ring w-full min-h-[2.75rem] md:min-h-[2.375rem] px-3 py-2 text-sm border rounded-lg"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
              >
                {['NZD', 'USD', 'GBP', 'EUR', 'AUD'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Category</label>
              <select
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value as ClientCostRow['category'] }))}
                className="tahi-focus-ring w-full min-h-[2.75rem] md:min-h-[2.375rem] px-3 py-2 text-sm border rounded-lg"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
              >
                <option value="contractor">Contractor</option>
                <option value="software">Software</option>
                <option value="hours">Hours (manual)</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Date</label>
              <input
                type="date"
                value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                className="tahi-focus-ring w-full min-h-[2.75rem] md:min-h-[2.375rem] px-3 py-2 text-sm border rounded-lg"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
              />
            </div>
            <div className="flex items-center gap-2 md:col-span-2">
              <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
                <input type="checkbox" checked={form.recurring} onChange={e => setForm(f => ({ ...f, recurring: e.target.checked }))} />
                Recurring monthly cost
              </label>
            </div>
            {error && <p className="text-sm md:col-span-2" style={{ color: 'var(--color-danger)' }}>{error}</p>}
            <div className="md:col-span-2 flex justify-end">
              <TahiButton type="submit" size="sm" loading={saving} disabled={saving}>
                {saving ? 'Saving...' : 'Save cost'}
              </TahiButton>
            </div>
          </form>
        )}

        {costs.length === 0 ? (
          <EmptyState
            variant="inline"
            icon={<DollarSign className="w-8 h-8" />}
            title="No costs logged yet"
            description="Add subcontractor fees, software subscriptions, or other client-specific costs to compute real gross margin."
          />
        ) : (
          <div className="h-scroll">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-medium text-[var(--color-text-muted)] border-b" style={{ borderColor: 'var(--color-border)' }}>
                <th className="py-2 pr-3">Date</th>
                <th className="py-2 pr-3">Description</th>
                <th className="py-2 pr-3">Category</th>
                <th className="py-2 pr-3 text-right">Amount</th>
                <th className="py-2 pr-3">Recurring?</th>
                <th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {costs.map(c => (
                <tr key={c.id} className="border-b" style={{ borderColor: 'var(--color-border-subtle)' }}>
                  <td className="py-2 pr-3 text-[var(--color-text-muted)]">{c.date}</td>
                  <td className="py-2 pr-3 text-[var(--color-text)]">{c.description}</td>
                  <td className="py-2 pr-3 text-xs text-[var(--color-text-muted)] capitalize">{c.category}</td>
                  <td className="py-2 pr-3 text-right text-[var(--color-text)] font-medium">
                    {new Intl.NumberFormat('en-NZ', { style: 'currency', currency: c.currency }).format(c.amount)}
                  </td>
                  <td className="py-2 pr-3">{c.recurring && <Badge tone="brand" size="sm">Recurring</Badge>}</td>
                  <td className="py-2 pr-3 text-right">
                    <button
                      type="button"
                      onClick={() => setPendingDelete(c)}
                      aria-label={`Delete the cost entry ${c.description}`}
                      className="tahi-focus-ring inline-flex items-center justify-center min-h-[2.75rem] min-w-[2.75rem] md:min-h-[1.75rem] md:min-w-[1.75rem]"
                      style={{
                        border: 'none',
                        background: 'none',
                        borderRadius: 'var(--radius-sm)',
                        color: 'var(--color-text-muted)',
                        cursor: 'pointer',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-danger)' }}
                      onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-muted)' }}
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={pendingDelete != null}
        title="Delete this cost entry?"
        description={pendingDelete
          ? `${pendingDelete.description} (${new Intl.NumberFormat('en-NZ', { style: 'currency', currency: pendingDelete.currency }).format(pendingDelete.amount)}) comes out of this client's cost total, so the margin above will change.`
          : ''}
        confirmLabel="Delete cost"
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}
