import { Suspense } from 'react'
import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { requirePageFeature } from '@/lib/page-guard'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'
import { TasksContent } from './tasks-content'

export const metadata = { title: 'Tasks - Tahi Dashboard' }

/**
 * Tasks are the studio's own list and are never client-visible: every task
 * API is isTahiAdmin-gated, and lib/feature-tree.ts scopes the `tasks`
 * feature to ['team']. A client org that reaches this route used to land on
 * a permanent empty state built out of unreachable branches; it now goes
 * somewhere it can actually use.
 */
export default async function TasksPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  if (orgId !== process.env.NEXT_PUBLIC_TAHI_ORG_ID) redirect('/overview')
  await requirePageFeature('tasks')
  // TasksContent reads `?task=` through useSearchParams, which Next requires
  // to sit under a Suspense boundary. The Requests page mounts its shell the
  // same way for the same reason.
  return (
    <Suspense fallback={<LoadingSkeleton rows={5} />}>
      <TasksContent />
    </Suspense>
  )
}
