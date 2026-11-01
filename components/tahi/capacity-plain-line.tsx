'use client'

/**
 * CapacityPlainLine - one plain-words sentence about studio room, such as
 * "Free about 60 hours a month, can start 8 Sep".
 *
 * Reads POST /api/admin/capacity/start-date (the same route the Capacity page
 * uses) for a typical new engagement and hands the numbers to the pure
 * sentence builder in lib/capacity-plain-line.ts. Nothing is computed here.
 *
 * States: loading shimmer, the sentence, or an honest "unknown" line when the
 * route fails or the numbers are missing.
 */

import useSWR from 'swr'
import { apiPath } from '@/lib/api'
import { buildCapacityLine } from '@/lib/capacity-plain-line'

/**
 * Size of the "typical" new engagement the start date is worked out for, in
 * hours a week. Matches the Maintain plan hours the start-date route already
 * assumes (PLAN_HOURS.maintain), so "can start" answers for a standard retainer.
 */
const TYPICAL_ENGAGEMENT_HOURS_PER_WEEK = 8

interface StartDateResult {
  earliestDate: string | null
  availableHoursPerWeek: number
  totalTeamCapacity: number
}

async function fetchStartDate(): Promise<StartDateResult | null> {
  try {
    const res = await fetch(apiPath('/api/admin/capacity/start-date'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estimatedHoursPerWeek: TYPICAL_ENGAGEMENT_HOURS_PER_WEEK }),
    })
    if (!res.ok) return null
    return (await res.json()) as StartDateResult
  } catch {
    return null
  }
}

/**
 * `scheme` picks which token family the text reads from: the Capacity page
 * uses the --color-* tokens, the overview cards use --text / --text-muted
 * (which the card tones re-map for dark and ink surfaces).
 */
export function CapacityPlainLine({
  className,
  scheme = 'page',
}: {
  className?: string
  scheme?: 'page' | 'overview'
}) {
  const strong = scheme === 'overview' ? 'var(--text)' : 'var(--color-text)'
  const muted = scheme === 'overview' ? 'var(--text-muted)' : 'var(--color-text-muted)'
  const skeleton = scheme === 'overview' ? 'var(--bg-secondary)' : 'var(--color-bg-tertiary)'
  const { data, isLoading } = useSWR<StartDateResult | null>(
    'capacity-plain-line',
    fetchStartDate,
    { revalidateOnFocus: false },
  )

  if (isLoading) {
    return (
      <div
        className="tahi-shimmer"
        aria-hidden="true"
        style={{ height: '1.25rem', width: '70%', borderRadius: '0.375rem', background: skeleton }}
      />
    )
  }

  const line = buildCapacityLine({
    totalTeamCapacity: data?.totalTeamCapacity,
    availableHoursPerWeek: data?.availableHoursPerWeek,
    earliestDate: data?.earliestDate,
  })

  return (
    <p
      className={className}
      data-capacity-state={line.state}
      style={{
        margin: 0,
        fontSize: '0.875rem',
        lineHeight: 1.5,
        fontWeight: 600,
        color: line.state === 'unknown' ? muted : strong,
      }}
    >
      {line.text}
    </p>
  )
}
