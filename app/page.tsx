import { redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'

export default async function RootPage() {
  const { userId, orgId } = await auth()

  if (!userId) {
    redirect('/sign-in')
  }

  // Admin org ID is set via NEXT_PUBLIC_TAHI_ORG_ID env var
  // If user belongs to Tahi org → admin dashboard
  // Otherwise → client portal
  const tahiOrgId = process.env.NEXT_PUBLIC_TAHI_ORG_ID
  if (orgId === tahiOrgId) {
    redirect('/admin')
  }

  redirect('/portal')
}
