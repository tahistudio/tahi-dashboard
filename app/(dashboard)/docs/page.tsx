import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { BookOpen } from 'lucide-react'
export const metadata = { title: 'Docs Hub' }
export default async function DocsPage() {
  const { orgId } = await getServerAuth()
  if (orgId !== process.env.NEXT_PUBLIC_TAHI_ORG_ID) redirect('/requests')
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Docs Hub</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">Tahi Studio internal knowledge base — brand, services, sales, and operations.</p>
      </div>
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-16 h-16 brand-gradient flex items-center justify-center mb-4" style={{ borderRadius: 'var(--radius-leaf)' }}>
          <BookOpen className="w-8 h-8 text-white" />
        </div>
        <h3 className="text-base font-semibold text-[var(--color-text)] mb-2">Knowledge hub coming in Phase 6</h3>
        <p className="text-sm text-[var(--color-text-muted)] max-w-sm">All your Tahi docs — brand guide, service structure, sales scripts — searchable and versioned, right here.</p>
      </div>
    </div>
  )
}
