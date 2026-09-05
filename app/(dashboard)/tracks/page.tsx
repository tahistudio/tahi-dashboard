import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { requirePageFeature, requirePageAnyGrant } from '@/lib/page-guard'
import { TracksContent } from './tracks-content'

export const metadata = { title: 'Track Queue - Tahi Dashboard' }

export default async function TracksPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID

  // 'tracks' is a client-audience feature: gate the client on it, and the
  // studio side on holding any grant (a roleless team member sees nothing).
  if (isAdmin) await requirePageAnyGrant()
  else await requirePageFeature('tracks')

  return <TracksContent isAdmin={isAdmin} />
}
