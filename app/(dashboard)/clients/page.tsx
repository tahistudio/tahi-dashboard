import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Users, Plus, Search } from 'lucide-react'

export const metadata = { title: 'Clients' }

export default async function ClientsPage() {
  const { orgId } = await auth()
  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID

  // Belt-and-braces: middleware handles this, but double-check server-side
  if (!isAdmin) redirect('/requests')

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Clients</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            All client organisations and their current status.
          </p>
        </div>
        <button
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity flex-shrink-0"
          style={{ background: 'var(--color-brand)', borderRadius: 'var(--radius-leaf-sm)' }}
        >
          <Plus className="w-4 h-4" />
          Add client
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-subtle)]" />
        <input
          type="text"
          placeholder="Search clients..."
          className="w-full pl-9 pr-4 py-2.5 text-sm bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg focus:outline-none focus:border-[var(--color-brand)] transition-colors placeholder:text-[var(--color-text-subtle)]"
        />
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-2 flex-wrap">
        {['All', 'Active', 'Maintain', 'Scale', 'Project', 'Paused', 'Churned'].map((f, i) => (
          <button
            key={f}
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
              i === 0
                ? 'bg-[var(--color-brand)] text-white'
                : 'bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-brand)] hover:text-[var(--color-brand-dark)]'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Empty state */}
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div
          className="w-16 h-16 brand-gradient flex items-center justify-center mb-4"
          style={{ borderRadius: 'var(--radius-leaf)' }}
        >
          <Users className="w-8 h-8 text-white" />
        </div>
        <h3 className="text-base font-semibold text-[var(--color-text)] mb-2">No clients yet</h3>
        <p className="text-sm text-[var(--color-text-muted)] max-w-sm">
          Add your first client to get started. They will receive an invite email to access their portal.
        </p>
        <button
          className="mt-5 px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
          style={{ background: 'var(--color-brand)', borderRadius: 'var(--radius-leaf-sm)' }}
        >
          Add first client
        </button>
      </div>
    </div>
  )
}
