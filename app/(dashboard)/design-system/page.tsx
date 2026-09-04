import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { requirePageAnyGrant } from '@/lib/page-guard'
import { DesignSystemContent } from './design-system-content'

export const metadata = { title: 'Design system - Tahi Dashboard' }

export default async function DesignSystemPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  if (orgId !== process.env.NEXT_PUBLIC_TAHI_ORG_ID) redirect('/overview')
  // No FEATURE_TREE key of its own: gate on holding any grant so a roleless
  // team member cannot use it as a way in.
  await requirePageAnyGrant()

  return <DesignSystemContent />
}
