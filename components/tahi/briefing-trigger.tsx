'use client'

/**
 * <BriefingTrigger>. Admin-only top-nav control that surfaces the cached AI
 * daily briefing in a Popover, matching the <NotificationBell> pattern.
 *
 * Read-only from the client: it renders the briefing already generated and
 * cached to settings.ai_briefing_latest by lib/ai-briefing + its cron. The
 * client never calls the model directly. A "Refresh briefing" button POSTs the
 * admin briefing route (human-triggered, admin-gated) to regenerate on demand.
 *
 * The trigger shows a subtle unread dot when the cached briefing is newer than
 * the last time this viewer opened it (a localStorage timestamp). Opening the
 * popover marks the current briefing seen and clears the dot.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { Sparkles, RefreshCw } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { Popover } from '@/components/tahi/popover'
import { BriefingRow, type BriefingData } from '@/components/tahi/ai-briefing-card'

const SEEN_KEY = 'tahi-briefing-seen'

export function BriefingTrigger() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<BriefingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [tab, setTab] = useState<'today' | 'week'>('today')
  const [hasNew, setHasNew] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Compare the cached briefing's timestamp against the last-seen marker so we
  // only flag genuinely fresher briefings as unread.
  const evaluateNew = useCallback((generatedAt: string | null) => {
    if (!generatedAt || typeof window === 'undefined') {
      setHasNew(false)
      return
    }
    const seen = window.localStorage.getItem(SEEN_KEY)
    setHasNew(!seen || new Date(generatedAt).getTime() > new Date(seen).getTime())
  }, [])

  const fetchBriefing = useCallback(async () => {
    try {
      const res = await fetch(apiPath('/api/admin/ai/briefing'))
      if (!res.ok) throw new Error('Failed')
      const json = await res.json() as BriefingData & { stale?: boolean }
      if (json.stale || !json.generatedAt) {
        setData(null)
        setHasNew(false)
      } else {
        setData(json)
        evaluateNew(json.generatedAt)
      }
    } catch {
      setData(null)
      setHasNew(false)
    } finally {
      setLoading(false)
    }
  }, [evaluateNew])

  useEffect(() => { void fetchBriefing() }, [fetchBriefing])

  const markSeen = useCallback((generatedAt: string | null) => {
    if (typeof window !== 'undefined' && generatedAt) {
      window.localStorage.setItem(SEEN_KEY, generatedAt)
    }
    setHasNew(false)
  }, [])

  const handleToggle = useCallback(() => {
    if (!open) {
      void fetchBriefing()
      markSeen(data?.generatedAt ?? null)
    }
    setOpen(prev => !prev)
  }, [open, fetchBriefing, markSeen, data])

  const generate = useCallback(async () => {
    setGenerating(true)
    try {
      const res = await fetch(apiPath('/api/admin/ai/briefing'), { method: 'POST' })
      if (!res.ok) throw new Error('Failed')
      const json = await res.json() as BriefingData
      setData(json)
      markSeen(json.generatedAt)
    } catch {
      // silent: transient / offline
    } finally {
      setGenerating(false)
    }
  }, [markSeen])

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' })
    } catch { return '' }
  }

  const items = data ? (tab === 'today' ? data.todayItems : data.weekItems) : []

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={buttonRef}
        type="button"
        className={'tb-bell' + (hasNew ? ' has-unread' : '')}
        onClick={handleToggle}
        aria-label={`Daily briefing${hasNew ? ' (new)' : ''}`}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <Sparkles size={18} aria-hidden="true" />
        {hasNew && <span className="tb-bell-dot" aria-hidden="true" />}
      </button>

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
                Daily Briefing
              </p>
            </div>
            {data && (
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

          {/* Empty / not-yet-generated */}
          {!loading && !data && (
            <div style={{ padding: 'var(--space-6) var(--space-5)', textAlign: 'center' }}>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text)', fontWeight: 500, marginBottom: 'var(--space-1)' }}>
                No briefing yet
              </p>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}>
                Generate an AI summary of what needs your attention.
              </p>
            </div>
          )}

          {/* Body */}
          {data && (
            <>
              {/* Summary */}
              <div style={{ padding: 'var(--space-3) var(--space-5)', background: 'var(--color-brand-50)', flexShrink: 0 }}>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-brand-dark)', fontWeight: 500 }}>
                  {data.summary}
                </p>
              </div>

              {/* Tabs */}
              <div className="flex" style={{ borderBottom: '1px solid var(--color-border-subtle)', flexShrink: 0 }}>
                {(['today', 'week'] as const).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTab(t)}
                    style={{
                      flex: 1,
                      padding: 'var(--space-3)',
                      fontSize: 'var(--text-sm)',
                      fontWeight: tab === t ? 600 : 400,
                      color: tab === t ? 'var(--color-brand)' : 'var(--color-text-muted)',
                      background: 'transparent',
                      border: 'none',
                      borderBottom: tab === t ? '2px solid var(--color-brand)' : '2px solid transparent',
                      cursor: 'pointer',
                      transition: 'color 150ms ease, border-color 150ms ease',
                    }}
                  >
                    {t === 'today' ? 'Today' : 'This Week'}
                    {(t === 'today' ? data.todayItems : data.weekItems).length > 0 && (
                      <span style={{
                        marginLeft: 'var(--space-1-5)',
                        padding: '0 var(--space-1-5)',
                        fontSize: 'var(--text-xs)',
                        fontWeight: 600,
                        background: tab === t ? 'var(--color-brand)' : 'var(--color-bg-tertiary)',
                        color: tab === t ? 'white' : 'var(--color-text-subtle)',
                        borderRadius: 'var(--radius-full)',
                      }}>
                        {(t === 'today' ? data.todayItems : data.weekItems).length}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* Items */}
              <div style={{ overflowY: 'auto', minHeight: 0 }}>
                {items.length === 0 ? (
                  <div style={{ padding: 'var(--space-8) var(--space-5)', textAlign: 'center' }}>
                    <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-subtle)' }}>
                      {tab === 'today' ? 'Nothing urgent for today. You are all caught up.' : 'No items flagged for this week.'}
                    </p>
                  </div>
                ) : (
                  items.map((item, i) => (
                    <BriefingRow key={i} item={item} isLast={i === items.length - 1} />
                  ))
                )}
              </div>
            </>
          )}

          {/* Footer: human-triggered refresh */}
          <div
            className="flex items-center justify-end"
            style={{
              padding: 'var(--space-3) var(--space-5)',
              borderTop: '1px solid var(--color-border-subtle)',
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              onClick={() => void generate()}
              disabled={generating}
              className="flex items-center justify-center"
              style={{
                padding: 'var(--space-2) var(--space-3)',
                background: data ? 'var(--color-bg-secondary)' : 'var(--color-brand)',
                color: data ? 'var(--color-text)' : 'white',
                border: data ? '1px solid var(--color-border)' : 'none',
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
              {generating ? 'Refreshing...' : data ? 'Refresh briefing' : 'Generate briefing'}
            </button>
          </div>
        </div>
      </Popover>
    </div>
  )
}
