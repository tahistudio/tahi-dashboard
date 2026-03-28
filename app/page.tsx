import { redirect } from 'next/navigation'
import { getServerAuth } from '@/lib/server-auth'

/**
 * Root route: redirect to the appropriate home page.
 * The actual overview content lives at /overview (app/(dashboard)/overview/page.tsx)
 * so it picks up the sidebar + topnav layout.
 */
export default async function RootPage() {
  const { userId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  redirect('/overview')
}
