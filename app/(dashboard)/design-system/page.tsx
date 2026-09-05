import { getViewAudience } from '@/lib/view-audience'
import { redirect } from 'next/navigation'
import { requirePageAnyGrant } from '@/lib/page-guard'
import { DesignSystemContent } from './design-system-content'

export const metadata = { title: 'Design system - Tahi Dashboard' }

export default async function DesignSystemPage() {
  const { userId, isAdmin, isPreviewingClient } = await getViewAudience()
  if (!userId) redirect('/sign-in')
  // Studio-only surface. Client view (the tahi-impersonate-org cookie) leaves
  // it the same way a real client does, so a preview cannot show one client
  // another client's work. See lib/view-audience.ts.
  if (!isAdmin || isPreviewingClient) redirect('/overview')
  // No FEATURE_TREE key of its own: gate on holding any grant so a roleless
  // team member cannot use it as a way in.
  await requirePageAnyGrant()

  return <DesignSystemContent />
}
