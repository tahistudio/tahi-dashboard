import Link from 'next/link'
import { redirect } from 'next/navigation'
import { BarChart2, ArrowRight } from 'lucide-react'
import { getServerAuth } from '@/lib/server-auth'
import { PageHeader } from '@/components/tahi/page-header'
import { Card } from '@/components/tahi/card'

export const metadata = { title: 'Sales analytics - Tahi Dashboard' }

export default async function SalesAnalyticsPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  if (orgId !== process.env.NEXT_PUBLIC_TAHI_ORG_ID) redirect('/requests')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales analytics"
        subtitle="Close-rate by source, proposal-to-sign time, share-view stats across schedules / proposals / contracts. Coming in Phase 8."
      />

      <Card padding="lg">
        <div className="flex items-start gap-3">
          <span
            className="inline-flex items-center justify-center flex-shrink-0"
            style={{
              width: '2.25rem',
              height: '2.25rem',
              background: 'var(--color-brand-50)',
              borderRadius: 'var(--radius-leaf-sm)',
              color: 'var(--color-brand-dark)',
            }}
          >
            <BarChart2 className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold text-[var(--color-text)]">Coming next</h2>
            <p className="text-sm text-[var(--color-text-muted)] mt-1 leading-relaxed">
              A single rollup of how every proposal, schedule and contract is performing (viewer
              counts, average time-on-page, accept/decline/question rates, and close-rate per lead
              source). Until then, share-view stats live on each individual proposal, schedule and
              contract detail page.
            </p>
            <div className="mt-4 grid sm:grid-cols-3 gap-2">
              <Link
                href="/proposals"
                className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-bg-secondary)] transition-colors text-sm"
              >
                <span className="text-[var(--color-text)]">Proposals</span>
                <ArrowRight className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
              </Link>
              <Link
                href="/schedules"
                className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-bg-secondary)] transition-colors text-sm"
              >
                <span className="text-[var(--color-text)]">Schedules</span>
                <ArrowRight className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
              </Link>
              <Link
                href="/contracts"
                className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-bg-secondary)] transition-colors text-sm"
              >
                <span className="text-[var(--color-text)]">Contracts</span>
                <ArrowRight className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
              </Link>
            </div>
          </div>
        </div>
      </Card>

      <Card
        padding="lg"
        style={{
          background: 'var(--color-bg-secondary)',
          borderColor: 'var(--color-border-subtle)',
        }}
      >
        <h3 className="text-sm font-semibold text-[var(--color-text)]">What this page will show</h3>
        <ul className="mt-3 space-y-2 text-sm text-[var(--color-text-muted)] list-disc pl-5">
          <li>Close rate by source (referral / Webflow partner / LinkedIn / website / cold)</li>
          <li>Median proposal-to-sign time per source and per package</li>
          <li>Top-performing proposals by viewer count, dwell time and accept rate</li>
          <li>Variant heatmap (which package gets clicked vs which gets accepted)</li>
          <li>Open questions / tweak requests across all live proposals</li>
        </ul>
      </Card>
    </div>
  )
}
