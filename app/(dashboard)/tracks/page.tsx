import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { TracksContent } from './tracks-content'

export const metadata = { title: 'Track Queue - Tahi Dashboard' }

export default async function TracksPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID
  return <TracksContent isAdmin={isAdmin} />
}
