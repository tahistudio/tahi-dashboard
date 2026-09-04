import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { requirePageFeature } from '@/lib/page-guard'

export const metadata = { title: 'Messages - Tahi Dashboard' }

// Messaging is hidden for V1: the product is client-facing requests + internal
// tasks. All conversation APIs, components, and messages-content.tsx stay
// intact. Restore by re-adding the nav items (nav-model.tsx and
// mobile-bottom-nav.tsx) and rendering <MessagesContent> here again.
export default async function MessagesPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID
  await requirePageFeature('messages')
  redirect(isAdmin ? '/overview' : '/requests')
}
