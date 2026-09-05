import { getViewAudience } from '@/lib/view-audience'
import { redirect } from 'next/navigation'
import { requirePageFeature } from '@/lib/page-guard'

export const metadata = { title: 'Messages - Tahi Dashboard' }

// Messaging is hidden for V1: the product is client-facing requests + internal
// tasks. All conversation APIs, components, and messages-content.tsx stay
// intact. Restore by re-adding the nav items (nav-model.tsx and
// mobile-bottom-nav.tsx) and rendering <MessagesContent> here again.
export default async function MessagesPage() {
  const { userId, isAdmin, isPreviewingClient } = await getViewAudience()
  if (!userId) redirect('/sign-in')
  await requirePageFeature('messages')
  // Client view lands exactly where a real client lands.
  redirect(isAdmin && !isPreviewingClient ? '/overview' : '/requests')
}
