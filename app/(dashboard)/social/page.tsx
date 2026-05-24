import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { SocialContent } from './social-content'

export const metadata = { title: 'Social — Tahi Dashboard' }

export default async function SocialPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID
  if (!isAdmin) redirect('/overview')
  return <SocialContent />
}
