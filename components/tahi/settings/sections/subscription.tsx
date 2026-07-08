'use client'

/**
 * SubscriptionSection - the studio's own Tahi plan (design settings-app.jsx
 * ~681-685). Honest composition: the plan row and price come from the settings
 * K/V store (workspace_plan_label / workspace_plan_note / workspace_plan_price
 * / workspace_seat_limit) and render a "Not set" state when absent rather than
 * fabricating a subscription; the seats row counts real team members; the
 * Stripe button is an external dashboard link because the studio's own
 * subscription has no Stripe customer inside this system.
 */

import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { useResource } from '@/lib/use-resource'
import { apiPath } from '@/lib/api'
import {
  SectionShell,
  Chip,
  EditDialog,
  useToasts,
  Toasts,
} from '@/components/tahi/settings/primitives'

interface SettingsResponse {
  settings: Record<string, string | null>
}

interface TeamResponse {
  items: { id: string }[]
}

const KEYS = {
  label: 'workspace_plan_label',
  note: 'workspace_plan_note',
  price: 'workspace_plan_price',
  seats: 'workspace_seat_limit',
}

function SkeletonLine({ w, h }: { w: number; h: number }) {
  return (
    <span
      className="animate-pulse"
      style={{ display: 'block', width: w, maxWidth: '100%', height: h, background: 'var(--bg-secondary)', borderRadius: 6 }}
    />
  )
}

export function SubscriptionSection({ isAdmin }: { isAdmin?: boolean } = {}) {
  const shouldFetch = isAdmin !== false
  const { data, isLoading, mutate } = useResource<SettingsResponse>(
    shouldFetch ? '/api/admin/settings' : null,
  )
  const { data: team } = useResource<TeamResponse>(shouldFetch ? '/api/admin/team' : null)
  const [editing, setEditing] = useState(false)
  const { toasts, toast } = useToasts()

  const s = data?.settings ?? {}
  const label = s[KEYS.label] ?? ''
  const note = s[KEYS.note] ?? ''
  const price = s[KEYS.price] ?? ''
  const seatLimit = s[KEYS.seats] ?? ''
  const seatsUsed = team?.items?.length ?? null

  const save = async (v: Record<string, string>) => {
    const pairs: [string, string][] = [
      [KEYS.label, v.label ?? ''],
      [KEYS.note, v.note ?? ''],
      [KEYS.price, v.price ?? ''],
      [KEYS.seats, v.seats ?? ''],
    ]
    try {
      const results = await Promise.all(
        pairs.map(([key, value]) =>
          fetch(apiPath('/api/admin/settings'), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, value }),
          }),
        ),
      )
      if (results.some((r) => !r.ok)) throw new Error('Failed')
      setEditing(false)
    } catch {
      // Keep the dialog open so nothing typed is lost.
      toast('Could not save the plan details. Please try again.', 'err')
    } finally {
      await mutate()
    }
  }

  return (
    <SectionShell title="Subscription" lede="Your Tahi plan and billing.">
      <div className="set-card">
        {isLoading ? (
          <>
            <div className="set-row" aria-hidden="true">
              <div className="sr-t" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <SkeletonLine w={110} h={14} />
                <SkeletonLine w={200} h={11} />
              </div>
              <SkeletonLine w={54} h={22} />
            </div>
            <div className="set-row" aria-hidden="true">
              <div className="sr-t" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <SkeletonLine w={60} h={14} />
                <SkeletonLine w={130} h={11} />
              </div>
              <SkeletonLine w={80} h={14} />
            </div>
          </>
        ) : (
          <>
            <div className="set-row">
              <div className="sr-t">
                <b>Studio plan</b>
                <small>
                  {label
                    ? note || 'Billed monthly'
                    : 'No plan recorded yet. Set the plan details so this card reflects reality.'}
                </small>
              </div>
              {label ? <Chip tone="brand">Active</Chip> : <Chip tone="neutral">Not set</Chip>}
            </div>
            <div className="set-row">
              <div className="sr-t">
                <b>Seats</b>
                <small>
                  {seatsUsed == null
                    ? 'Counting team members'
                    : seatLimit
                      ? `${seatsUsed} of ${seatLimit} used`
                      : `${seatsUsed} in use`}
                </small>
              </div>
              {price && (
                <span style={{ font: '600 14px Manrope', color: 'var(--text)' }}>{price}</span>
              )}
            </div>
          </>
        )}
        <div className="set-row" style={{ justifyContent: 'flex-end', gap: 9 }}>
          <button type="button" className="btn2" onClick={() => setEditing(true)}>
            Edit plan details
          </button>
          <a
            className="btn2"
            href="https://dashboard.stripe.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            Manage in Stripe
            <ExternalLink size={14} />
          </a>
        </div>
      </div>
      {editing && (
        <EditDialog
          heading="Plan details"
          fields={[
            { key: 'label', label: 'Plan name', ph: 'Studio plan' },
            { key: 'note', label: 'Billing note', ph: 'Billed monthly - next charge 1 Aug' },
            { key: 'price', label: 'Price label', ph: 'NZ$149/mo' },
            { key: 'seats', label: 'Seat limit', type: 'number' },
          ]}
          row={{ label, note, price, seats: seatLimit }}
          onSave={save}
          onClose={() => setEditing(false)}
        />
      )}
      <Toasts toasts={toasts} />
    </SectionShell>
  )
}
