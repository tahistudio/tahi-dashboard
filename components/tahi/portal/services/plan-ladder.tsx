'use client'

/**
 * The plan ladder on the client Services page.
 *
 * Three rungs with the client's own plan in the middle, a hairline running
 * through their nodes, and nothing on a rung to click. Ported from the Claude
 * Design build (.claude/qa/svclocal/portal-money.*) onto the repo's primitives
 * and tokens.
 *
 * What the design settled and this port keeps:
 *
 *   no price       anywhere, on any rung. The only money on the Services page
 *                  is the client's own plan card above this section.
 *   no Start       nothing on a rung is a button, a link or an order path.
 *   one figure     only the rung the client stands on carries numbers, and
 *                  both of them are the client's own (track entitlement,
 *                  measured turnaround). A neighbour speaks in words, because
 *                  an invented figure on a page about somebody's bill is a lie.
 *   one action     the nudge underneath, and only when their own usage earns
 *                  it. When nothing fires, the calm line says so out loud so
 *                  the absence reads as an answer rather than a hole.
 *
 * The ordering, the copy and the pressure thresholds all live in
 * lib/plan-ladder.ts, which is pure and unit tested. This file is the surface.
 */

import * as React from 'react'
import { Check, CheckCircle2, Layers, MessageSquare } from 'lucide-react'
import { Card } from '@/components/tahi/card'
import { TahiButton } from '@/components/tahi/tahi-button'
import { PortalSkeleton } from '@/components/tahi/portal/portal-money-kit'
import type { LadderView, PressureSignal, Rung, RungLive } from '@/lib/plan-ladder'

type Where = 'down' | 'here' | 'up'

const WHERE_LABEL: Record<Where, string> = {
  down: 'One step down',
  here: 'You are here',
  up: 'One step up',
}

const EYEBROW: React.CSSProperties = {
  display: 'block',
  fontSize: '0.6875rem',
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--color-text-subtle)',
}

/** The note that keeps hourly work and one off projects off the ladder. */
const OFF_LADDER_NOTE =
  'Two kinds of work sit off this ladder entirely: small jobs billed by the hour, and one off projects scoped and quoted on their own. Either can run whether or not you are on a plan.'

const NUDGE_SOFTENER =
  'Plenty of clients sit here on purpose and never move, and this is a suggestion rather than a push to spend more. It is on the page because your own numbers put it there, and a conversation changes nothing on your bill.'

export interface PlanLadderProps {
  /** Down, here, up, from lib/plan-ladder `ladder()`. */
  view: LadderView
  /** The client's own figures for the middle rung. Null fields keep the words. */
  live: RungLive
  /** Empty means nothing in their usage says the plan is full. */
  pressure: readonly PressureSignal[]
  /** The client's company name, when the page knows it. */
  orgName?: string | null
  readOnly?: boolean
  readOnlyReason?: string
  /** Opens the ask sheet. The only action in the whole section. */
  onTalk: () => void
}

