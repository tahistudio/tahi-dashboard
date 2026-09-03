'use client'

/**
 * <RequestsViewSwitcher>. The four peer views of the Requests surface:
 * List, Kanban, Workload (Tahi only) and Timeline.
 *
 * A thin arrangement of the shared <SegmentedControl>: the sliding pill, the
 * brand-tinted active icon, the full WAI-ARIA tab pattern (roving tabindex,
 * arrows to cycle, Home and End to jump) and the 2.75rem touch targets all
 * come from the primitive. This file only decides which views this audience
 * gets and what each one is called.
 *
 * The label drops below 1024px, where the rail has already collapsed into the
 * Filters sheet and the row is at its most crowded; the name is still carried
 * by `title` and `aria-label`, so the accessible name never changes with the
 * viewport.
 */

import { useMemo } from 'react'
import { BarChart3, CalendarRange, LayoutGrid, Rows } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { SegmentedControl, type SegmentedControlOption } from '@/components/tahi/segmented-control'
import { REQUESTS_VIEW_KEYS, type RequestsAudience, type RequestsViewKey } from '@/lib/requests-views'

const VIEW_META: Record<RequestsViewKey, { label: string; Icon: LucideIcon; adminOnly?: boolean }> = {
  list:     { label: 'List',     Icon: Rows },
  kanban:   { label: 'Kanban',   Icon: LayoutGrid },
  workload: { label: 'Workload', Icon: BarChart3, adminOnly: true },
  timeline: { label: 'Timeline', Icon: CalendarRange },
}

/** The views this audience gets. Workload is a per-teammate cut, so it is
 *  Tahi only. */
export function viewKeysFor(audience: RequestsAudience): RequestsViewKey[] {
  return REQUESTS_VIEW_KEYS.filter(key => !VIEW_META[key].adminOnly || audience === 'admin')
}

export interface RequestsViewSwitcherProps {
  value: RequestsViewKey
  onChange: (next: RequestsViewKey) => void
  audience: RequestsAudience
}

export function RequestsViewSwitcher({ value, onChange, audience }: RequestsViewSwitcherProps) {
  const options = useMemo<SegmentedControlOption<RequestsViewKey>[]>(
    () => viewKeysFor(audience).map(key => {
      const { label, Icon } = VIEW_META[key]
      return { value: key, label, icon: <Icon size={14} aria-hidden="true" /> }
    }),
    [audience],
  )

  return (
    <SegmentedControl<RequestsViewKey>
      role="tablist"
      // The e2e suite and the lead's smoke probes both find this strip by
      // name, so the label is part of the contract, not decoration.
      ariaLabel="Requests view"
      size="sm"
      iconOnlyBelow="lg"
      value={value}
      onChange={onChange}
      options={options}
      className="flex-shrink-0"
    />
  )
}
