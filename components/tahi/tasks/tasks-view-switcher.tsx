'use client'

/**
 * <TasksViewSwitcher>. The three peer views of the Tasks surface: List,
 * Board and My week.
 *
 * A thin arrangement of the shared <SegmentedControl>: the sliding pill, the
 * brand-tinted active icon, the full WAI-ARIA tab pattern and the 2.75rem
 * touch targets all come from the primitive. This file only names the views.
 *
 * The label drops below 1024px, where the rail has already collapsed into
 * the Filters sheet and the row is at its most crowded; the name is still
 * carried by `title` and `aria-label`, so the accessible name never changes
 * with the viewport.
 *
 * Unlike the Requests switcher, every option carries `panelId`. The region
 * this strip swaps is three lines away in tasks-content.tsx, wrapped in a
 * matching `role="tabpanel"`, so the `aria-controls` it emits points at an
 * element that is really in the document.
 */

import { useMemo } from 'react'
import { CalendarRange, LayoutGrid, Rows } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { SegmentedControl, type SegmentedControlOption } from '@/components/tahi/segmented-control'
import { TASKS_VIEW_KEYS, type TasksViewKey } from '@/lib/tasks-views'

const VIEW_META: Record<TasksViewKey, { label: string; Icon: LucideIcon }> = {
  list:  { label: 'List',    Icon: Rows },
  board: { label: 'Board',   Icon: LayoutGrid },
  week:  { label: 'My week', Icon: CalendarRange },
}

/** The id of the region the switcher swaps. The shell puts it on the
 *  tabpanel wrapper, so the two cannot drift. */
export const TASKS_VIEW_PANEL_ID = 'tasks-view-panel'

export interface TasksViewSwitcherProps {
  value: TasksViewKey
  onChange: (next: TasksViewKey) => void
}

export function TasksViewSwitcher({ value, onChange }: TasksViewSwitcherProps) {
  const options = useMemo<SegmentedControlOption<TasksViewKey>[]>(
    () => TASKS_VIEW_KEYS.map(key => {
      const { label, Icon } = VIEW_META[key]
      return { value: key, label, icon: <Icon size={14} aria-hidden="true" />, panelId: TASKS_VIEW_PANEL_ID }
    }),
    [],
  )

  return (
    <SegmentedControl<TasksViewKey>
      role="tablist"
      // The e2e suite finds this strip by name, so the label is part of the
      // contract, not decoration.
      ariaLabel="Tasks view"
      size="sm"
      iconOnlyBelow="lg"
      value={value}
      onChange={onChange}
      options={options}
      className="flex-shrink-0"
    />
  )
}