export function PlanLadder({
  view,
  live,
  pressure,
  orgName,
  readOnly = false,
  readOnlyReason,
  onTalk,
}: PlanLadderProps) {
  const steps: Array<{ rung: Rung; where: Where }> = []
  if (view.down) steps.push({ rung: view.down, where: 'down' })
  steps.push({ rung: view.here, where: 'here' })
  if (view.up) steps.push({ rung: view.up, where: 'up' })

  // Two static class strings, picked at runtime. Never interpolated: a class
  // name built at runtime is invisible to the Tailwind scanner.
  const gridClass = steps.length === 3
    ? 'grid gap-3 md:gap-4 md:grid-cols-3'
    : 'grid gap-3 md:gap-4 md:grid-cols-2'

  const forWhom = orgName?.trim() || 'you'
  const underPressure = pressure.length > 0

  return (
    <section
      aria-labelledby="plan-ladder-heading"
      style={{ display: 'grid', gap: 'var(--space-4)' }}
    >
      <div>
        <span style={EYEBROW}>Where this sits</span>
        <h2
          id="plan-ladder-heading"
          style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--color-text)', margin: '0.125rem 0 0' }}
        >
          Your plan, and what is either side of it
        </h2>
        <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: 'var(--color-text-muted)', maxWidth: '46rem' }}>
          {`No prices here and nothing to sign up to. Only your own rung carries numbers: the ones either side are described in words, because what either would mean for ${forWhom} depends on what you would ask of it.`}
        </p>
      </div>

      <ol className={gridClass} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {steps.map((step, index) => (
          <RungItem
            key={step.rung.key}
            rung={step.rung}
            where={step.where}
            live={live}
            isLast={index === steps.length - 1}
          />
        ))}
      </ol>

      <p style={{ margin: 0, padding: '0 0.25rem', maxWidth: '52rem', fontSize: '0.75rem', lineHeight: 1.6, color: 'var(--color-text-muted)' }}>
        {OFF_LADDER_NOTE}
      </p>

      {underPressure ? (
        <Card
          padding="md"
          style={{
            background: 'var(--color-brand-50)',
            border: '1px solid var(--color-brand-100)',
          }}
        >
          <div className="flex flex-col sm:flex-row sm:items-start gap-4">
            <span
              className="flex items-center justify-center shrink-0"
              style={{
                width: '2.5rem',
                height: '2.5rem',
                borderRadius: 'var(--radius-leaf-sm)',
                background: 'var(--color-brand-100)',
                color: 'var(--color-brand-ink)',
              }}
            >
              <Layers size={18} aria-hidden="true" />
            </span>
            <div style={{ flex: 1, display: 'grid', gap: '0.375rem', minWidth: 0 }}>
              <b style={{ fontSize: '0.9375rem', lineHeight: 1.35, color: 'var(--color-text)' }}>
                {`You have been sitting right on the edge of ${view.here.name}`}
              </b>
              {pressure.map(signal => (
                <p key={signal.key} style={{ margin: 0, fontSize: '0.8125rem', lineHeight: 1.55, color: 'var(--color-text)' }}>
                  {signal.body}
                </p>
              ))}
              <span style={{ fontSize: '0.75rem', lineHeight: 1.55, color: 'var(--color-text-muted)' }}>
                {NUDGE_SOFTENER}
              </span>
            </div>
            <TahiButton
              variant="primary"
              size="md"
              className="w-full sm:w-auto shrink-0"
              iconLeft={<MessageSquare size={15} aria-hidden="true" />}
              onClick={onTalk}
              disabled={readOnly}
              title={readOnly ? readOnlyReason : undefined}
            >
              {view.up ? 'Talk about moving up' : 'Talk about how this is running'}
            </TahiButton>
          </div>
        </Card>
      ) : (
        <p
          className="flex items-start gap-2"
          style={{
            margin: 0,
            padding: '0.875rem 1rem',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-lg)',
            background: 'var(--color-bg-secondary)',
            fontSize: '0.78125rem',
            lineHeight: 1.55,
            color: 'var(--color-text-muted)',
          }}
        >
          <span className="shrink-0" style={{ marginTop: '0.1875rem', color: 'var(--color-brand-ink)' }}>
            <CheckCircle2 size={14} aria-hidden="true" />
          </span>
          <span>
            {`Nothing in your numbers says you are pushing against ${view.here.name} at the moment, so there is nothing here you need to move to. The rungs either side are on the page so you know what they are.`}
          </span>
        </p>
      )}
    </section>
  )
}

// ── One rung ─────────────────────────────────────────────────────────────────

