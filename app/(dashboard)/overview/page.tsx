import { auth, currentUser, clerkClient } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { AdminOverview, ClientOverview } from './overview-content'

export default async function OverviewPage() {
  const { userId, orgId, orgSlug } = await auth()
  if (!userId) redirect('/sign-in')

  const user = await currentUser()
  const userName = user ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() : ''
  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID

  // For client portal: get org name via Clerk client API
  let orgName = 'Your workspace'
  if (!isAdmin && orgId) {
    try {
      const clerk = await clerkClient()
      const org = await clerk.organizations.getOrganization({ organizationId: orgId })
      orgName = org.name
    } catch {
      orgName = orgSlug ?? 'Your workspace'
    }
  }

  if (isAdmin) {
    return <AdminOverview userName={userName} />
  }

  return <ClientOverview userName={userName} orgName={orgName} />
}
