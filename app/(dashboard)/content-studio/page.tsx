import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { requirePageFeature } from '@/lib/page-guard'
import { ContentStudioContent } from './content-studio-content'

export const metadata = { title: 'Content studio — Tahi Dashboard' }

export default async function ContentStudioPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID
  if (!isAdmin) redirect('/overview')
  // Granular permissions: a team member denied content_studio is redirected.
  await requirePageFeature('content_studio')
  return <ContentStudioContent />
}
