'use client'

import { SettingsShell } from '@/components/tahi/settings/settings-shell'

/**
 * Settings page content. The page.tsx server component computes `isAdmin`
 * (orgId === NEXT_PUBLIC_TAHI_ORG_ID) and passes it here. All rendering now
 * lives in SettingsShell, which owns the sub-nav, the mobile section picker,
 * and the per-section registry. The previous inline sections were superseded
 * by the dedicated files under components/tahi/settings/sections.
 */
export function SettingsContent({ isAdmin }: { isAdmin: boolean }) {
  return <SettingsShell isAdmin={isAdmin} />
}
