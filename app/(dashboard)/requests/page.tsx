import { auth } from '@clerk/nextjs/server'
import { Inbox, Plus, Filter } from 'lucide-react'

export const metadata = { title: 'Requests' }

export default async function RequestsPage() {
  const { orgId } = await auth()
  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Requests</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            {isAdmin
              ? 'All client requests across every active account.'
              : 'Your submitted requests and their current status.'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)] transition-colors"
          >
            <Filter className="w-4 h-4" />
            <span className="hidden sm:inline">Filter</span>
          </button>
          <button
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            style={{
              background: 'var(--color-brand)',
              borderRadius: 'var(--radius-leaf-sm)',
            }}
          >
            <Plus className="w-4 h-4" />
            {isAdmin ? 'New request' : 'Submit request'}
          </button>
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex items-center gap-1 border-b border-[var(--color-border)]">
        {['All', 'In progress', 'In review', 'Delivered', 'Archived'].map((tab, i) => (
          <button
            key={tab}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              i === 0
                ? 'border-[var(--color-brand)] text-[var(--color-brand-dark)]'
                : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Empty state */}
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div
          className="w-16 h-16 brand-gradient flex items-center justify-center mb-4"
          style={{ borderRadius: 'var(--radius-leaf)' }}
        >
          <Inbox className="w-8 h-8 text-white" />
        </div>
        <h3 className="text-base font-semibold text-[var(--color-text)] mb-2">
          No requests yet
        </h3>
        <p className="text-sm text-[var(--color-text-muted)] max-w-sm">
          {isAdmin
            ? 'Requests will appear here once clients start submitting work.'
            : "Submit your first request and we'll get started."}
        </p>
        {!isAdmin && (
          <button
            className="mt-5 px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
            style={{
              background: 'var(--color-brand)',
              borderRadius: 'var(--radius-leaf-sm)',
            }}
          >
            Submit a request
          </button>
        )}
      </div>
    </div>
  )
}
