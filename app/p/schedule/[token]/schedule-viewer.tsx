'use client'

import { useEffect, useState } from 'react'
import { GanttGrid, type GanttRow } from '@/components/tahi/gantt-grid'
import { apiPath } from '@/lib/api'

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
 * Visual goal: a premium 16:9-ish presentation that mirrors the PDF
 * cover + gantt page, brand-locked to Tahi colours.
 */
export function ScheduleViewer({ token }: { token: string }) {
  const [schedule, setSchedule] = useState<PublicSchedule | null>(null)
  const [rows, setRows] = useState<GanttRow[]>([])
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
        const data = await res.json() as { schedule: PublicSchedule; rows: GanttRow[] }
        if (cancelled) return
        setSchedule(data.schedule)
        setRows(data.rows ?? [])
        setState('ok')
      } catch {
        if (!cancelled) setState('not_found')
      }
    }
    void load()
    return () => { cancelled = true }
  }, [token])

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
          <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1f2c1a', marginBottom: '0.5rem' }}>
            This link isn&apos;t available
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#5a6657', lineHeight: 1.5 }}>
            The schedule may have been revoked or the link copied incorrectly. If you were expecting to
            see a project schedule, please reach out to the sender.
          </p>
        </div>
      </div>
    )
  }

  const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null

  return (
    <div style={pageWrap}>
      {/* Cover slide — 16:9 feel */}
      <section style={cover}>
        <div style={coverBackdrop} />
        <div style={coverInner}>
          <div style={coverBrand}>
            <span style={coverLeaf} aria-hidden="true">🌿</span>
            Tahi Studio
          </div>
          {schedule.subtitle && (
            <div style={coverEyebrow}>{schedule.subtitle}</div>
          )}
          <h1 style={coverTitle}>{schedule.title}</h1>
          <div style={coverMeta}>
            {schedule.preparedFor && (
              <CoverMetaCell label="Prepared for" value={schedule.preparedFor} />
            )}
            {schedule.preparedBy && (
              <CoverMetaCell label="Prepared by" value={schedule.preparedBy} />
            )}
            {schedule.effectiveDate && (
              <CoverMetaCell label="Effective" value={fmtDate(schedule.effectiveDate) ?? schedule.effectiveDate} />
            )}
            {schedule.targetLaunchDate && (
              <CoverMetaCell label="Target launch" value={fmtDate(schedule.targetLaunchDate) ?? schedule.targetLaunchDate} />
            )}
          </div>
        </div>
      </section>

      {/* Gantt slide */}
      <section style={ganttWrap}>
        <header style={{ marginBottom: '1.5rem' }}>
          <div style={slideEyebrow}>Project schedule</div>
          <h2 style={slideTitle}>Whole project, one view.</h2>
          {schedule.orgName && (
            <p style={{ fontSize: '0.875rem', color: '#5a6657', marginTop: '0.375rem' }}>
              {schedule.orgName} · {schedule.numberOfWeeks} weeks
            </p>
          )}
        </header>
        <GanttGrid rows={rows} numberOfWeeks={schedule.numberOfWeeks} />
        <p style={{ marginTop: '1rem', fontSize: '0.75rem', color: '#8a9987' }}>
          Solid green = Tahi · dark green = Client · amber = Joint · light green = Tahi parallel · diamond = sign-off gate · red-bordered diamond = critical-path gate · hatched = risk of delay.
        </p>
      </section>

      {/* Footer */}
      <footer style={footer}>
        <span style={coverBrand}>
          <span aria-hidden="true">🌿</span> Tahi Studio
        </span>
        <span style={{ fontSize: '0.6875rem', color: '#8a9987' }}>
          Confidential · prepared {fmtDate(schedule.effectiveDate) ?? 'this period'}
        </span>
      </footer>
    </div>
  )
}

function CoverMetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: '0.625rem', fontWeight: 600, color: '#8a9987', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.25rem' }}>
        {label}
      </div>
      <div style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#1f2c1a' }}>{value}</div>
    </div>
  )
}

// ── Styles (kept inline; this page intentionally avoids the dashboard layout) ──

const pageWrap: React.CSSProperties = {
  minHeight: '100vh',
  background: '#f5f7f5',
  fontFamily: 'var(--font-manrope, system-ui)',
  color: '#1f2c1a',
  padding: '2rem clamp(1rem, 4vw, 3rem)',
  display: 'flex',
  flexDirection: 'column',
  gap: '2rem',
}

const cover: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  maxWidth: '76rem',
  margin: '0 auto',
  aspectRatio: '16 / 9',
  background: '#ffffff',
  border: '1px solid #d4e0d0',
  borderRadius: '1rem',
  overflow: 'hidden',
  boxShadow: '0 8px 32px rgba(31, 44, 26, 0.08)',
}

const coverBackdrop: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  background:
    'radial-gradient(circle at 90% 10%, rgba(122, 170, 107, 0.18) 0, transparent 35%),' +
    'radial-gradient(circle at 5% 95%, rgba(220, 239, 216, 0.6) 0, transparent 30%)',
}

const coverInner: React.CSSProperties = {
  position: 'relative',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
  padding: 'clamp(1.5rem, 4vw, 3rem)',
}

const coverBrand: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.5rem',
  fontSize: '0.875rem',
  fontWeight: 700,
  color: '#1f2c1a',
}

const coverLeaf: React.CSSProperties = { fontSize: '0.875rem' }

const coverEyebrow: React.CSSProperties = {
  marginTop: 'auto',
  fontSize: '0.75rem',
  fontWeight: 600,
  color: '#8a9987',
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
}

const coverTitle: React.CSSProperties = {
  fontSize: 'clamp(1.75rem, 4.5vw, 3rem)',
  fontWeight: 800,
  lineHeight: 1.05,
  color: '#1f2c1a',
  margin: '0.75rem 0 1.5rem 0',
  letterSpacing: '-0.01em',
}

const coverMeta: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(8rem, 1fr))',
  gap: '1.5rem',
  paddingTop: '1.25rem',
  borderTop: '1px solid #e8f0e6',
}

const ganttWrap: React.CSSProperties = {
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
  letterSpacing: '-0.01em',
}

const footer: React.CSSProperties = {
  width: '100%',
  maxWidth: '76rem',
  margin: '0 auto',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '1rem 0.5rem',
  borderTop: '1px solid #e8f0e6',
}

const loadingWrap: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#f5f7f5',
}
