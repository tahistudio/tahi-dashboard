import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { requirePageFeature } from '@/lib/page-guard'
import { SettingsContent } from './settings-content'

export const metadata = { title: 'Settings - Tahi Dashboard' }

export default async function SettingsPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')

  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID

  // Team members whose role denies the settings surface are redirected (the
  // sidebar hiding is cosmetic; this is the real gate). Clients skip the check:
  // the 'settings' feature key is team-audience, and the client settings IA
  // (profile, org, plan) is always theirs.
  if (isAdmin) await requirePageFeature('settings')

  return <SettingsContent isAdmin={isAdmin} />
}
