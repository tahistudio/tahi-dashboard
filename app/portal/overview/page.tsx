import { auth } from '@clerk/nextjs/server'

export const metadata = { title: 'Overview' }

export default async function PortalOverviewPage() {
  const { orgId, orgSlug } = await auth()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Overview</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">
          Welcome to your Tahi Studio client portal.
        </p>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Open Requests', value: '0', sub: 'No active requests' },
          { label: 'Track Usage', value: '0 / 0', sub: 'Tracks available' },
          { label: 'Pending Tasks', value: '0', sub: 'Nothing from us yet' },
          { label: 'Outstanding', value: '$0', sub: 'No unpaid invoices' },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-5"
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-subtle)]">
              {stat.label}
            </p>
            <p className="text-2xl font-bold text-[var(--color-text)] mt-1">{stat.value}</p>
            <p className="text-xs text-[var(--color-text-muted)] mt-1">{stat.sub}</p>
          </div>
        ))}
      </div>

      {/* Welcome card */}
      <div
        className="border border-[var(--color-border)] rounded-[var(--radius-card)] p-6"
        style={{ background: 'var(--color-brand-50)' }}
      >
        <h2 className="text-lg font-bold text-[var(--color-brand-dark)] mb-2">
          You are set up and ready to go.
        </h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          Use the sidebar to submit requests, check your files, view invoices, or message the Tahi team.
          If you have questions, reach out directly via Messages.
        </p>
        <a
          href="/portal/requests/new"
          className="inline-flex items-center gap-2 mt-4 px-4 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90 transition-opacity"
          style={{ background: 'var(--color-brand)', borderRadius: 'var(--radius-leaf-sm)' }}
        >
          Submit a request
        </a>
      </div>
    </div>
  )
}
