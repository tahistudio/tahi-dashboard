import { getViewAudience } from '@/lib/view-audience'
import { redirect } from 'next/navigation'
import { requirePageFeature } from '@/lib/page-guard'
import { ContractDetail } from './contract-detail'

export const metadata = { title: 'Contract — Tahi Dashboard' }

export default async function ContractDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { userId, isAdmin, isPreviewingClient } = await getViewAudience()
  if (!userId) redirect('/sign-in')
  // Studio-only surface. Client view (the tahi-impersonate-org cookie) leaves
  // it the same way a real client does, so a preview cannot show one client
  // another client's work. See lib/view-audience.ts.
  if (!isAdmin || isPreviewingClient) redirect('/requests')
  await requirePageFeature('contracts')
  const { id } = await params
  return <ContractDetail id={id} />
}
