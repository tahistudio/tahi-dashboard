import { getServerAuth } from '@/lib/server-auth'
import { MessageSquare } from 'lucide-react'
export const metadata = { title: 'Messages' }
export default async function MessagesPage() {
  const { orgId } = await getServerAuth()
  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Messages</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">
          {isAdmin ? 'Direct messages with all clients.' : 'Direct messages with the Tahi team.'}
        </p>
      </div>
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-16 h-16 brand-gradient flex items-center justify-center mb-4" style={{ borderRadius: 'var(--radius-leaf)' }}>
          <MessageSquare className="w-8 h-8 text-white" />
        </div>
        <h3 className="text-base font-semibold text-[var(--color-text)] mb-2">No messages yet</h3>
        <p className="text-sm text-[var(--color-text-muted)] max-w-sm">Start a conversation to get things moving.</p>
      </div>
    </div>
  )
}
