import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { requirePageFeature } from '@/lib/page-guard'

export const metadata = { title: 'Task - Tahi Dashboard' }

interface Props {
  params: Promise<{ id: string }>
}

/**
 * There is exactly one canonical task detail: the slide-over on /tasks. This
 * former full-page detail dead-ended (its API had no GET), so the route now
 * redirects to /tasks?task=<id>, which deep-opens the slide-over on load.
 */
export default async function TaskDetailPage({ params }: Props) {
  const { userId } = await getServerAuth()
  if (!userId) redirect('/sign-in')

  await requirePageFeature('tasks')
  const { id } = await params
  redirect(`/tasks?task=${encodeURIComponent(id)}`)
}
