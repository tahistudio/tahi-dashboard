'use client'

/**
 * <OnboardingCard>. Where this client got to in setting themselves up.
 *
 * The design put an onboarding rail card on the client Overview. The data was
 * already on the page: GET /api/admin/clients/[id] does a bare select on
 * organisations, so `onboardingState` (the JSON blob the client's own first-run
 * panel writes) and `onboardingLoomUrl` come back with the record.
 *
 * The blob is not trusted on its own, for the reason lib/onboarding-state.ts
 * spells out: every import path seeds it with '{}', so a two-year client would
 * read as 0 of 4. `clientOnboarding()` runs the same pure derivation the portal
 * runs, off the requests, invoices and subscription this page already holds, so
 * the studio sees exactly what the client sees rather than a second opinion.
 */

import { Check, Rocket, Video } from 'lucide-react'
import { Card } from '@/components/tahi/card'
import {
  DERIVED_STEPS,
  SELF_ATTESTED_STEPS,
  deriveOnboardingState,
} from '@/lib/onboarding-state'
import { InlineAction } from './chrome'
import type { OnboardingRead } from './needs'

/** Step keys in the order the client meets them, with words for each. */
const STEP_LABELS: Record<string, string> = {
  welcomeVideoWatched: 'Watched the welcome video',
  brandAssetsUploaded: 'Uploaded their brand assets',
  firstRequestSubmitted: 'Sent their first request',
  billingSetUp: 'Billing is live',
}

const STEP_ORDER = [
  'welcomeVideoWatched',
  'brandAssetsUploaded',
  'firstRequestSubmitted',
  'billingSetUp',
] as const

export interface OnboardingStep {
  key: string
  label: string
  done: boolean
  /** True for the two steps the data proves; the other two are self-attested. */
  derived: boolean
}

export interface ClientOnboarding extends OnboardingRead {
  steps: OnboardingStep[]
  loomUrl: string | null
}

export interface OnboardingSignalRows {
  requests: { status: string }[]
  invoices: { status: string }[]
  subscriptionStatus: string | null
  orgCreatedAt: string | null
}

/**
 * Derive the checklist from the stored blob plus what the page already knows.
 * Pure, so the shell can hand the same object to the card and to needsFor().
 */
export function clientOnboarding(
  onboardingState: string | null | undefined,
  loomUrl: string | null | undefined,
  rows: OnboardingSignalRows,
  now?: number,
): ClientOnboarding {
  let stored: Record<string, boolean> = {}
  try {
    const parsed: unknown = JSON.parse(onboardingState ?? '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      stored = parsed as Record<string, boolean>
    }
  } catch {
    stored = {}
  }

  const { state, firstRunEligible } = deriveOnboardingState(stored, {
    hasAnyRequest: rows.requests.length > 0,
    hasDeliveredRequest: rows.requests.some(r => r.status === 'delivered' || r.status === 'archived'),
    hasActiveSubscription: rows.subscriptionStatus === 'active' || rows.subscriptionStatus === 'trialing',
    hasPaidInvoice: rows.invoices.some(i => i.status === 'paid'),
    orgCreatedAt: rows.orgCreatedAt,
    now,
  })

  const derivedKeys: readonly string[] = DERIVED_STEPS
  const knownKeys: readonly string[] = [...SELF_ATTESTED_STEPS, ...DERIVED_STEPS]
  const steps: OnboardingStep[] = STEP_ORDER.filter(k => knownKeys.includes(k)).map(key => ({
    key,
    label: STEP_LABELS[key] ?? key,
    done: state[key] === true,
    derived: derivedKeys.includes(key),
  }))

  return {
    steps,
    done: steps.filter(s => s.done).length,
    total: steps.length,
    firstRunEligible,
    awaitingFirstRequest: state.firstRequestSubmitted !== true,
    loomUrl: loomUrl ?? null,
  }
}

export function OnboardingCard({
  onboarding,
  orgName,
}: {
  onboarding: ClientOnboarding
  orgName: string
}) {
  const { steps, done, total, firstRunEligible, loomUrl } = onboarding
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)

  return (
    <Card padding="sm" style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
      <div className="flex items-center" style={{ gap: '0.5rem' }}>
        <span
          aria-hidden="true"
          className="inline-flex items-center justify-center flex-shrink-0"
          style={{
            width: '1.5rem',
            height: '1.5rem',
            borderRadius: 'var(--radius-leaf-sm)',
            background: 'var(--color-bg-secondary)',
            color: 'var(--color-text-muted)',
          }}
        >
          <Rocket className="w-3.5 h-3.5" />
        </span>
        <h3 style={{ margin: 0, fontSize: '0.8125rem', fontWeight: 700, color: 'var(--color-text)' }}>
          Onboarding
        </h3>
        <span
          className="tabular-nums"
          style={{ marginLeft: 'auto', fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-text-muted)' }}
        >
          {done}/{total}
        </span>
      </div>

      <div
        role="progressbar"
        aria-label={`Onboarding, ${done} of ${total} steps done`}
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        style={{
          height: '0.375rem',
          borderRadius: '9999px',
          background: 'var(--color-bg-tertiary)',
          overflow: 'hidden',
        }}
      >
        <span
          style={{
            display: 'block',
            width: `${pct}%`,
            height: '100%',
            borderRadius: '9999px',
            background: 'var(--color-brand)',
          }}
        />
      </div>

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.3125rem' }}>
        {steps.map(step => (
          <li key={step.key} className="flex items-center" style={{ gap: '0.4375rem' }}>
            <span
              aria-hidden="true"
              className="inline-flex items-center justify-center flex-shrink-0"
              style={{
                width: '1rem',
                height: '1rem',
                borderRadius: 'var(--radius-sm)',
                border: `1px solid ${step.done ? 'var(--color-brand)' : 'var(--color-border-strong)'}`,
                background: step.done ? 'var(--color-brand)' : 'var(--color-bg)',
                color: '#ffffff',
              }}
            >
              {step.done && <Check className="w-2.5 h-2.5" />}
            </span>
            <span
              style={{
                fontSize: '0.75rem',
                fontWeight: step.done ? 500 : 600,
                color: step.done ? 'var(--color-text-muted)' : 'var(--color-text)',
              }}
            >
              {step.label}
            </span>
            {!step.derived && (
              <span
                style={{ marginLeft: 'auto', fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}
                title="This step is ticked by the client in their portal. Nothing in the data can prove it."
              >
                their tick
              </span>
            )}
          </li>
        ))}
      </ul>

      <p style={{ margin: 0, fontSize: '0.6875rem', lineHeight: 1.45, color: 'var(--color-text-subtle)' }}>
        {done === total
          ? `${orgName} finished setting up.`
          : firstRunEligible
            ? `${orgName} still has the first-run panel in their portal.`
            : `${orgName} is past their first month, so the panel no longer shows for them.`}
      </p>

      {loomUrl && (
        <InlineAction href={loomUrl} ariaLabel={`Open the welcome video for ${orgName} in a new tab`}>
          <Video className="w-3.5 h-3.5" aria-hidden="true" />
          Their welcome video
        </InlineAction>
      )}
    </Card>
  )
}
