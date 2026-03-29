import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { PipelineContent } from './pipeline-content'

export const metadata = { title: 'Sales Pipeline - Tahi Dashboard' }

export default async function PipelinePage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')

  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID
  if (!isAdmin) redirect('/overview')

  return <PipelineContent />
}
