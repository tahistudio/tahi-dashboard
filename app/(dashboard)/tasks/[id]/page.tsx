import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { TaskDetail } from './task-detail'
import { ErrorBoundary } from '@/components/tahi/error-boundary'

export const metadata = { title: 'Task Detail - Tahi Dashboard' }

interface Props {
  params: Promise<{ id: string }>
}

export default async function TaskDetailPage({ params }: Props) {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')

  const { id } = await params
  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID

  return (
    <ErrorBoundary fallbackTitle="Task failed to load">
      <TaskDetail
        taskId={id}
        isAdmin={isAdmin}
        currentUserId={userId}
      />
    </ErrorBoundary>
  )
}
