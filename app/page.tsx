import { redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'

/**
 * Root page = /dashboard (basePath handles the prefix)
 * Unauthenticated → sign-in
 * Authenticated → /requests (universal home for both admin and clients)
 */
export default async function RootPage() {
  const { userId } = await auth()

  if (!userId) {
    redirect('/sign-in')
  }

  // Both admins and clients land on /requests as their home.
  // The page itself detects role and renders the appropriate view.
  redirect('/requests')
}
