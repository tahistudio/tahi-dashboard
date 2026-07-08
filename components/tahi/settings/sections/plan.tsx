'use client'

/**
 * Plan & billing (client portal). The client's real retainer with Tahi:
 * current plan, extra-track stepper, live price breakdown, and a change-plan
 * grid - the full design surface, honestly wired:
 *
 *   - GET /api/portal/subscription     the org's active subscription (server
 *     scoped) plus the shared retainer catalogue: admin-edited settings K/V
 *     `plan_catalog` merged with lib/billing fallbacks, so what the admin
 *     edits in Client plans is exactly what renders here.
 *   - POST /api/portal/subscription/change-request   every change stays
 *     request-to-change: it notifies the whole studio and writes an audit
 *     entry; a human confirms before anything is billed.
 *
 * Only a workspace admin (isClientAdmin) may request changes or manage
 * billing; members get a read-only view. Admin Client-view is read-only
 * server-side (impersonating -> 403).
 */

import { useState } from 'react'
import { Check } from 'lucide-react'
import { SectionShell, Chip } from '@/components/tahi/settings/primitives'
import { Money } from '@/components/tahi/money'
import { useResource } from '@/lib/use-resource'
import { apiPath } from '@/lib/api'

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
  trackCount: number
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

interface CatalogPlan {
  id: string
  name: string
  tag: string
  feats: string[]
  rec: boolean
  monthlyRate: number
  trackRate: number
}

interface SubscriptionResponse {
  subscription: SubscriptionData | null
  billing?: BillingData
  plans?: CatalogPlan[]
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
}

function SkeletonBlock({ w, h }: { w: number; h: number }) {
  return (
    <span
      className="animate-pulse"
      style={{ display: 'block', width: w, maxWidth: '100%', height: h, background: 'var(--bg-secondary)', borderRadius: 7 }}
    />
  )
}

