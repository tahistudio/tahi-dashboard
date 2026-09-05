import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { requirePageFeature } from '@/lib/page-guard'

export const metadata = { title: 'Task - Tahi Dashboard' }

interface Props {
  params: Promise<{ id: string }>
}

/**
 * There is exactly one canonical task detail: the slide-over on /tasks. This
 * route stays as the deep link every notification and bookmark points at
 * (lib/notification-links.ts routes `task` here), redirecting to
 * /tasks?task=<id>, which deep-opens the panel on load.
 */
export default async function TaskDetailPage({ params }: Props) {
  const { userId } = await getServerAuth()
  if (!userId) redirect('/sign-in')

  await requirePageFeature('tasks')
  const { id } = await params
  redirect(`/tasks?task=${encodeURIComponent(id)}`)
}
