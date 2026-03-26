import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { ShoppingBag } from 'lucide-react'
export const metadata = { title: 'Services' }
export default async function ServicesPage() {
  const { orgId } = await getServerAuth()
  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID
  if (isAdmin) redirect('/requests')
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Services</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">Your current plan and available add-ons.</p>
      </div>
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-16 h-16 brand-gradient flex items-center justify-center mb-4" style={{ borderRadius: 'var(--radius-leaf)' }}>
          <ShoppingBag className="w-8 h-8 text-white" />
        </div>
        <h3 className="text-base font-semibold text-[var(--color-text)] mb-2">Service catalogue coming soon</h3>
        <p className="text-sm text-[var(--color-text-muted)] max-w-sm">View your current plan, available add-ons, and request upgrades here.</p>
      </div>
    </div>
  )
}
