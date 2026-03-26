import { redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'

/**
 * Root route — redirect to the appropriate home page.
 * The actual overview content lives at /overview (app/(dashboard)/overview/page.tsx)
 * so it picks up the sidebar + topnav layout.
 */
export default async function RootPage() {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')
  redirect('/overview')
}
