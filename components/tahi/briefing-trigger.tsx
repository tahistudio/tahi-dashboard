'use client'

/**
 * <BriefingTrigger>. Admin-only top-nav control that surfaces the SAME daily
 * brief shown on the overview home, in a compact Popover.
 *
 * One source of truth: this reads the deterministic brief cached to
 * settings.overview_brief_latest (GET /api/admin/overview/brief) that the home
 * "Daily brief" card renders. The nav popover is the glance (summary + top
 * rows + open-full-brief link); the home card is the expanded view. They can
 * never disagree because they read the same cache. "Refresh" POSTs the shared
 * refresh route and both surfaces pick up the new cache.
 *
 * The trigger shows a subtle unread dot when the cached brief is newer than the
 * last time this viewer opened it (a localStorage timestamp). Opening the
 * popover marks the current brief seen and clears the dot.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, RefreshCw } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { Popover } from '@/components/tahi/popover'

const SEEN_KEY = 'tahi-briefing-seen'

// Logical brief destination id -> real dashboard route (mirrors the overview
// home's ROUTE_MAP). Anything unlisted falls back to /<id>.
const ROUTE_MAP: Record<string, string> = {
  financialreports: '/financial-reports',
  'financial-reports': '/financial-reports',
  plan: '/billing',
  billing: '/billing',
}

interface BriefRow {
  tone: 'risk' | 'warn' | 'ok' | ''
  verb: string | null
  to: string
  text: string
}

interface BriefData {
  urgent: BriefRow[]
  week: BriefRow[]
  slept: BriefRow[]
  generatedAt?: string
}

const dotColor = (tone: BriefRow['tone']): string => {
  if (tone === 'risk') return 'var(--color-danger)'
  if (tone === 'warn') return 'var(--color-due-soon-text, var(--color-warning))'
  return 'var(--color-text-subtle)'
}

interface BriefingTriggerProps {
  /**
   * 'bar' (default) is the top-bar bell. 'sheet' is the same control rendered
   * as a full-width row inside the mobile More sheet. Only the trigger markup
   * differs: the popover, the data and the unread rule are shared.
   */
  variant?: 'bar' | 'sheet'
}

