/**
 * Which rows the mobile top-bar "More" sheet offers, and in what order.
 *
 * Pure data. The sheet component (components/tahi/top-bar-more.tsx) maps each
 * id onto a real control, so this module can be reasoned about and tested
 * without React. Keeping the list here is what stops the sheet drifting out of
 * sync with the bar: everything the bar drops below md has to show up here.
 */

/** Every control the sheet can host. */
export type MoreItemId =
  | 'timer'
  | 'brief'
  | 'currency'
  | 'theme'
  | 'privateMode'
  | 'clientView'
  | 'settings'
  | 'signOut'

export type MoreSectionId = 'tools' | 'preferences' | 'account'

export interface MoreSection {
  id: MoreSectionId
  /** Group heading rendered above the rows. */
  label: string
  items: MoreItemId[]
}

export interface MoreSheetContext {
  /** Studio session AND not currently previewing the portal as a client. */
  showAsAdmin: boolean
  /** Server-resolved super admin (usePermissions). Gates the preview controls. */
  isSuperAdmin: boolean
}

/**
 * Build the sheet's sections for a viewer.
 *
 * Rules:
 *  - Studio-only tools (time tracker, daily brief) appear only for a studio
 *    session that is not previewing the portal, mirroring the rail.
 *  - Private mode and Client view are super-admin only, mirroring the rail's
 *    account menu.
 *  - Preferences and Account always render, because below md the sheet is the
 *    only place a phone can reach theme, settings or sign out.
 *  - Empty sections are dropped so the sheet never shows a bare heading.
 */
export function buildMoreSections({ showAsAdmin, isSuperAdmin }: MoreSheetContext): MoreSection[] {
  const tools: MoreItemId[] = showAsAdmin ? ['timer', 'brief'] : []

  const preferences: MoreItemId[] = ['currency', 'theme']
  if (isSuperAdmin) preferences.push('privateMode', 'clientView')

  const account: MoreItemId[] = ['settings', 'signOut']

  const sections: MoreSection[] = [
    { id: 'tools', label: 'Tools', items: tools },
    { id: 'preferences', label: 'Preferences', items: preferences },
    { id: 'account', label: 'Account', items: account },
  ]

  return sections.filter(s => s.items.length > 0)
}

/** Flat id list, handy for assertions and for "does the sheet own X" checks. */
export function moreSheetItemIds(ctx: MoreSheetContext): MoreItemId[] {
  return buildMoreSections(ctx).flatMap(s => s.items)
}
