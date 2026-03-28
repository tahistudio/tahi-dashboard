'use client'

import { useState, useEffect, useCallback } from 'react'
import { Users, Link2, DollarSign, Loader2 } from 'lucide-react'
import { apiPath } from '@/lib/api'

interface AffiliateData {
  connected: boolean
  lastSyncedAt: string | null
  affiliates: unknown[]
  referrals: unknown[]
  commissions: unknown[]
}

export function AffiliatesContent() {
  const [data, setData] = useState<AffiliateData | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiPath('/api/admin/integrations/rewardful'))
      if (!res.ok) throw new Error('Failed')
      const json = await res.json() as AffiliateData
      setData(json)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Affiliates</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">
          Rewardful affiliate tracking and commission management.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--color-text-subtle)]" aria-hidden="true" />
        </div>
      ) : !data?.connected ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div
            className="w-16 h-16 brand-gradient flex items-center justify-center mb-4"
            style={{ borderRadius: 'var(--radius-leaf)' }}
          >
            <Link2 className="w-8 h-8 text-white" aria-hidden="true" />
          </div>
          <h3 className="text-base font-semibold text-[var(--color-text)] mb-2">
            Connect Rewardful
          </h3>
          <p className="text-sm text-[var(--color-text-muted)] max-w-sm mb-4">
            Connect your Rewardful account to track affiliates, referrals, and commissions.
            Add your API key in Settings &gt; Integrations.
          </p>
          <a
            href="/settings"
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white transition-colors"
            style={{
              background: 'var(--color-brand)',
              borderRadius: 'var(--radius-button)',
              textDecoration: 'none',
              minHeight: '2.75rem',
            }}
          >
            Go to Settings
          </a>
        </div>
      ) : (
        <div>
          {/* Summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <StatCard
              label="Affiliates"
              value={String(data.affiliates.length)}
              icon={<Users className="w-5 h-5" aria-hidden="true" />}
            />
            <StatCard
              label="Referrals"
              value={String(data.referrals.length)}
              icon={<Link2 className="w-5 h-5" aria-hidden="true" />}
            />
            <StatCard
              label="Commissions"
              value={String(data.commissions.length)}
              icon={<DollarSign className="w-5 h-5" aria-hidden="true" />}
            />
          </div>

          {/* Placeholder */}
          <div
            className="text-center py-12"
            style={{
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-card)',
            }}
          >
            <p className="text-sm text-[var(--color-text-muted)]">
              Affiliate data will appear here once synced from Rewardful.
              {data.lastSyncedAt && (
                <span className="block text-xs mt-1 text-[var(--color-text-subtle)]">
                  Last synced: {new Date(data.lastSyncedAt).toLocaleString()}
                </span>
              )}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div
      style={{
        padding: '1rem',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-card)',
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-[var(--color-text-subtle)] uppercase tracking-wide">
          {label}
        </span>
        <span style={{ color: 'var(--color-brand)' }}>{icon}</span>
      </div>
      <span className="text-2xl font-bold text-[var(--color-text)]">{value}</span>
    </div>
  )
}
