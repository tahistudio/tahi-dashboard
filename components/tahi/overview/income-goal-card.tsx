'use client'

/**
 * IncomeGoalCard (LP.7): the month's income against the take-home target.
 *
 * Reads GET /api/admin/reports/income-goal. All arithmetic is done server
 * side by lib/income-goal.ts; this component only draws it. Every segment has
 * its plain-words definition printed under it (not hidden in a hover tip, so
 * it reads on a phone too), the month is in the header, and the target says
 * what it is made of.
 *
 * Amounts are NZD on the wire and shown through the display-currency provider
 * like every other overview card.
 */

import { useResource } from '@/lib/use-resource'
import { Card, CardH, useOvFormat } from '@/components/tahi/overview/ov-kit'
import { INCOME_GOAL_SEGMENTS, type IncomeGoalResult, type IncomeGoalSegmentKey } from '@/lib/income-goal'

interface IncomeGoalData extends IncomeGoalResult {
  month: string
  currency: 'NZD'
  notes: {
    unbilledHours: number
    unratedHours: number
    skippedHours: number
    pipelineDeals: number
    pipelineRolledOverDeals: number
    twinsExcluded: number
    targetAnnualNzd: { liam: number; staci: number }
  }
}

const SEG_COLOUR: Record<IncomeGoalSegmentKey, string> = {
  paid: '#5A824E',
  invoiced: '#60a5fa',
  unbilled: '#fb923c',
  pipeline: '#8a9987',
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function monthLabel(key: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key)
  if (!m) return key
  return `${MONTHS[Number(m[2]) - 1] ?? key} ${m[1]}`
}

function Shim({ h }: { h: number }) {
  return <div className="tahi-shimmer" style={{ height: `${h / 16}rem`, borderRadius: '0.625rem', background: 'var(--bg-secondary)' }} />
}

export function IncomeGoalCard({ onOpenFinance }: { onOpenFinance: () => void }) {
  const { money } = useOvFormat()
  const { data, error } = useResource<IncomeGoalData>('/api/admin/reports/income-goal')

  // Not allowed to see finance: show nothing rather than a broken card.
  if (error && error.status === 403) return null

  const header = (
    <CardH
      ic="wallet"
      title="Income goal"
      badge={data ? <span className="ov-chip brand">{monthLabel(data.month)}</span> : undefined}
      link="Finance"
      onLink={onOpenFinance}
    />
  )

  if (!data && !error) {
    return (
      <Card section="Income goal" span={12}>
        {header}
        <Shim h={120} />
      </Card>
    )
  }

  if (!data) {
    return (
      <Card section="Income goal" span={12}>
        {header}
        <p className="ov-mini" style={{ lineHeight: 1.55 }}>Income goal could not be loaded.</p>
      </Card>
    )
  }

  const empty = data.projectedNzd <= 0
  const headline = data.paidMeetsTarget
    ? 'Target reached on invoices marked paid.'
    : data.projectedMeetsTarget
      ? `Target covered if everything lands, ${money(data.overByNzd)} over.`
      : data.hasTarget
        ? `${money(data.gapNzd)} short even if everything lands.`
        : 'No target set.'

  // The target marker sits where the target falls on the bar. The bar is as
  // wide as the larger of target and projected total (see computeIncomeGoal).
  const scale = Math.max(data.targetNzd, data.projectedNzd)
  const markerPct = data.hasTarget && scale > 0 ? (data.targetNzd / scale) * 100 : null

  const summary = data.segments
    .map(s => `${INCOME_GOAL_SEGMENTS[s.key].label} ${money(s.nzd)}`)
    .join(', ')

  return (
    <Card section="Income goal" span={12}>
      {header}
      <div className="ov-goal-top">
        <div className="ov-stat">
          <div className="st-num">{money(data.paidNzd)}</div>
          <div className="st-lbl">
            marked paid{data.hasTarget ? ` of ${money(data.targetNzd)} take-home target` : ''}
          </div>
        </div>
        <div className="ov-mini" style={{ flex: '1 1 14rem' }}>{headline}</div>
      </div>

      {empty ? (
        <p className="ov-mini" style={{ marginTop: '0.75rem', lineHeight: 1.55 }}>
          Nothing paid, invoiced, unbilled or forecast for {monthLabel(data.month)} yet.
        </p>
      ) : (
        <div
          className="ov-goal-bar"
          role="img"
          aria-label={`Income goal for ${monthLabel(data.month)}. ${summary}. Target ${money(data.targetNzd)}.`}
        >
          {data.segments.map(s =>
            s.nzd > 0 ? (
              <i
                key={s.key}
                className={s.key === 'pipeline' ? 'forecast' : undefined}
                style={{ width: `${s.barPct}%`, backgroundColor: SEG_COLOUR[s.key] }}
                title={`${INCOME_GOAL_SEGMENTS[s.key].label}: ${money(s.nzd)}`}
              />
            ) : null,
          )}
          {markerPct !== null && markerPct < 100 && (
            <span className="ov-goal-mark" style={{ left: `${markerPct}%` }} title={`Target ${money(data.targetNzd)}`} />
          )}
        </div>
      )}

      <div className="ov-goal-legend">
        {data.segments.map(s => (
          <div className="ov-goal-item" key={s.key}>
            <div className="gi-row">
              <i
                className={s.key === 'pipeline' ? 'gi-sw forecast' : 'gi-sw'}
                style={{ backgroundColor: SEG_COLOUR[s.key] }}
              />
              <span>{INCOME_GOAL_SEGMENTS[s.key].label}</span>
              <span className="gi-val">{money(s.nzd)}</span>
            </div>
            <p className="gi-def">
              {INCOME_GOAL_SEGMENTS[s.key].definition}
              {s.unconvertedCount > 0 &&
                ` ${s.unconvertedCount} ${s.unconvertedCount === 1 ? 'item' : 'items'} left out (no exchange rate or no amount).`}
            </p>
          </div>
        ))}
      </div>

      <p className="ov-goal-foot">
        Take-home target, before costs and tax: {money(data.notes.targetAnnualNzd.liam)} and{' '}
        {money(data.notes.targetAnnualNzd.staci)} a year, added together and divided by 12, set on the finance page.
        Marked paid plus invoiced plus unbilled is {money(data.committedNzd)}; adding the pipeline forecast makes{' '}
        {money(data.projectedNzd)}. Invoice amounts are in NZD without GST.
        {data.olderOutstandingNzd > 0 &&
          ` Older outstanding, unpaid invoices issued before ${monthLabel(data.month)}: ${money(data.olderOutstandingNzd)}. This is not in the bar or the gap.`}
        {data.notes.pipelineRolledOverDeals > 0 &&
          ` ${data.notes.pipelineRolledOverDeals} pipeline ${data.notes.pipelineRolledOverDeals === 1 ? 'deal is' : 'deals are'} past the expected close date and counted this month.`}
        {data.notes.twinsExcluded > 0 &&
          ` ${data.notes.twinsExcluded} duplicate Stripe charge ${data.notes.twinsExcluded === 1 ? 'row was' : 'rows were'} left out.`}
        {data.notes.unratedHours > 0 &&
          ` ${data.notes.unratedHours} billable hours have no hourly rate and are not priced.`}
        {data.notes.skippedHours > 0 &&
          ` ${data.notes.skippedHours} hours belong to clients billed in an unsupported currency and are not priced.`}
      </p>
    </Card>
  )
}
