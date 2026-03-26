import { getServerAuth } from '@/lib/server-auth'
import { FileText } from 'lucide-react'
export const metadata = { title: 'Invoices' }
export default async function InvoicesPage() {
  const { orgId } = await getServerAuth()
  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Invoices</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">
          {isAdmin ? 'All invoices across every client.' : 'Your invoice history and outstanding payments.'}
        </p>
      </div>
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-16 h-16 brand-gradient flex items-center justify-center mb-4" style={{ borderRadius: 'var(--radius-leaf)' }}>
          <FileText className="w-8 h-8 text-white" />
        </div>
        <h3 className="text-base font-semibold text-[var(--color-text)] mb-2">No invoices yet</h3>
        <p className="text-sm text-[var(--color-text-muted)] max-w-sm">{isAdmin ? 'Create your first invoice to get started.' : 'Invoices from Tahi Studio will appear here.'}</p>
      </div>
    </div>
  )
}
