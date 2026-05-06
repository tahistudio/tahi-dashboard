'use client'

import { useEffect, useState } from 'react'
import { GanttGrid, type GanttRow } from '@/components/tahi/gantt-grid'
import { GanttLegend } from '@/components/tahi/gantt-legend'
import { LeafLogo } from '@/components/tahi/leaf-logo'
import { apiPath } from '@/lib/api'
import { useShareViewTracking } from '@/components/tahi/use-share-view-tracking'

interface PublicSchedule {
  title: string
  subtitle: string | null
  preparedFor: string | null
  preparedBy: string | null
  effectiveDate: string | null
  targetLaunchDate: string | null
  numberOfWeeks: number
  overviewHtml: string | null
  status: string
  orgName: string | null
}

/**
 * Public, no-auth viewer for a project schedule. The token is validated
 * server-side; on miss/revoke we render a clean "not found" without
 * leaking that the URL was once valid.
 *
 * Layout goals:
 *   - Premium magazine-style cover that scales nicely from 360px to
 *     desktop. We DON'T force a 16:9 aspect ratio on phones — that
 *     ratio is great on a laptop but turns the cover into a postage
 *     stamp on mobile and starts truncating "Prepared for / Prepared by"
 *     metadata. On phones we let it grow to fit content; sm+ gets the
 *     wide cinematic look.
 *   - Real Tahi leaf brand mark (LeafLogo) — never the 🌿 emoji.
 *   - Optional executive overview slide between cover and gantt.
 *   - Shared legend component — same visual language as the editor.
 */
export function ScheduleViewer({ token }: { token: string }) {
  const [schedule, setSchedule] = useState<PublicSchedule | null>(null)
  const [rows, setRows] = useState<GanttRow[]>([])
  const [analyticsResourceId, setAnalyticsResourceId] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'not_found'>('loading')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(apiPath(`/api/public/schedules/${encodeURIComponent(token)}`))
        if (!res.ok) {
          if (!cancelled) setState('not_found')
          return
        }
        const data = await res.json() as {
          schedule: PublicSchedule
          rows: GanttRow[]
          analyticsResourceId?: string
        }
        if (cancelled) return
        setSchedule(data.schedule)
        setRows(data.rows ?? [])
        setAnalyticsResourceId(data.analyticsResourceId ?? null)
        setState('ok')
      } catch {
        if (!cancelled) setState('not_found')
      }
    }
    void load()
    return () => { cancelled = true }
  }, [token])

  useShareViewTracking({
    resourceType: 'schedule',
    resourceId: analyticsResourceId,
    shareToken: token,
  })

  if (state === 'loading') {
    return (
      <div style={loadingWrap}>
        <div className="animate-pulse" style={{ height: '8rem', width: '100%', maxWidth: '60rem', background: 'rgba(255,255,255,0.5)', borderRadius: '1rem' }} />
      </div>
    )
  }

  if (state === 'not_found' || !schedule) {
    return (
      <div style={loadingWrap}>
        <div style={{ textAlign: 'center', maxWidth: '24rem', padding: '2rem' }}>
          <BrandMark />
          <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1f2c1a', marginTop: '1rem', marginBottom: '0.5rem' }}>
            This link isn&apos;t available
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#5a6657', lineHeight: 1.5 }}>
            The schedule may have been revoked, or the link copied incorrectly. If you were expecting
            to see a project schedule, please reach out to the sender.
          </p>
        </div>
      </div>
    )
  }

  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null

  // Build the meta cells; only include cells that have a value so the
  // grid doesn't render placeholder slots on small schedules.
  const metaCells: { label: string; value: string }[] = []
  if (schedule.preparedFor) metaCells.push({ label: 'Prepared for', value: schedule.preparedFor })
  if (schedule.preparedBy) metaCells.push({ label: 'Prepared by', value: schedule.preparedBy })
  if (schedule.effectiveDate) metaCells.push({ label: 'Effective', value: fmtDate(schedule.effectiveDate) ?? schedule.effectiveDate })
  if (schedule.targetLaunchDate) metaCells.push({ label: 'Target launch', value: fmtDate(schedule.targetLaunchDate) ?? schedule.targetLaunchDate })

  return (
    <div style={pageWrap}>
      {/* Cover slide */}
      <section style={coverShell}>
        <div style={coverBackdrop} aria-hidden="true" />
        <div style={coverInner}>
          <BrandMark />

          <div style={{ marginTop: 'auto' }}>
            {schedule.subtitle && (
              <div style={coverEyebrow}>{schedule.subtitle}</div>
            )}
            <h1 style={coverTitle}>{schedule.title}</h1>
          </div>

          {metaCells.length > 0 && (
            <div style={coverMetaGrid}>
              {metaCells.map(cell => (
                <CoverMetaCell key={cell.label} label={cell.label} value={cell.value} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Optional overview — rendered only when set */}
      {schedule.overviewHtml && schedule.overviewHtml.trim() && (
        <section style={slideShell}>
          <div style={slideEyebrow}>Executive overview</div>
          <h2 style={slideTitle}>How it runs.</h2>
          <div
            style={overviewProse}
            dangerouslySetInnerHTML={{ __html: schedule.overviewHtml }}
          />
        </section>
      )}

      {/* Gantt slide */}
      <section style={slideShell}>
        <div style={slideEyebrow}>Project schedule</div>
        <h2 style={slideTitle}>Whole project, one view.</h2>
        {schedule.orgName && (
          <p style={slideSub}>
            {schedule.orgName} · {schedule.numberOfWeeks} {schedule.numberOfWeeks === 1 ? 'week' : 'weeks'}
          </p>
        )}
        <div style={{ marginTop: '1.25rem' }}>
          <GanttGrid rows={rows} numberOfWeeks={schedule.numberOfWeeks} />
        </div>
        <div style={{ marginTop: '1rem' }}>
          <GanttLegend compact />
        </div>
      </section>

      {/* Footer */}
      <footer style={footer}>
        <BrandMark size="sm" />
        <span style={{ fontSize: '0.6875rem', color: '#8a9987' }}>
          Confidential · prepared {fmtDate(schedule.effectiveDate) ?? 'this period'}
        </span>
      </footer>
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────

function BrandMark({ size = 'md' }: { size?: 'sm' | 'md' }) {
  // Wraps the dashboard's LeafLogo + the Tahi Studio wordmark in a layout
  // suited for the cover (small leaf, name beside it). We don't include
  // the "Dashboard" subtitle from the dashboard's wordmark — this is the
  // public-facing brand mark.
  return (
    <div className="inline-flex items-center" style={{ gap: '0.5rem' }}>
      <LeafLogo size={size === 'sm' ? 'sm' : 'sm'} />
      <span
        style={{
          fontSize: size === 'sm' ? '0.8125rem' : '0.9375rem',
          fontWeight: 700,
          color: '#1f2c1a',
          letterSpacing: '-0.01em',
        }}
      >
        Tahi Studio
      </span>
    </div>
  )
}

function CoverMetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontSize: '0.625rem',
          fontWeight: 600,
          color: '#8a9987',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom: '0.25rem',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: '0.9375rem',
          fontWeight: 600,
          color: '#1f2c1a',
          // Wrap long values rather than truncating.
          overflowWrap: 'break-word',
          wordBreak: 'break-word',
        }}
      >
        {value}
      </div>
    </div>
  )
}

// ─── Inline styles (no dashboard chrome, no Tailwind utilities) ──────────

const pageWrap: React.CSSProperties = {
  minHeight: '100vh',
  background: '#f5f7f5',
  fontFamily: 'var(--font-manrope, system-ui)',
  color: '#1f2c1a',
  padding: 'clamp(1rem, 4vw, 2.5rem)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'clamp(1.25rem, 3vw, 2rem)',
}

// Cover: NO forced aspect ratio at narrow widths. Sized to content on
// phones so meta text never truncates; capped to a cinematic 16:9-ish
// look at sm+ via min-height.
const coverShell: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  maxWidth: '76rem',
  margin: '0 auto',
  background: '#ffffff',
  border: '1px solid #d4e0d0',
  borderRadius: '1rem',
  overflow: 'hidden',
  boxShadow: '0 8px 32px rgba(31, 44, 26, 0.08)',
}

