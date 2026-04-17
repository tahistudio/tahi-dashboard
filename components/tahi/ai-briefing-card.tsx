'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Sparkles, RefreshCw, ChevronDown, ChevronUp,
  FileText, Inbox, Heart, Target, Users, CheckSquare,
  ArrowRight,
} from 'lucide-react'
import Link from 'next/link'
import { apiPath } from '@/lib/api'

// ── Types ─────────────────────────────────────────────────────────────────────

interface BriefingItem {
  category: 'invoice' | 'request' | 'health' | 'pipeline' | 'capacity' | 'task'
  priority: 'high' | 'medium' | 'low'
  title: string
  detail: string
  href?: string
}

interface BriefingData {
  generatedAt: string
  todayItems: BriefingItem[]
  weekItems: BriefingItem[]
  summary: string
}

// ── Category config ─────────────────────────────────────────────────────────

const CATEGORY_ICON: Record<string, React.ReactNode> = {
  invoice:  <FileText size={14} aria-hidden="true" />,
  request:  <Inbox size={14} aria-hidden="true" />,
  health:   <Heart size={14} aria-hidden="true" />,
  pipeline: <Target size={14} aria-hidden="true" />,
  capacity: <Users size={14} aria-hidden="true" />,
  task:     <CheckSquare size={14} aria-hidden="true" />,
}

const CATEGORY_LABEL: Record<string, string> = {
  invoice: 'Invoice',
  request: 'Request',
  health: 'Client Health',
  pipeline: 'Pipeline',
  capacity: 'Capacity',
  task: 'Task',
}

const PRIORITY_STYLES: Record<string, { dot: string; text: string }> = {
  high:   { dot: 'var(--priority-high-dot)', text: 'var(--priority-high-text)' },
  medium: { dot: 'var(--status-in-review-dot)', text: 'var(--status-in-review-text)' },
  low:    { dot: 'var(--color-text-subtle)', text: 'var(--color-text-muted)' },
}

// ── Component ───────────────────────────────────────────────────────────────

