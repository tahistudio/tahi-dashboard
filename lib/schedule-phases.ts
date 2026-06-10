/**
 * lib/schedule-phases.ts
 * Client-side helper for the "Delivery phase" selectors (delivery spine #148).
 *
 * Fetches an org's schedules with their deliverable gantt rows and flattens
 * them into SearchableSelect-shaped options. Shared by request detail and the
 * task panel so the two pickers stay identical.
 */

import { apiPath } from '@/lib/api'

export interface SchedulePhaseOption {
  value: string
  label: string
  subtitle?: string
}

interface ScheduleWithRows {
  id: string
  title: string
  rows: Array<{
    id: string
    label: string
    startWeek: number | null
    endWeek: number | null
    sectionTitle: string | null
  }>
}

export async function fetchSchedulePhaseOptions(orgId: string): Promise<SchedulePhaseOption[]> {
  const res = await fetch(apiPath(`/api/admin/schedules?orgId=${encodeURIComponent(orgId)}&includeRows=1`))
  if (!res.ok) return []
  const json = await res.json() as { items?: ScheduleWithRows[] }
  const options: SchedulePhaseOption[] = []
  for (const schedule of json.items ?? []) {
    for (const row of schedule.rows ?? []) {
      const weeks = row.startWeek != null
        ? ` W${row.startWeek}${row.endWeek != null && row.endWeek !== row.startWeek ? `-${row.endWeek}` : ''}`
        : ''
      options.push({
        value: row.id,
        label: row.label,
        subtitle: `${schedule.title}${weeks}`,
      })
    }
  }
  return options
}
