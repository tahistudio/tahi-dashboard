import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { ReviewsContent } from './reviews-content'

export const metadata = { title: 'Reviews and Testimonials - Tahi Dashboard' }

export default async function ReviewsPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID
  if (!isAdmin) redirect('/overview')
  return <ReviewsContent />
}