function RungItem({
  rung,
  where,
  live,
  isLast,
}: {
  rung: Rung
  where: Where
  live: RungLive
  isLast: boolean
}) {
  const here = where === 'here'
  // The live override only ever lands on the rung the client is standing on.
  // A neighbour has no sourced number, so it keeps its words, and so does the
  // middle rung for any figure the portal could not measure.
  const rows: Array<[string, string]> = [
    ['Tracks', (here && live.tracks) || rung.tracks],
    ['Turnaround', (here && live.turnaround) || rung.turnaround],
    ['Included', rung.services],
  ]

  return (
    <li
      aria-current={here ? 'true' : undefined}
      style={{ display: 'flex', flexDirection: 'column', gap: '0.4375rem', minWidth: 0 }}
    >
      {/* The step row is the height of the largest node, so every card below
          starts on the same y and the nodes read as one rail line. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minHeight: '1.125rem', padding: '0 0.125rem' }}>
        <span
          className="flex items-center justify-center shrink-0"
          aria-hidden="true"
          style={{
            width: here ? '1.125rem' : '0.9375rem',
            height: here ? '1.125rem' : '0.9375rem',
            borderRadius: '50%',
            border: `0.09375rem solid ${here ? 'var(--color-brand-ink)' : 'var(--color-border)'}`,
            // brand-ink is mode aware, so the tick reads as the card surface
            // on the fill in both themes rather than going muddy in dark.
            background: here ? 'var(--color-brand-ink)' : 'var(--color-bg)',
            color: here ? 'var(--color-bg)' : 'transparent',
          }}
        >
          {here && <Check size={11} strokeWidth={3.2} aria-hidden="true" />}
        </span>
        <span
          style={{
            fontSize: '0.625rem',
            fontWeight: 700,
            letterSpacing: '0.13em',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
            color: here ? 'var(--color-brand-ink)' : 'var(--color-text-muted)',
          }}
        >
          {WHERE_LABEL[where]}
        </span>
        {/* The hairline bleeds into the column gap so the nodes read as one
            rail rather than three loose ticks. Hidden while the rungs are
            stacked, where a rail to nowhere would only add a stray line (and
            where the negative margin would push past 375px). */}
        {!isLast && (
          <span
            aria-hidden="true"
            className="hidden md:block -mr-4"
            style={{ flex: 1, minWidth: '0.75rem', height: '0.0625rem', background: 'var(--color-border-subtle)' }}
          />
        )}
      </div>

      <Card
        as="article"
        padding="md"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5625rem',
          background: here ? 'var(--color-bg)' : 'var(--color-bg-secondary)',
          border: here
            ? '1px solid color-mix(in srgb, var(--color-brand-ink) 45%, transparent)'
            : '1px solid var(--color-border-subtle)',
        }}
      >
        <h3
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            minHeight: '1.75rem',
            margin: 0,
            fontSize: here ? '1.25rem' : '1rem',
            fontWeight: 700,
            letterSpacing: '-0.02em',
            color: here ? 'var(--color-text)' : 'var(--color-text-muted)',
          }}
        >
          {rung.name}
        </h3>
        {/* A shared minimum at desktop so the three dividers land on one line.
            A longer sentence falls back to natural flow rather than clipping. */}
        <p className="md:min-h-[3.65625rem]" style={{ margin: 0, fontSize: '0.8125rem', lineHeight: 1.5, fontWeight: 600, color: 'var(--color-text)' }}>
          {rung.bestIf}
        </p>
        <dl
          style={{
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
            paddingTop: '0.625rem',
            borderTop: here
              ? '1px solid color-mix(in srgb, var(--color-brand-ink) 25%, transparent)'
              : '1px solid var(--color-border-subtle)',
          }}
        >
          {rows.map(([label, value]) => (
            <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem', minWidth: 0 }}>
              <dt style={{ fontSize: '0.625rem', fontWeight: 600, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--color-text-subtle)' }}>
                {label}
              </dt>
              <dd style={{ margin: 0, fontSize: '0.78125rem', lineHeight: 1.5, color: here ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </Card>
    </li>
  )
}

// ── First paint ──────────────────────────────────────────────────────────────

/**
 * The ladder's own skeleton, claiming the shape the section takes once the
 * plan and the usage land, so nothing jumps when they do.
 */
export function PlanLadderSkeleton() {
  return (
    <section aria-hidden="true" style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <div style={{ display: 'grid', gap: '0.375rem' }}>
        <PortalSkeleton width="7rem" height="0.6875rem" />
        <PortalSkeleton width="18rem" height="1.125rem" />
        <PortalSkeleton width="100%" height="0.75rem" />
      </div>
      <ol className="grid gap-3 md:gap-4 md:grid-cols-3" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {[0, 1, 2].map(i => (
          <li key={i} style={{ display: 'flex', flexDirection: 'column', gap: '0.4375rem', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minHeight: '1.125rem', padding: '0 0.125rem' }}>
              <PortalSkeleton width="1.125rem" height="1.125rem" radius="var(--radius-full)" />
              <PortalSkeleton width="5rem" height="0.625rem" />
            </div>
            <Card padding="md" style={{ display: 'grid', gap: '0.5625rem' }}>
              <PortalSkeleton width="7rem" height="1.25rem" />
              <PortalSkeleton width="100%" height="0.75rem" />
              <PortalSkeleton width="80%" height="0.75rem" />
              <PortalSkeleton width="100%" height="6rem" />
            </Card>
          </li>
        ))}
      </ol>
      <PortalSkeleton width="100%" height="0.75rem" />
    </section>
  )
}
