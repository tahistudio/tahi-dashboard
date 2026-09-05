import { getViewAudience } from '@/lib/view-audience'
import { redirect } from 'next/navigation'
import { requirePageFeature } from '@/lib/page-guard'
import { CalculatorContent } from './calculator-content'

export const metadata = { title: 'Project calculator — Tahi Dashboard' }

export default async function CalculatorPage({
  searchParams,
}: {
  searchParams: Promise<{ dealId?: string; orgId?: string }>
}) {
  const { userId, isAdmin, isPreviewingClient } = await getViewAudience()
  if (!userId) redirect('/sign-in')
  // Studio-only surface. Client view (the tahi-impersonate-org cookie) leaves
  // it the same way a real client does, so a preview cannot show one client
  // another client's work. See lib/view-audience.ts.
  if (!isAdmin || isPreviewingClient) redirect('/requests')
  await requirePageFeature('calculator')
  const sp = await searchParams
  return <CalculatorContent dealId={sp.dealId ?? null} orgId={sp.orgId ?? null} />
}