export function AIDailyBriefing() {
  const [data, setData] = useState<BriefingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [tab, setTab] = useState<'today' | 'week'>('today')

  // Check localStorage for collapsed state
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setCollapsed(localStorage.getItem('tahi-briefing-collapsed') === '1')
    }
  }, [])

  // Fetch cached briefing
  const fetchBriefing = useCallback(async () => {
    try {
      const res = await fetch(apiPath('/api/admin/ai/briefing'))
      if (!res.ok) throw new Error('Failed')
      const json = await res.json() as BriefingData & { stale?: boolean }
      if (json.stale || !json.generatedAt) {
        setData(null)
      } else {
        setData(json)
      }
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchBriefing() }, [fetchBriefing])

  // Generate new briefing
  const generate = useCallback(async () => {
    setGenerating(true)
    try {
      const res = await fetch(apiPath('/api/admin/ai/briefing'), { method: 'POST' })
      if (!res.ok) throw new Error('Failed')
      const json = await res.json() as BriefingData
      setData(json)
      setCollapsed(false)
      if (typeof window !== 'undefined') {
        localStorage.removeItem('tahi-briefing-collapsed')
      }
    } catch {
      // silent
    } finally {
      setGenerating(false)
    }
  }, [])

  const toggleCollapse = () => {
    const next = !collapsed
    setCollapsed(next)
    if (typeof window !== 'undefined') {
      if (next) localStorage.setItem('tahi-briefing-collapsed', '1')
      else localStorage.removeItem('tahi-briefing-collapsed')
    }
  }

  const formatTime = (iso: string) => {
    try {
      const d = new Date(iso)
      return d.toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' })
    } catch { return '' }
  }

  // Loading skeleton
  if (loading) {
    return (
      <div className="animate-pulse" style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-5)',
      }}>
        <div className="flex items-center" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
          <div style={{ width: '1.25rem', height: '1.25rem', background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-sm)' }} />
          <div style={{ height: '0.875rem', width: '40%', background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-sm)' }} />
        </div>
        <div style={{ height: '0.75rem', width: '70%', background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-sm)' }} />
      </div>
    )
  }

  // No briefing yet - show generate button
  if (!data) {
    return (
      <div style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-5)',
      }}>
        <div
          className="flex flex-col sm:flex-row sm:items-center sm:justify-between"
          style={{ gap: 'var(--space-3)' }}
        >
          <div className="flex items-start" style={{ gap: 'var(--space-2)' }}>
            <Sparkles size={18} style={{ color: 'var(--color-brand)', flexShrink: 0, marginTop: '0.125rem' }} aria-hidden="true" />
            <div>
              <p style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--color-text)' }}>
                Daily Briefing
              </p>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}>
                AI-powered summary of what needs your attention
              </p>
            </div>
          </div>
          <button
            onClick={generate}
            disabled={generating}
            className="flex items-center justify-center sm:self-center"
            style={{
              padding: 'var(--space-2) var(--space-3)',
              background: 'var(--color-brand)',
              color: 'white',
              border: 'none',
              borderRadius: 'var(--radius-leaf-sm)',
              fontSize: 'var(--text-sm)',
              fontWeight: 600,
              gap: 'var(--space-1-5)',
              opacity: generating ? 0.7 : 1,
              height: '2.25rem',
              whiteSpace: 'nowrap',
              transition: 'background-color 150ms ease, box-shadow 150ms ease, transform 150ms ease',
            }}
            onMouseEnter={e => {
              if (!generating) {
                e.currentTarget.style.background = 'var(--color-brand-dark)'
                e.currentTarget.style.boxShadow = '0 4px 14px rgba(90,130,78,0.4)'
                e.currentTarget.style.transform = 'translateY(-1px)'
              }
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'var(--color-brand)'
              e.currentTarget.style.boxShadow = 'none'
              e.currentTarget.style.transform = 'none'
            }}
          >
            {generating ? (
              <RefreshCw size={14} className="animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles size={14} aria-hidden="true" />
            )}
            {generating ? 'Generating...' : 'Generate'}
          </button>
        </div>
      </div>
    )
  }

  const items = tab === 'today' ? data.todayItems : data.weekItems
  const isEmpty = items.length === 0

  return (
    <div style={{
      background: 'var(--color-bg)',
      border: '1px solid var(--color-border-subtle)',
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div
        className="flex items-center justify-between"
        style={{
          padding: 'var(--space-4) var(--space-5)',
          borderBottom: collapsed ? 'none' : '1px solid var(--color-border-subtle)',
        }}
      >
        <div className="flex items-center" style={{ gap: 'var(--space-2)' }}>
          <Sparkles size={18} style={{ color: 'var(--color-brand)' }} aria-hidden="true" />
          <div>
            <p style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--color-text)' }}>
              Daily Briefing
            </p>
            {collapsed && (
              <p className="fade-in" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', marginTop: 'var(--space-0-5)' }}>
                {data.summary}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center" style={{ gap: 'var(--space-2)' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}>
            {formatTime(data.generatedAt)}
          </span>
          <button
            onClick={generate}
            disabled={generating}
            className="flex items-center justify-center"
            style={{
              width: '1.75rem',
              height: '1.75rem',
              background: 'var(--color-bg-secondary)',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-text-muted)',
              transition: 'background-color 150ms ease',
            }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--color-bg-tertiary)' }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)' }}
            aria-label="Refresh briefing"
            title="Refresh briefing"
          >
            <RefreshCw size={13} className={generating ? 'animate-spin' : ''} aria-hidden="true" />
          </button>
          <button
            onClick={toggleCollapse}
            className="flex items-center justify-center"
            style={{
              width: '1.75rem',
              height: '1.75rem',
              background: 'var(--color-bg-secondary)',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-text-muted)',
              transition: 'background-color 150ms ease',
            }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--color-bg-tertiary)' }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)' }}
            aria-label={collapsed ? 'Expand briefing' : 'Collapse briefing'}
          >
            {collapsed ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronUp size={14} aria-hidden="true" />}
          </button>
        </div>
      </div>

      {/* Body */}
      {!collapsed && (
        <div className="fade-in">
          {/* Summary */}
          <div style={{ padding: 'var(--space-3) var(--space-5)', background: 'var(--color-brand-50)' }}>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-brand-dark)', fontWeight: 500 }}>
              {data.summary}
            </p>
          </div>

          {/* Tab toggle */}
          <div className="flex" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
            {(['today', 'week'] as const).map(t => (
              <button
                key={t}
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
          {isEmpty ? (
            <div style={{ padding: 'var(--space-8) var(--space-5)', textAlign: 'center' }}>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-subtle)' }}>
                {tab === 'today' ? 'Nothing urgent for today. You are all caught up.' : 'No items flagged for this week.'}
              </p>
            </div>
          ) : (
            <div>
              {items.map((item, i) => (
                <BriefingRow key={i} item={item} isLast={i === items.length - 1} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Briefing row (separate component for clean Link/div handling) ──────────

function BriefingRow({ item, isLast }: { item: BriefingItem; isLast: boolean }) {
  const pStyle = PRIORITY_STYLES[item.priority] ?? PRIORITY_STYLES.low
  const rowStyle: React.CSSProperties = {
    padding: 'var(--space-3) var(--space-5)',
    borderBottom: isLast ? 'none' : '1px solid var(--color-border-subtle)',
    gap: 'var(--space-3)',
    textDecoration: 'none',
    transition: 'background-color 150ms ease',
  }

  const inner = (
    <>
      <div style={{
        width: '0.5rem',
        height: '0.5rem',
        borderRadius: 'var(--radius-full)',
        background: pStyle.dot,
        marginTop: '0.375rem',
        flexShrink: 0,
      }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-0-5)' }}>
          <span style={{ color: 'var(--color-text-subtle)' }}>
            {CATEGORY_ICON[item.category]}
          </span>
          <span style={{ fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {CATEGORY_LABEL[item.category] ?? item.category}
          </span>
        </div>
        <p style={{ fontSize: 'var(--text-base)', fontWeight: 500, color: 'var(--color-text)' }}>
          {item.title}
        </p>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-0-5)' }}>
          {item.detail}
        </p>
      </div>
      {item.href && (
        <ArrowRight size={14} aria-hidden="true" className="flex-shrink-0 row-arrow" style={{ color: 'var(--color-text-subtle)', marginTop: '0.25rem' }} />
      )}
    </>
  )

  if (item.href) {
    return (
      <Link
        href={item.href}
        className="flex items-start group"
        style={rowStyle}
        onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--color-row-hover)' }}
        onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}
      >
        {inner}
      </Link>
    )
  }

  return (
    <div className="flex items-start" style={rowStyle}>
      {inner}
    </div>
  )
}
