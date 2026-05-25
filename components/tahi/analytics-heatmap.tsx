'use client'

/**
 * <AnalyticsHeatmap> — section-by-section views + dwell visualisation for
 * shared deliverables (schedules, proposals, contracts).
 *
 * Renders one row per section with:
 *   - section label (number + name)
 *   - heat bar (% of unique viewers who entered this section)
 *   - dwell badge (avg time spent when entered)
 *   - views chip (total view events)
 *
 * Brand-green tints: brand-50 → brand → brand-deepest as viewership rises.
 *
 * Reusable across resource types — caller passes pre-sorted sections
 * plus the totals computed at the API layer.
 */

import React from 'react'
import { Eye, Clock } from 'lucide-react'

interface SectionAgg {
  sectionId: string
  views: number
  uniqueSessions: number
  totalDwellMs: number
  avgDwellMs: number
  maxDwellMs: number
}

interface Props {
  sections: SectionAgg[]
  /** Used to compute the % of viewers who reached each section. */
  totalUniqueSessions: number
  /** Optional label lookup so the heatmap shows readable names. */
  labelFor?: (sectionId: string, index: number) => string
}

function formatDuration(ms: number): string {
  if (ms < 1000) return '<1s'
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remSeconds = seconds % 60
  return `${minutes}m ${remSeconds}s`
}

function heatColor(pct: number): string {
  if (pct >= 0.85) return 'var(--color-brand-dark)'
  if (pct >= 0.6) return 'var(--color-brand)'
  if (pct >= 0.35) return 'var(--color-brand-light)'
  if (pct >= 0.15) return 'var(--color-brand-100)'
  return 'var(--color-brand-50)'
}

export function AnalyticsHeatmap({ sections, totalUniqueSessions, labelFor }: Props) {
  if (sections.length === 0 || totalUniqueSessions === 0) {
    return (
      <div style={{
        padding: '1rem',
        textAlign: 'center',
        fontSize: '0.8125rem',
        color: 'var(--color-text-muted)',
        background: 'var(--color-bg-secondary)',
        borderRadius: 'var(--radius-md)',
      }}>
        No section-level analytics yet. Once a viewer scrolls through the document, sections will appear here.
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: '0.4375rem' }}>
      {sections.map((s, i) => {
        const pct = Math.min(1, s.uniqueSessions / totalUniqueSessions)
        const label = labelFor ? labelFor(s.sectionId, i) : (s.sectionId === 'cover' ? 'Cover' : `Section ${i + 1}`)
        return (
          <div
            key={s.sectionId}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 10rem) 1fr auto',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '0.5rem 0.625rem',
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div className="truncate" style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)' }}>
                {label}
              </div>
              <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>
                {Math.round(pct * 100)}% reached · {s.uniqueSessions}/{totalUniqueSessions} viewers
              </div>
            </div>
            <div style={{
              position: 'relative',
              height: '1.5rem',
              background: 'var(--color-bg-secondary)',
              borderRadius: '999px',
              overflow: 'hidden',
            }}>
              <div style={{
                width: `${Math.max(2, pct * 100)}%`,
                height: '100%',
                background: heatColor(pct),
                transition: 'width 360ms cubic-bezier(0.22, 1, 0.36, 1)',
              }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', whiteSpace: 'nowrap' }}>
              <span title="Average time spent when viewers reached this section" style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.25rem',
                fontSize: '0.6875rem',
                color: 'var(--color-text-muted)',
              }}>
                <Clock size={11} />
                {formatDuration(s.avgDwellMs)}
              </span>
              <span title="Total views" style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.25rem',
                fontSize: '0.6875rem',
                color: 'var(--color-text-muted)',
              }}>
                <Eye size={11} />
                {s.views}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
