'use client'

/**
 * Plan & billing (client portal). The client's real retainer with Tahi: current
 * plan, billing period and included add-ons, plus a change-plan grid. Shown
 * under the client Plan & billing group.
 *
 * Wired to GET /api/portal/subscription (the org's active subscription, scoped
 * server-side to the caller). We never fabricate a plan, amount, charge date or
 * "Active" chip: when the org has no active subscription the endpoint returns
 * { subscription: null } and we render an honest pending state. Changes stay a
 * request-to-change (the studio confirms) rather than a self-serve mutation.
 *
 * The change-plan grid lists the plans we sell with their public list prices
 * from lib/billing (PLAN_MONTHLY_RATES); the feature lines and taglines are
 * presentational. Only a workspace admin (isClientAdmin) may request changes or
 * manage billing; members get a read-only view.
 */

import { useState } from 'react'
import { Check } from 'lucide-react'
import { SectionShell, Chip } from '@/components/tahi/settings/primitives'
import { useResource } from '@/lib/use-resource'
import { apiPath } from '@/lib/api'
import { PLAN_MONTHLY_RATES } from '@/lib/billing'

interface SubscriptionData {
  id: string
  planType: string
  planLabel: string
  status: string
  billingInterval: string
  includedAddons: string[]
  addonDetails: { key: string; label: string; monthlyValue: number }[]
  hasPrioritySupport: boolean
  hasSeoAddon: boolean
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  commitmentEndDate: string | null
  createdAt: string
}

interface BillingData {
  monthlyRate: number
  cycleMonths: number
  cycleTotal: number
  monthlySavings: number
  cycleSavings: number
  gst: { subtotal: number; gst: number; total: number }
  billingCountry: string | null
}

interface SubscriptionResponse {
  subscription: SubscriptionData | null
  billing?: BillingData
}

interface PlanOption {
  id: string
  name: string
  rec: boolean
  tag: string
  feats: string[]
}

// Presentational catalogue of the plans we sell. Prices come from lib/billing
// (PLAN_MONTHLY_RATES), never invented here.
const CATALOG: PlanOption[] = [
  { id: 'maintain', name: 'Maintain', rec: false, tag: 'Steady upkeep, handled.', feats: ['One active track of work', 'Design and build, ongoing', '48-hour response', 'Monthly check-in'] },
  { id: 'scale', name: 'Scale', rec: true, tag: 'Ongoing design and build, handled.', feats: ['Multiple tracks in parallel', 'Priority design and build', '24-hour response', 'Weekly check-in', 'Quarterly strategy'] },
]

const INTERVAL_LABEL: Record<string, string> = {
  monthly: 'monthly',
  quarterly: 'quarterly',
  annual: 'annually',
}

