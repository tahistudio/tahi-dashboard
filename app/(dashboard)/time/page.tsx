import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { Clock } from 'lucide-react'
export const metadata = { title: 'Time' }
export default async function TimePage() {
  const { orgId } = await getServerAuth()
  if (orgId !== process.env.NEXT_PUBLIC_TAHI_ORG_ID) redirect('/requests')
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Time</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">Log and review hours across all clients and requests.</p>
      </div>
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-16 h-16 brand-gradient flex items-center justify-center mb-4" style={{ borderRadius: 'var(--radius-leaf)' }}>
          <Clock className="w-8 h-8 text-white" />
        </div>
        <h3 className="text-base font-semibold text-[var(--color-text)] mb-2">Time tracking coming in Phase 4</h3>
        <p className="text-sm text-[var(--color-text-muted)] max-w-sm">Log time against requests, view timesheets, and track billable hours here.</p>
      </div>
    </div>
  )
}
