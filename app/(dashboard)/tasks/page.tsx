import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { TasksContent } from './tasks-content'

export const metadata = { title: 'Tasks - Tahi Dashboard' }

export default async function TasksPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID
  return <TasksContent isAdmin={isAdmin} />
}