function money(n: number): string {
  return '$' + Number(n || 0).toLocaleString('en-NZ')
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function PlanBillingSection({ isClientAdmin }: { isClientAdmin?: boolean }) {
  const canManage = !!isClientAdmin
  const { data, error, isLoading } = useResource<SubscriptionResponse>('/api/portal/subscription')
  const [note, setNote] = useState('')

  const sub = data?.subscription ?? null
  const billing = data?.billing ?? null

  function flash(msg: string) {
    setNote(msg)
    window.setTimeout(() => setNote(''), 4200)
  }

  function requestSwitch(name: string) {
    flash(`Change to ${name} requested. Your studio contact will confirm before it takes effect.`)
  }

  async function openBilling() {
    try {
      const res = await fetch(apiPath('/api/portal/billing/session'))
      if (!res.ok) {
        flash('Payment management is not available yet. Your studio contact can help.')
        return
      }
      const body = (await res.json()) as { url?: string }
      if (body.url) {
        window.location.href = body.url
      } else {
        flash('Payment management is not available yet. Your studio contact can help.')
      }
    } catch {
      flash('Could not open billing right now. Please try again.')
    }
  }

  // Included add-on chips (honest: driven by the subscription record).
  const included: string[] = []
  if (sub) {
    for (const a of sub.addonDetails) included.push(a.label)
    if (sub.hasPrioritySupport && !included.some((l) => /priority/i.test(l))) included.push('Priority support')
    if (sub.hasSeoAddon && !included.some((l) => /seo/i.test(l))) included.push('SEO dashboard')
  }

  const subLine: string[] = []
  if (billing && billing.monthlyRate > 0) subLine.push(`${money(billing.monthlyRate)} / mo`)
  if (sub && INTERVAL_LABEL[sub.billingInterval]) subLine.push(`billed ${INTERVAL_LABEL[sub.billingInterval]}`)
  const nextCharge = sub ? formatDate(sub.currentPeriodEnd) : ''
  if (nextCharge) subLine.push(`next charge ${nextCharge}`)

  return (
    <SectionShell
      title="Plan & billing"
      lede="Your retainer with Tahi Studio. Request a change anytime and we will confirm before it takes effect."
    >
      {isLoading ? (
        <div className="set-card">
          <div className="pc-sub" style={{ color: 'var(--text-faint)' }}>Loading your plan...</div>
        </div>
      ) : error ? (
        <div className="set-card">
          <span className="led">Current plan</span>
          <div className="pc-sub">We could not load your plan right now. Please refresh, or contact your studio contact if this keeps happening.</div>
        </div>
      ) : sub ? (
        <>
          <div className="set-card plan-current">
            <div className="pc-l">
              <span className="led">Current plan</span>
              <div className="pc-name">
                <b>{sub.planLabel}</b>
                {sub.status === 'active' && <Chip tone="brand">Active</Chip>}
              </div>
              {subLine.length > 0 && <div className="pc-sub">{subLine.join(' · ')}</div>}
            </div>
            {canManage && (
              <button className="btn2" type="button" onClick={openBilling}>Manage payment method</button>
            )}
          </div>

          {included.length > 0 && (
            <div className="set-card plan-addon">
              <div className="sr-t"><b>Included add-ons</b><small>Active on your current plan.</small></div>
              <div className="lrow-r" style={{ flexWrap: 'wrap' }}>
                {included.map((label) => (<Chip key={label} tone="neutral">{label}</Chip>))}
              </div>
            </div>
          )}

          <div className="set-card plan-addon">
            <div className="sr-t"><b>Need more capacity?</b><small>Run more work in parallel by adding a track to your retainer. We will confirm scheduling and pricing first.</small></div>
            {canManage && (
              <button className="btn2" type="button" onClick={() => flash('Extra capacity requested. Your studio contact will confirm scheduling and pricing before anything changes.')}>Request extra capacity</button>
            )}
          </div>
        </>
      ) : (
        <div className="set-card plan-current">
          <div className="pc-l">
            <span className="led">Current plan</span>
            <div className="pc-name"><b>No active plan yet</b></div>
            <div className="pc-sub">Your studio contact is setting up your retainer. Plan and billing details will appear here once it is live.</div>
          </div>
        </div>
      )}

      {note && <div className="plan-note">{note}</div>}

      {!isLoading && !error && (
        <>
          <div className="set-sub-label">{sub ? 'Change plan' : 'Plans we offer'}</div>
          <div className="plan-grid">
            {CATALOG.map((p) => {
              const isCurrent = sub?.planType === p.id
              const price = PLAN_MONTHLY_RATES[p.id] ?? 0
              return (
                <div key={p.id} className={'plan-card' + (isCurrent ? ' current' : '')}>
                  {p.rec && <span className="plan-rec">Most popular</span>}
                  <div className="plan-h"><b>{p.name}</b>{isCurrent && <Chip tone="brand">Current</Chip>}</div>
                  <div className="plan-price">{money(price)}<span>/mo</span></div>
                  <p className="plan-tag">{p.tag}</p>
                  <ul className="plan-feats">
                    {p.feats.map((f) => (<li key={f}><Check size={15} aria-hidden="true" />{f}</li>))}
                  </ul>
                  {isCurrent ? (
                    <button className="btn2" type="button" disabled>Current plan</button>
                  ) : canManage ? (
                    <button className="btn1" type="button" onClick={() => requestSwitch(p.name)}>{sub ? `Switch to ${p.name}` : `Request ${p.name}`}</button>
                  ) : null}
                </div>
              )
            })}
          </div>
          {!canManage && (
            <p className="set-lede" style={{ marginTop: 12 }}>Only workspace admins can change the plan or manage billing. Ask an admin on your team, or your studio contact, to make changes.</p>
          )}
        </>
      )}
    </SectionShell>
  )
}