export function PlanBillingSection({ isClientAdmin }: { isClientAdmin?: boolean }) {
  const canManage = !!isClientAdmin
  const { data, error, isLoading } = useResource<SubscriptionResponse>('/api/portal/subscription')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const sub = data?.subscription ?? null
  const billing = data?.billing ?? null
  const plans = data?.plans ?? []
  const currentPlan = sub ? plans.find((p) => p.id === sub.planType) ?? null : null

  // The base plan includes the first track; anything beyond it is an extra.
  const currentExtras = sub ? Math.max(0, (sub.trackCount ?? 1) - 1) : 0
  const [requestedExtras, setRequestedExtras] = useState<number | null>(null)
  const extras = requestedExtras ?? currentExtras
  const extrasDirty = requestedExtras !== null && requestedExtras !== currentExtras

  function flash(msg: string) {
    setNote(msg)
    window.setTimeout(() => setNote(''), 4200)
  }

  async function submitChange(body: { kind: 'plan' | 'tracks'; targetPlanId?: string; targetTracks?: number }, msg: string) {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(apiPath('/api/portal/subscription/change-request'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(j?.error ?? 'Failed')
      }
      flash(msg)
      if (body.kind === 'tracks') setRequestedExtras(null)
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not send the request. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  function requestSwitch(plan: CatalogPlan) {
    void submitChange(
      { kind: 'plan', targetPlanId: plan.id },
      'Change to ' + plan.name + ' requested - your studio contact will confirm before it takes effect.',
    )
  }

  function requestExtras() {
    if (requestedExtras === null) return
    void submitChange(
      { kind: 'tracks', targetTracks: requestedExtras },
      requestedExtras > currentExtras
        ? "Extra track requested - we'll confirm scheduling."
        : "Track reduction requested - we'll confirm before it changes.",
    )
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

  const trackRate = currentPlan?.trackRate ?? 0
  const baseRate = billing?.monthlyRate ?? currentPlan?.monthlyRate ?? 0
  const total = baseRate + extras * trackRate

  const nextCharge = sub ? formatDate(sub.currentPeriodEnd) : ''

  // Included add-on chips (honest: driven by the subscription record).
  const included: string[] = []
  if (sub) {
    for (const a of sub.addonDetails) included.push(a.label)
    if (sub.hasPrioritySupport && !included.some((l) => /priority/i.test(l))) included.push('Priority support')
    if (sub.hasSeoAddon && !included.some((l) => /seo/i.test(l))) included.push('SEO dashboard')
  }

  return (
    <SectionShell
      title="Plan & billing"
      lede="Your retainer with Tahi Studio. Change anytime - we'll confirm before it takes effect."
    >
      {isLoading ? (
        <div className="set-card plan-current" aria-hidden="true">
          <div className="pc-l" style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <SkeletonBlock w={92} h={11} />
            <SkeletonBlock w={170} h={22} />
            <SkeletonBlock w={230} h={13} />
          </div>
          <SkeletonBlock w={190} h={38} />
        </div>
      ) : error ? (
        <div className="set-card">
          <div className="set-row">
            <div className="sr-t">
              <b>Current plan</b>
              <small>
                We could not load your plan right now. Please refresh, or contact your studio contact if this keeps
                happening.
              </small>
            </div>
          </div>
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
              <div className="pc-sub">
                {baseRate > 0 && (
                  <>
                    <Money nzd={total} />
                    <span>/mo</span>
                  </>
                )}
                {nextCharge && (baseRate > 0 ? ' · next charge ' + nextCharge : 'Next charge ' + nextCharge)}
              </div>
            </div>
            {canManage && (
              <button className="btn2" type="button" onClick={() => void openBilling()}>
                Manage payment method
              </button>
            )}
          </div>

          {included.length > 0 && (
            <div className="set-card plan-addon">
              <div className="sr-t">
                <b>Included add-ons</b>
                <small>Active on your current plan.</small>
              </div>
              <div className="lrow-r" style={{ flexWrap: 'wrap' }}>
                {included.map((label) => (
                  <Chip key={label} tone="neutral">
                    {label}
                  </Chip>
                ))}
              </div>
            </div>
          )}

          <div className="set-card plan-addon">
            <div className="sr-t">
              <b>Extra tracks</b>
              <small>
                Run more work in parallel.{' '}
                {trackRate > 0 ? (
                  <>
                    <Money nzd={trackRate} />
                    /mo each, on top of your base plan.
                  </>
                ) : (
                  'Priced per plan, on top of your base plan.'
                )}
              </small>
            </div>
            {canManage ? (
              <div className="ctl-line" style={{ flexShrink: 0 }}>
                <div className="track-stepper">
                  <button
                    type="button"
                    onClick={() => setRequestedExtras(Math.max(0, extras - 1))}
                    disabled={extras <= 0 || busy}
                    aria-label="Remove a track"
                  >
                    &minus;
                  </button>
                  <span aria-live="polite">{extras}</span>
                  <button
                    type="button"
                    onClick={() => setRequestedExtras(extras + 1)}
                    disabled={busy}
                    aria-label="Add a track"
                  >
                    +
                  </button>
                </div>
                {extrasDirty && (
                  <button type="button" className="btn1" onClick={requestExtras} disabled={busy}>
                    {busy ? 'Sending...' : 'Request change'}
                  </button>
                )}
              </div>
            ) : (
              <span className="chip neutral">{currentExtras} active</span>
            )}
          </div>

          <div className="set-card plan-breakdown">
            <div className="pb-row">
              <span>{sub.planLabel} base</span>
              <b>
                <Money nzd={baseRate} />
                /mo
              </b>
            </div>
            {extras > 0 && (
              <div className="pb-row">
                <span>
                  {extras} extra track{extras > 1 ? 's' : ''} &times; <Money nzd={trackRate} />
                </span>
                <b>
                  <Money nzd={extras * trackRate} />
                  /mo
                </b>
              </div>
            )}
            <div className="pb-row total">
              <span>Total{extrasDirty ? ' (if confirmed)' : ''}</span>
              <b>
                <Money nzd={total} />
                /mo
              </b>
            </div>
          </div>
        </>
      ) : (
        <div className="set-card plan-current">
          <div className="pc-l">
            <span className="led">Current plan</span>
            <div className="pc-name">
              <b>No active plan yet</b>
            </div>
            <div className="pc-sub">
              Your studio contact is setting up your retainer. Plan and billing details will appear here once it is
              live.
            </div>
          </div>
        </div>
      )}

      {note && <div className="plan-note" role="status">{note}</div>}

      {!isLoading && !error && plans.length > 0 && (
        <>
          <div className="set-sub-label">{sub ? 'Change plan' : 'Plans we offer'}</div>
          <div className="plan-grid">
            {plans.map((p) => {
              const isCurrent = sub?.planType === p.id
              return (
                <div key={p.id} className={'plan-card' + (isCurrent ? ' current' : '') + (p.rec ? ' rec' : '')}>
                  {p.rec && <span className="plan-rec">Most popular</span>}
                  <div className="plan-h">
                    <b>{p.name}</b>
                    {isCurrent && <Chip tone="brand">Current</Chip>}
                  </div>
                  <div className="plan-price">
                    <Money nzd={p.monthlyRate} />
                    <span>/mo</span>
                  </div>
                  <p className="plan-tag">{p.tag}</p>
                  <ul className="plan-feats">
                    {p.feats.map((f) => (
                      <li key={f}>
                        <Check size={15} aria-hidden="true" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  {isCurrent ? (
                    <button className="btn2" type="button" disabled>
                      Current plan
                    </button>
                  ) : canManage ? (
                    <button className="btn1" type="button" disabled={busy} onClick={() => requestSwitch(p)}>
                      {sub ? 'Switch to ' + p.name : 'Request ' + p.name}
                    </button>
                  ) : (
                    <button
                      className="btn2"
                      type="button"
                      disabled
                      title="Only workspace admins can change the plan"
                    >
                      Switch to {p.name}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          {!canManage && (
            <p className="set-lede" style={{ marginTop: 12, marginBottom: 0 }}>
              Only workspace admins can change the plan or manage billing. Ask an admin on your team, or your studio
              contact, to make changes.
            </p>
          )}
          <p className="set-lede" style={{ marginTop: 10, marginBottom: 0 }}>
            Need something bigger, or a custom scope? <a href="/messages">Talk to your studio contact.</a>
          </p>
        </>
      )}
    </SectionShell>
  )
}
