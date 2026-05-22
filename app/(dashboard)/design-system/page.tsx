import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { DesignSystemContent } from './design-system-content'

export const metadata = { title: 'Design system - Tahi Dashboard' }

export default async function DesignSystemPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  if (orgId !== process.env.NEXT_PUBLIC_TAHI_ORG_ID) redirect('/overview')

  return <DesignSystemContent />
}
