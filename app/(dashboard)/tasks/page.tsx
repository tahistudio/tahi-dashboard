import { getServerAuth } from '@/lib/server-auth'
import { CheckSquare } from 'lucide-react'
export const metadata = { title: 'Tasks' }
export default async function TasksPage() {
  const { orgId } = await getServerAuth()
  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Tasks</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">
          {isAdmin ? 'All tasks — client-facing, internal, and Tahi Studio.' : 'Tasks assigned to you by the Tahi team.'}
        </p>
      </div>
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-16 h-16 brand-gradient flex items-center justify-center mb-4" style={{ borderRadius: 'var(--radius-leaf)' }}>
          <CheckSquare className="w-8 h-8 text-white" />
        </div>
        <h3 className="text-base font-semibold text-[var(--color-text)] mb-2">No tasks yet</h3>
        <p className="text-sm text-[var(--color-text-muted)] max-w-sm">Tasks will appear here once created.</p>
      </div>
    </div>
  )
}
