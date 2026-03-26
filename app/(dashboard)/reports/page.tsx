import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { BarChart2 } from 'lucide-react'
export const metadata = { title: 'Reports' }
export default async function ReportsPage() {
  const { orgId } = await getServerAuth()
  if (orgId !== process.env.NEXT_PUBLIC_TAHI_ORG_ID) redirect('/requests')
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Reports</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">Revenue, request throughput, track utilisation, and client health.</p>
      </div>
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-16 h-16 brand-gradient flex items-center justify-center mb-4" style={{ borderRadius: 'var(--radius-leaf)' }}>
          <BarChart2 className="w-8 h-8 text-white" />
        </div>
        <h3 className="text-base font-semibold text-[var(--color-text)] mb-2">Reports coming in Phase 5</h3>
        <p className="text-sm text-[var(--color-text-muted)] max-w-sm">Revenue charts, client health, and carbon offset tracker will live here.</p>
      </div>
    </div>
  )
}
