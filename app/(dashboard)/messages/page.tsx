import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { MessagesContent } from './messages-content'

export const metadata = { title: 'Messages' }

export default async function MessagesPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID
  return <MessagesContent isAdmin={isAdmin} />
}
