import { getViewAudience } from '@/lib/view-audience'
import { redirect } from 'next/navigation'
import { requirePageFeature } from '@/lib/page-guard'

export const metadata = { title: 'Settings - Tahi Dashboard' }

// Legacy route. The old standalone page was superseded by the in-shell
// settings section; keep the URL alive for old links and search results.
export default async function LegacyRedirectPage() {
  const { userId, isAdmin, isPreviewingClient } = await getViewAudience()
  if (!userId) redirect('/sign-in')
  // Studio-only surface. Client view (the tahi-impersonate-org cookie) leaves
  // it the same way a real client does, so a preview cannot show one client
  // another client's work. See lib/view-audience.ts.
  if (!isAdmin || isPreviewingClient) redirect('/overview')
  await requirePageFeature('settings')
  redirect('/settings?section=automations')
}
