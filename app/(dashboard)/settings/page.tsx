import { getViewAudience } from '@/lib/view-audience'
import { redirect } from 'next/navigation'
import { requirePageFeature } from '@/lib/page-guard'
import { SettingsContent } from './settings-content'

export const metadata = { title: 'Settings - Tahi Dashboard' }

export default async function SettingsPage() {
  const { userId, isAdmin, isPreviewingClient } = await getViewAudience()
  if (!userId) redirect('/sign-in')

  // Client view (the tahi-impersonate-org cookie) renders the CLIENT settings
  // IA, never the studio workspace settings (which name every other client).
  // See lib/view-audience.ts.
  const studio = isAdmin && !isPreviewingClient

  // Team members whose role denies the settings surface are redirected (the
  // sidebar hiding is cosmetic; this is the real gate). Clients skip the check:
  // the 'settings' feature key is team-audience, and the client settings IA
  // (profile, org, plan) is always theirs.
  if (studio) await requirePageFeature('settings')

  return <SettingsContent isAdmin={studio} />
}
