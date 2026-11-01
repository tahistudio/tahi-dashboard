'use client'

/**
 * CapacityPlainLine - one plain-words sentence about studio room, such as
 * "Free about 60 hours a month, can start 8 Sep".
 *
 * Takes the weekly figures the owner capacity card already holds
 * (/api/admin/pipeline/capacity: totalCapacity and availableCapacity), so it
 * fetches nothing and always agrees with the gauge beside it. The wording
 * lives in lib/capacity-plain-line.ts.
 */

import { buildCapacityLineFromWeek } from '@/lib/capacity-plain-line'

export function CapacityPlainLine({
  totalCapacity,
  availableCapacity,
}: {
  totalCapacity: number | null | undefined
  availableCapacity: number | null | undefined
}) {
  const line = buildCapacityLineFromWeek(totalCapacity, availableCapacity)

  return (
    <p
      data-capacity-state={line.state}
      style={{
        margin: 0,
        fontSize: '0.875rem',
        lineHeight: 1.5,
        fontWeight: 600,
        color: line.state === 'unknown' ? 'var(--text-muted)' : 'var(--text)',
      }}
    >
      {line.text}
    </p>
  )
}