const coverBackdrop: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  background:
    'radial-gradient(circle at 92% 8%, rgba(122, 170, 107, 0.22) 0, transparent 38%),' +
    'radial-gradient(circle at 4% 96%, rgba(220, 239, 216, 0.7) 0, transparent 32%)',
}

const coverInner: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  // Generous min-height instead of forced aspect ratio. Lets the cover
  // breathe on phones without becoming a postage stamp.
  minHeight: 'clamp(20rem, 48vh, 32rem)',
  padding: 'clamp(1.25rem, 4vw, 3rem)',
  gap: '1.25rem',
}

const coverEyebrow: React.CSSProperties = {
  fontSize: '0.6875rem',
  fontWeight: 600,
  color: '#8a9987',
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  marginBottom: '0.625rem',
}

const coverTitle: React.CSSProperties = {
  fontSize: 'clamp(1.5rem, 5vw, 3rem)',
  fontWeight: 800,
  lineHeight: 1.05,
  color: '#1f2c1a',
  margin: 0,
  letterSpacing: '-0.015em',
  // Allow long titles to wrap rather than overflow.
  overflowWrap: 'break-word',
}

const coverMetaGrid: React.CSSProperties = {
  display: 'grid',
  // Each cell gets at least 9rem before stacking — keeps "Prepared for"
  // values readable and avoids the "Michael Day, Giant" → "Michael Day, Giant Group" truncation we saw on mobile.
  gridTemplateColumns: 'repeat(auto-fit, minmax(9rem, 1fr))',
  gap: '1.25rem',
  paddingTop: '1.25rem',
  borderTop: '1px solid #e8f0e6',
  marginTop: 'auto',
}

const slideShell: React.CSSProperties = {
  width: '100%',
  maxWidth: '76rem',
  margin: '0 auto',
  background: '#ffffff',
  border: '1px solid #d4e0d0',
  borderRadius: '1rem',
  boxShadow: '0 4px 16px rgba(31, 44, 26, 0.05)',
  padding: 'clamp(1.25rem, 3vw, 2rem)',
}

const slideEyebrow: React.CSSProperties = {
  fontSize: '0.6875rem',
  fontWeight: 600,
  color: '#8a9987',
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  marginBottom: '0.375rem',
}

const slideTitle: React.CSSProperties = {
  fontSize: 'clamp(1.25rem, 3vw, 1.875rem)',
  fontWeight: 800,
  color: '#1f2c1a',
  margin: 0,
  letterSpacing: '-0.015em',
}

const slideSub: React.CSSProperties = {
  fontSize: '0.875rem',
  color: '#5a6657',
  marginTop: '0.375rem',
}

const overviewProse: React.CSSProperties = {
  marginTop: '1rem',
  fontSize: '0.9375rem',
  lineHeight: 1.7,
  color: '#1f2c1a',
}

const footer: React.CSSProperties = {
  width: '100%',
  maxWidth: '76rem',
  margin: '0 auto',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: '0.75rem',
  padding: '1rem 0.5rem',
  borderTop: '1px solid #e8f0e6',
}

const loadingWrap: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#f5f7f5',
  padding: '2rem',
}
