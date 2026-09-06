import { getViewAudience } from '@/lib/view-audience'
import { redirect } from 'next/navigation'
import { requirePageFeature } from '@/lib/page-guard'
import { BillingContent } from './billing-content'

export const metadata = { title: 'Billing - Tahi Dashboard' }

export default async function BillingPage() {
  const { userId, isAdmin, isPreviewingClient } = await getViewAudience()
  if (!userId) redirect('/sign-in')
  // Client view (the tahi-impersonate-org cookie) renders the CLIENT branch:
  // the studio branch lists every client's plan and money, which is the last
  // thing a preview of one client's portal should paint. See lib/view-audience.
  const studio = isAdmin && !isPreviewingClient
  if (studio) await requirePageFeature('billing')
  return <BillingContent isAdmin={studio} />
}
