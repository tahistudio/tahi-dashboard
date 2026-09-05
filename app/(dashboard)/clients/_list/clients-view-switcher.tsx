'use client'

/**
 * <ClientsViewSwitcher>. The two peer views of the Clients surface: the dense
 * List and the portfolio Cards lens.
 *
 * A thin arrangement of the shared <SegmentedControl>: the sliding pill, the
 * brand-tinted active icon, the full WAI-ARIA tab pattern and the 2.75rem
 * touch targets all come from the primitive. This file only names the views.
 *
 * The label drops below 1024px, where the rail has already collapsed into the
 * Filters sheet and the row is at its most crowded; the name is still carried
 * by `title` and `aria-label`, so the accessible name never changes with the
 * viewport.
 */

import { useMemo } from 'react'
import { LayoutGrid, Rows } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { SegmentedControl, type SegmentedControlOption } from '@/components/tahi/segmented-control'
import { CLIENTS_VIEW_KEYS, type ClientsViewKey } from './clients-views'

const VIEW_META: Record<ClientsViewKey, { label: string; Icon: LucideIcon }> = {
  list: { label: 'List', Icon: Rows },
  cards: { label: 'Cards', Icon: LayoutGrid },
}

/** The id of the region the switcher swaps. The shell puts it on the
 *  tabpanel wrapper, so the two cannot drift. */
export const CLIENTS_VIEW_PANEL_ID = 'clients-view-panel'

export function ClientsViewSwitcher({
  value,
  onChange,
}: {
  value: ClientsViewKey
  onChange: (next: ClientsViewKey) => void
}) {
  const options = useMemo<SegmentedControlOption<ClientsViewKey>[]>(
    () => CLIENTS_VIEW_KEYS.map(key => {
      const { label, Icon } = VIEW_META[key]
      return { value: key, label, icon: <Icon size={14} aria-hidden="true" />, panelId: CLIENTS_VIEW_PANEL_ID }
    }),
    [],
  )

  return (
    <SegmentedControl<ClientsViewKey>
      role="tablist"
      ariaLabel="Clients view"
      size="sm"
      iconOnlyBelow="lg"
      value={value}
      onChange={onChange}
      options={options}
      className="flex-shrink-0"
    />
  )
}
