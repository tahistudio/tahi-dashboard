import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { UserCog } from 'lucide-react'
export const metadata = { title: 'Team' }
export default async function TeamPage() {
  const { orgId } = await auth()
  if (orgId !== process.env.NEXT_PUBLIC_TAHI_ORG_ID) redirect('/requests')
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Team</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">Team members, roles, capacity, and assignments.</p>
      </div>
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-16 h-16 brand-gradient flex items-center justify-center mb-4" style={{ borderRadius: 'var(--radius-leaf)' }}>
          <UserCog className="w-8 h-8 text-white" />
        </div>
        <h3 className="text-base font-semibold text-[var(--color-text)] mb-2">Team management coming in Phase 6</h3>
        <p className="text-sm text-[var(--color-text-muted)] max-w-sm">Manage team members, set capacity, and assign roles here.</p>
      </div>
    </div>
  )
}
