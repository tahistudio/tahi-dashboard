'use client'

/**
 * <SubscriptionCard> and friends. Plan (written to both the org and the
 * subscription row), the Priority support and SEO add-on toggles, the billing
 * interval editor with its bundled add-ons, and the per-track occupancy list.
 */

import { useState } from 'react'
import { AlertTriangle, Edit2 } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { Card } from '@/components/tahi/card'
import { PlanBadge, StatusBadge } from '@/components/tahi/status-badge'
import { TrackMeter } from '@/components/tahi/track-meter'
import {
  CYCLE_BUNDLED_ADDONS,
  CYCLE_MONTHS,
  PLAN_MONTHLY_RATES,
  calculateBundledSavings,
  type BillingInterval,
} from '@/lib/billing'
import type { Subscription, Track } from './types'

// ── Subscription card ──────────────────────────────────────────────────────────

export function SubscriptionCard({ subscription, tracks, orgId, onUpdated }: { subscription: Subscription; tracks: Track[]; orgId: string; onUpdated: () => void }) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [planType, setPlanType] = useState(subscription.planType)
  const [togglingAddon, setTogglingAddon] = useState<'priority' | 'seo' | null>(null)

  const PLAN_OPTIONS = ['maintain', 'scale', 'tune', 'launch', 'hourly', 'custom']

  const savePlan = async () => {
    setSaving(true)
    try {
      // Update both the org's planType (used as a quick filter on lists)
      // and the subscription row's planType (the authoritative one for
      // billing math). Two writes - keep them parallel so a single network
      // hiccup doesn't leave the two out of sync indefinitely.
      await Promise.all([
        fetch(apiPath(`/api/admin/clients/${orgId}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planType }),
        }),
        fetch(apiPath(`/api/admin/subscriptions/${subscription.id}`), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planType }),
        }),
      ])
      onUpdated()
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const toggleAddon = async (which: 'priority' | 'seo') => {
    if (togglingAddon) return
    setTogglingAddon(which)
    try {
      const patch = which === 'priority'
        ? { hasPrioritySupport: !subscription.hasPrioritySupport }
        : { hasSeoAddon: !subscription.hasSeoAddon }
      await fetch(apiPath(`/api/admin/subscriptions/${subscription.id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      onUpdated()
    } finally {
      setTogglingAddon(null)
    }
  }

  return (
    <Card>
      <Card.Header style={{ marginBottom: 'var(--space-3)' }}>
        <Card.Title style={{ fontSize: 'var(--text-sm)' }}>Subscription</Card.Title>
        <Card.Action>
        {!editing ? (
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors flex items-center gap-1"
          >
            <Edit2 className="w-3 h-3" />
            Edit
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => { setEditing(false); setPlanType(subscription.planType) }}
              className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              Cancel
            </button>
            <button
              onClick={savePlan}
              disabled={saving}
              className="text-xs text-[var(--color-brand)] font-medium disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        )}
        </Card.Action>
      </Card.Header>

      {editing ? (
        <div className="mb-3">
          <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Plan type</label>
          <select
            value={planType}
            onChange={e => setPlanType(e.target.value)}
            className="w-full px-3 py-1.5 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
          >
            {PLAN_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      ) : (
        <div className="flex items-center gap-2 mb-3">
          <PlanBadge plan={subscription.planType} />
          <StatusBadge status={subscription.status} type="org" />
        </div>
      )}

      <div className="flex flex-col gap-1.5 text-xs text-[var(--color-text-muted)] mb-3">
        {subscription.currentPeriodEnd && (
          <div className="flex justify-between">
            <span>Renews</span>
            <span className="text-[var(--color-text)]">
              {new Date(subscription.currentPeriodEnd).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          </div>
        )}
        <AddonToggleRow
          label="Priority support"
          on={!!subscription.hasPrioritySupport}
          busy={togglingAddon === 'priority'}
          onToggle={() => toggleAddon('priority')}
        />
        <AddonToggleRow
          label="SEO add-on"
          on={!!subscription.hasSeoAddon}
          busy={togglingAddon === 'seo'}
          onToggle={() => toggleAddon('seo')}
        />
      </div>

      {/* Billing interval editor */}
      <BillingIntervalEditor subscription={subscription} onUpdated={onUpdated} />

      <div className="pt-3 border-t border-[var(--color-border)]">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium text-[var(--color-text-muted)]">Tracks ({tracks.length})</p>
        </div>
        <TrackMeter tracks={tracks} />
        {tracks.length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            {tracks.map(track => (
              <div key={track.id} className="flex items-center justify-between text-xs">
                <span className="text-[var(--color-text-muted)] capitalize">{track.type} track</span>
                <span className={track.currentRequestId ? 'text-amber-600' : 'text-emerald-600'}>
                  {track.currentRequestId ? 'Occupied' : 'Available'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}

// ── Billing interval editor ──────────────────────────────────────────────────

const INTERVAL_LABELS: Record<BillingInterval, string> = {
  monthly: 'Monthly',
  quarterly: '3-Month',
  annual: '12-Month',
}

// Toggle row used inside the SubscriptionCard for Priority + SEO add-ons.
// Click anywhere on the row to flip; spinner shows during the PUT.
function AddonToggleRow({
  label, on, busy, onToggle,
}: {
  label: string
  on: boolean
  busy: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={busy}
      className="flex items-center justify-between w-full text-left transition-colors"
      style={{
        padding: '0.25rem 0.375rem',
        marginLeft: '-0.375rem',
        marginRight: '-0.375rem',
        background: 'transparent',
        border: 'none',
        borderRadius: 'var(--radius-sm)',
        cursor: busy ? 'wait' : 'pointer',
        opacity: busy ? 0.6 : 1,
      }}
      onMouseEnter={e => { if (!busy) e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
      aria-pressed={on}
      aria-label={`${label}: ${on ? 'on' : 'off'} - click to toggle`}
    >
      <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{label}</span>
      <span
        className="inline-flex items-center"
        style={{
          gap: '0.3125rem',
          padding: '0.0625rem 0.4375rem',
          borderRadius: '9999px',
          background: on ? 'var(--color-brand-50)' : 'var(--color-bg-secondary)',
          color: on ? 'var(--color-brand-dark)' : 'var(--color-text-subtle)',
          fontSize: '0.6875rem',
          fontWeight: 500,
          border: `1px solid ${on ? 'var(--color-brand-100)' : 'var(--color-border-subtle)'}`,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: '0.375rem', height: '0.375rem', borderRadius: '9999px',
            background: on ? 'var(--color-brand)' : 'var(--color-text-subtle)',
          }}
        />
        {on ? 'On' : 'Off'}
      </span>
    </button>
  )
}

function BillingIntervalEditor({ subscription, onUpdated }: { subscription: Subscription; onUpdated: () => void }) {
  const currentInterval = (subscription.billingInterval ?? 'monthly') as BillingInterval
  const [selected, setSelected] = useState<BillingInterval>(currentInterval)
  const [saving, setSaving] = useState(false)
  const [hoveredBtn, setHoveredBtn] = useState<string | null>(null)

  const hasChanged = selected !== currentInterval
  const bundledAddons = CYCLE_BUNDLED_ADDONS[selected]
  const monthlySavings = calculateBundledSavings(selected)
  const monthlyRate = PLAN_MONTHLY_RATES[subscription.planType] ?? 0
  const cycleMonths = CYCLE_MONTHS[selected]
  const annualSavings = monthlySavings * 12

  const saveInterval = async () => {
    setSaving(true)
    try {
      await fetch(apiPath(`/api/admin/subscriptions/${subscription.id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          billingInterval: selected,
          includedAddons: bundledAddons,
        }),
      })
      onUpdated()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="pt-3 border-t border-[var(--color-border)]">
      <p className="text-xs font-medium text-[var(--color-text-muted)] mb-2">Billing interval</p>

      {/* Button group */}
      <div className="flex gap-1 mb-2">
        {(['monthly', 'quarterly', 'annual'] as BillingInterval[]).map(interval => {
          const isActive = selected === interval
          const isHovered = hoveredBtn === interval
          return (
            <button
              key={interval}
              onClick={() => setSelected(interval)}
              onMouseEnter={() => setHoveredBtn(interval)}
              onMouseLeave={() => setHoveredBtn(null)}
              className="flex-1 text-xs font-medium py-1.5 rounded-md transition-colors"
              style={{
                background: isActive ? 'var(--color-brand)' : isHovered ? 'var(--color-bg-tertiary)' : 'transparent',
                color: isActive ? '#ffffff' : 'var(--color-text-muted)',
                border: isActive ? '1px solid var(--color-brand)' : '1px solid var(--color-border)',
              }}
            >
              {INTERVAL_LABELS[interval]}
            </button>
          )
        })}
      </div>

      {/* Bundled add-ons info */}
      {bundledAddons.length > 0 && (
        <div
          className="rounded-lg p-2.5 mb-2"
          style={{ background: 'var(--color-brand-50)', border: '1px solid var(--color-brand-100)' }}
        >
          <p className="text-xs font-medium" style={{ color: 'var(--color-brand-dark)' }}>
            {selected === 'quarterly' && 'Includes free SEO Dashboard ($150/mo value)'}
            {selected === 'annual' && 'Includes free Extra Track + Priority Support + SEO Dashboard'}
          </p>
          {annualSavings > 0 && (
            <p className="text-xs mt-1" style={{ color: 'var(--color-brand)' }}>
              Annual value of bundled add-ons: ${annualSavings.toLocaleString()}/yr
            </p>
          )}
        </div>
      )}

      {/* Current billing summary */}
      {monthlyRate > 0 && (
        <div className="flex justify-between text-xs text-[var(--color-text-muted)] mb-2">
          <span>{cycleMonths}-month total</span>
          <span className="text-[var(--color-text)] font-medium">
            ${(monthlyRate * cycleMonths).toLocaleString()} NZD
          </span>
        </div>
      )}

      {/* Save button */}
      {hasChanged && (
        <button
          onClick={saveInterval}
          disabled={saving}
          onMouseEnter={() => setHoveredBtn('save')}
          onMouseLeave={() => setHoveredBtn(null)}
          className="w-full text-xs font-medium py-1.5 rounded-md transition-colors disabled:opacity-50"
          style={{
            background: hoveredBtn === 'save' ? 'var(--color-brand-dark)' : 'var(--color-brand)',
            color: '#ffffff',
          }}
        >
          {saving ? 'Saving...' : 'Save billing interval'}
        </button>
      )}
    </div>
  )
}

export function NoSubscriptionCard({ planType }: { planType: string | null }) {
  if (!planType || planType === 'none') return null
  return (
    <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
      <div className="flex gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-amber-800">No active subscription</p>
          <p className="text-xs text-amber-700 mt-0.5">Plan type is set but no subscription record exists.</p>
        </div>
      </div>
    </div>
  )
}