export function BriefingTrigger({ variant = 'bar' }: BriefingTriggerProps) {
  const sheet = variant === 'sheet'
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<BriefData | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [hasNew, setHasNew] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const evaluateNew = useCallback((generatedAt: string | undefined) => {
    if (!generatedAt || typeof window === 'undefined') {
      setHasNew(false)
      return
    }
    const seen = window.localStorage.getItem(SEEN_KEY)
    setHasNew(!seen || new Date(generatedAt).getTime() > new Date(seen).getTime())
  }, [])

  const fetchBrief = useCallback(async () => {
    try {
      const res = await fetch(apiPath('/api/admin/overview/brief'))
      if (!res.ok) throw new Error('Failed')
      const json = (await res.json()) as BriefData
      setData(json)
      evaluateNew(json.generatedAt)
    } catch {
      setData(null)
      setHasNew(false)
    } finally {
      setLoading(false)
    }
  }, [evaluateNew])

  useEffect(() => { void fetchBrief() }, [fetchBrief])

  const markSeen = useCallback((generatedAt: string | undefined) => {
    if (typeof window !== 'undefined' && generatedAt) {
      window.localStorage.setItem(SEEN_KEY, generatedAt)
    }
    setHasNew(false)
  }, [])

  const handleToggle = useCallback(() => {
    if (!open) {
      void fetchBrief()
      markSeen(data?.generatedAt)
    }
    setOpen(prev => !prev)
  }, [open, fetchBrief, markSeen, data])

  const go = useCallback((id: string) => {
    const path = ROUTE_MAP[id] ?? '/' + id.replace(/^\/+/, '')
    setOpen(false)
    router.push(path)
  }, [router])

  const refresh = useCallback(async () => {
    setGenerating(true)
    try {
      const res = await fetch(apiPath('/api/admin/overview/brief/refresh?force=1'), { method: 'POST' })
      if (!res.ok) throw new Error('Failed')
      await fetchBrief()
      markSeen(data?.generatedAt)
    } catch {
      // silent: transient / offline, leave the existing brief in place
    } finally {
      setGenerating(false)
    }
  }, [fetchBrief, markSeen, data])

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' })
    } catch { return '' }
  }

  const urgent = data?.urgent ?? []
  const week = data?.week ?? []
  const slept = data?.slept ?? []
  const total = urgent.length + week.length
  const lede = total === 0
    ? 'All clear. Nothing is waiting on you right now.'
    : `${urgent.length} ${urgent.length === 1 ? 'thing needs' : 'things need'} you today, ${week.length} this week.`

  const sections: { key: string; label: string; rows: BriefRow[] }[] = [
    { key: 'urgent', label: 'Urgent today', rows: urgent },
    { key: 'week', label: 'This week', rows: week },
    { key: 'slept', label: 'While you slept', rows: slept },
  ]

  return (
    <div className={sheet ? 'tbs-slot' : undefined} style={{ position: 'relative' }}>
      {sheet ? (
        <button
          ref={buttonRef}
          type="button"
          className="tbs-row tahi-focus-ring"
          onClick={handleToggle}
          aria-label={`Daily brief${hasNew ? ' (new)' : ''}`}
          aria-expanded={open}
          aria-haspopup="true"
        >
          <span className="tbs-ic"><Sparkles size={18} aria-hidden="true" /></span>
          <span className="tbs-lbl">Daily brief</span>
          {hasNew
            ? <span className="tbs-val on">New</span>
            : data?.generatedAt
              ? <span className="tbs-val">{formatTime(data.generatedAt)}</span>
              : null}
        </button>
      ) : (
        <button
          ref={buttonRef}
          type="button"
          className={'tb-bell' + (hasNew ? ' has-unread' : '')}
          onClick={handleToggle}
          aria-label={`Daily brief${hasNew ? ' (new)' : ''}`}
          aria-expanded={open}
          aria-haspopup="true"
        >
          <Sparkles size={18} aria-hidden="true" />
          {hasNew && <span className="tb-bell-dot" aria-hidden="true" />}
        </button>
      )}

      <Popover
        anchorRef={buttonRef}
        open={open}
        onClose={() => setOpen(false)}
        width="24rem"
        align="end"
        maxHeight="34rem"
        mobileFullWidth
      >
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {/* Header */}
          <div
            className="flex items-center justify-between"
            style={{
              padding: 'var(--space-4) var(--space-5)',
              borderBottom: '1px solid var(--color-border-subtle)',
              flexShrink: 0,
            }}
          >
            <div className="flex items-center" style={{ gap: 'var(--space-2)' }}>
              <Sparkles size={17} style={{ color: 'var(--color-brand)' }} aria-hidden="true" />
              <p style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--color-text)' }}>
                Daily brief
              </p>
            </div>
            {data?.generatedAt && (
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}>
                {formatTime(data.generatedAt)}
              </span>
            )}
          </div>

          {/* Loading */}
          {loading && !data && (
            <div className="animate-pulse" style={{ padding: 'var(--space-5)' }}>
              <div style={{ height: '0.75rem', width: '80%', background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-sm)', marginBottom: 'var(--space-3)' }} />
              <div style={{ height: '0.75rem', width: '55%', background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-sm)' }} />
            </div>
          )}

          {/* Body */}
          {data && (
            <>
              <div style={{ padding: 'var(--space-3) var(--space-5)', background: 'var(--color-brand-50)', flexShrink: 0 }}>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-brand-dark)', fontWeight: 500 }}>
                  {lede}
                </p>
              </div>

              <div style={{ overflowY: 'auto', minHeight: 0 }}>
                {total + slept.length === 0 ? (
                  <div style={{ padding: 'var(--space-8) var(--space-5)', textAlign: 'center' }}>
                    <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-subtle)' }}>
                      You are all caught up.
                    </p>
                  </div>
                ) : (
                  sections.filter(s => s.rows.length > 0).map(section => (
                    <div key={section.key}>
                      <p style={{
                        padding: 'var(--space-3) var(--space-5) var(--space-1)',
                        fontSize: 'var(--text-xs)',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        color: 'var(--color-text-subtle)',
                      }}>
                        {section.label}
                      </p>
                      {section.rows.map((r, i) => (
                        <div
                          key={i}
                          className="flex items-center"
                          style={{
                            gap: 'var(--space-2-5)',
                            padding: 'var(--space-2) var(--space-5)',
                            borderBottom: '1px solid var(--color-border-subtle)',
                          }}
                        >
                          <span style={{
                            width: '0.4375rem',
                            height: '0.4375rem',
                            borderRadius: 'var(--radius-full)',
                            background: dotColor(r.tone),
                            flexShrink: 0,
                          }} aria-hidden="true" />
                          <span style={{ flex: 1, fontSize: 'var(--text-sm)', color: 'var(--color-text)' }}>
                            {r.text}
                          </span>
                          {r.verb && (
                            <button
                              type="button"
                              onClick={() => go(r.to)}
                              style={{
                                flexShrink: 0,
                                padding: 'var(--space-1) var(--space-2-5)',
                                fontSize: 'var(--text-xs)',
                                fontWeight: 600,
                                color: 'var(--color-brand-dark)',
                                background: 'var(--color-bg-secondary)',
                                border: '1px solid var(--color-border)',
                                borderRadius: 'var(--radius-leaf-sm)',
                                cursor: 'pointer',
                              }}
                            >
                              {r.verb}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>
            </>
          )}

          {/* Footer: open full brief + human-triggered refresh */}
          <div
            className="flex items-center justify-between"
            style={{
              padding: 'var(--space-3) var(--space-5)',
              borderTop: '1px solid var(--color-border-subtle)',
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              onClick={() => go('overview')}
              style={{
                padding: 'var(--space-2) 0',
                background: 'transparent',
                border: 'none',
                color: 'var(--color-brand-dark)',
                fontSize: 'var(--text-sm)',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Open full brief
            </button>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={generating}
              className="flex items-center justify-center"
              style={{
                padding: 'var(--space-2) var(--space-3)',
                background: 'var(--color-bg-secondary)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-leaf-sm)',
                fontSize: 'var(--text-sm)',
                fontWeight: 600,
                gap: 'var(--space-1-5)',
                cursor: generating ? 'not-allowed' : 'pointer',
                opacity: generating ? 0.7 : 1,
                transition: 'background-color 150ms ease',
              }}
            >
              <RefreshCw size={14} className={generating ? 'animate-spin' : ''} aria-hidden="true" />
              {generating ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>
      </Popover>
    </div>
  )
}
