import { clerkClient } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getServerAuth } from '@/lib/server-auth'
import { OverviewSwitcher, ClientOverview } from './overview-content'
import { ErrorBoundary } from '@/components/tahi/error-boundary'

export const metadata = { title: 'Overview - Tahi Dashboard' }

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
    // non-fatal: just show no name
  }

  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID

  // Get org name via Clerk (used for client portal and impersonation)
  let orgName = 'Your workspace'
  if (orgId) {
    try {
      const clerk = await clerkClient()
      const org = await clerk.organizations.getOrganization({ organizationId: orgId })
      orgName = org.name
    } catch {
      orgName = 'Your workspace'
    }
  }

  if (isAdmin) {
    return (
      <ErrorBoundary fallbackTitle="Overview failed to load">
        <OverviewSwitcher userName={userName} orgName={orgName} />
      </ErrorBoundary>
    )
  }

  return (
    <ErrorBoundary fallbackTitle="Overview failed to load">
      <ClientOverview userName={userName} orgName={orgName} />
    </ErrorBoundary>
  )
}
