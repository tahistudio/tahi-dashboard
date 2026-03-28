import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { SettingsContent } from './settings-content'

export const metadata = { title: 'Settings -- Tahi Dashboard' }

export default async function SettingsPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')

  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID

  return <SettingsContent isAdmin={isAdmin} />
}
