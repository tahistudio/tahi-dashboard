import { auth } from '@clerk/nextjs/server'

export const metadata = {
  title: 'Dashboard',
}

export default async function AdminDashboardPage() {
  const { userId } = await auth()

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Dashboard</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">
          Overview of Tahi Studio operations.
        </p>
      </div>

      {/* KPI Cards — placeholder until DB is wired */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'MRR', value: '$0', sub: 'No active subscriptions' },
          { label: 'Active Clients', value: '0', sub: 'No clients yet' },
          { label: 'Open Requests', value: '0', sub: 'No open requests' },
          { label: 'Outstanding', value: '$0', sub: 'No invoices sent' },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-5"
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-subtle)]">
              {kpi.label}
            </p>
            <p className="text-2xl font-bold text-[var(--color-text)] mt-1">{kpi.value}</p>
            <p className="text-xs text-[var(--color-text-muted)] mt-1">{kpi.sub}</p>
          </div>
        ))}
      </div>

      {/* Welcome state */}
      <div
        className="border border-[var(--color-border)] rounded-[var(--radius-card)] p-8 text-center"
        style={{ background: 'var(--color-brand-50)' }}
      >
        <div
          className="w-16 h-16 brand-gradient mx-auto mb-4 flex items-center justify-center"
          style={{ borderRadius: 'var(--radius-leaf)' }}
        >
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10c1.85 0 3.58-.5 5.07-1.38C19.55 19.1 21 16.72 21 14c0-3.87-3.13-7-7-7-2.21 0-4.19.97-5.54 2.5"
              stroke="white"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-[var(--color-brand-dark)] mb-2">
          Welcome to Tahi Dashboard
        </h2>
        <p className="text-sm text-[var(--color-text-muted)] max-w-md mx-auto">
          Your operations hub is ready. Start by adding your first client, or configure your
          settings to connect Stripe and your other integrations.
        </p>
        <div className="flex justify-center gap-3 mt-5">
          <a
            href="/admin/clients/new"
            className="px-4 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90 transition-opacity"
            style={{ background: 'var(--color-brand)', borderRadius: 'var(--radius-leaf-sm)' }}
          >
            Add first client
          </a>
          <a
            href="/admin/settings"
            className="px-4 py-2 text-sm font-medium text-[var(--color-brand-dark)] rounded-lg border border-[var(--color-brand)] hover:bg-white transition-colors"
            style={{ borderRadius: 'var(--radius-leaf-sm)' }}
          >
            Configure settings
          </a>
        </div>
      </div>
    </div>
  )
}
