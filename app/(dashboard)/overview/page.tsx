import { clerkClient } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getServerAuth } from '@/lib/server-auth'
import { AdminOverview, ClientOverview } from './overview-content'

export default async function OverviewPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')

  // Fetch user name directly via Clerk backend (avoids currentUser() middleware dependency)
  let userName = ''
  try {
    const clerk = await clerkClient()
    const user = await clerk.users.getUser(userId)
    userName = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim()
  } catch {
    // non-fatal — just show no name
  }

  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID

  // For client portal: get org name via Clerk client API
  let orgName = 'Your workspace'
  if (!isAdmin && orgId) {
    try {
      const clerk = await clerkClient()
      const org = await clerk.organizations.getOrganization({ organizationId: orgId })
      orgName = org.name
    } catch {
      orgName = 'Your workspace'
    }
  }

  if (isAdmin) {
    return <AdminOverview userName={userName} />
  }

  return <ClientOverview userName={userName} orgName={orgName} />
}
