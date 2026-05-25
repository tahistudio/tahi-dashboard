'use client'

/**
 * <ScheduleViewer> — public, no-auth viewer for a project schedule.
 *
 * Visual reference: the Tahi Studio schedule PDFs (Tevalis, Giant Group).
 * We mirror that document language: cream-white surface, brand-green
 * accent words in titles via the {{...}} syntax, decorative organic
 * circles on the cover, Tahi leaf top-left + section number top-right
 * on every page, metadata footer strip on the cover.
 *
 * Primitives live in components/tahi/deliverable/. Section bodies still
 * dispatch through schedule-section-renderers but each section is now
 * wrapped in <PageChrome> so it reads as a paginated document.
 */

import { useEffect, useState } from 'react'
import { type GanttRow } from '@/components/tahi/gantt-grid'
import { SectionRenderer, type ScheduleSection } from '@/components/tahi/schedule-section-renderers'
import {
  BrandMark, CoverPage, PageChrome, type MetadataCell, BRAND,
} from '@/components/tahi/deliverable'
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

type ScheduleViewerProps =
  | { token: string; previewScheduleId?: undefined }
  | { token?: undefined; previewScheduleId: string }

export function ScheduleViewer(props: ScheduleViewerProps) {
  const { token, previewScheduleId } = props
  const isPreview = !!previewScheduleId
  const [schedule, setSchedule] = useState<PublicSchedule | null>(null)
  const [sections, setSections] = useState<ScheduleSection[]>([])
  const [analyticsResourceId, setAnalyticsResourceId] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'not_found'>('loading')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const url = isPreview
          ? apiPath(`/api/admin/schedules/${encodeURIComponent(previewScheduleId!)}/preview-data`)
          : apiPath(`/api/public/schedules/${encodeURIComponent(token!)}`)
        const res = await fetch(url)
        if (!res.ok) {
          if (!cancelled) setState('not_found')
          return
        }
        const data = await res.json() as {
          schedule: PublicSchedule
          sections?: ScheduleSection[]
          rows?: GanttRow[]
          analyticsResourceId?: string
        }
        if (cancelled) return
        setSchedule(data.schedule)
        if (data.sections && data.sections.length > 0) {
          setSections(data.sections)
        } else if (data.rows) {
          setSections([{
            id: 'fallback-gantt',
            type: 'gantt',
            title: 'Project schedule',
            subtitle: null,
            startWeek: null,
            endWeek: null,
            data: null,
            position: 0,
            rows: data.rows,
          }])
        }
        setAnalyticsResourceId(data.analyticsResourceId ?? null)
        setState('ok')
      } catch {
        if (!cancelled) setState('not_found')
      }
    }
    void load()
    return () => { cancelled = true }
  }, [token, previewScheduleId, isPreview])

  useShareViewTracking({
    resourceType: 'schedule',
    resourceId: analyticsResourceId,
    shareToken: isPreview ? null : token,
  })

  if (state === 'loading') {
    return (
      <div style={loadingWrap}>
        <div
          className="animate-pulse"
          style={{
            height: '8rem',
            width: '100%',
            maxWidth: '60rem',
            background: 'rgba(255,255,255,0.5)',
            borderRadius: '1rem',
          }}
        />
      </div>
    )
  }

  if (state === 'not_found' || !schedule) {
    return (
      <div style={loadingWrap}>
        <div style={{ textAlign: 'center', maxWidth: '24rem', padding: '2rem' }}>
          <BrandMark />
          <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: BRAND.ink, marginTop: '1rem', marginBottom: '0.5rem' }}>
            This link isn&apos;t available
          </h1>
          <p style={{ fontSize: '0.875rem', color: BRAND.muted, lineHeight: 1.5 }}>
            The schedule may have been revoked, or the link copied incorrectly. If you were expecting
            to see a project schedule, please reach out to the sender.
          </p>
        </div>
      </div>
    )
  }

  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null

  // Build cover metadata cells in the PDF order
  const metadata: MetadataCell[] = []
  if (schedule.preparedFor) metadata.push({ label: 'Prepared for', value: schedule.preparedFor })
  if (schedule.preparedBy) metadata.push({ label: 'Prepared by', value: schedule.preparedBy })
  if (schedule.effectiveDate) metadata.push({ label: 'Effective', value: fmtDate(schedule.effectiveDate) ?? schedule.effectiveDate })
  if (schedule.targetLaunchDate) metadata.push({ label: 'Target launch', value: fmtDate(schedule.targetLaunchDate) ?? schedule.targetLaunchDate })

  // Project label for page chrome (bottom-right of each page)
  const projectLabel = schedule.orgName
    ? `${schedule.orgName} × Tahi Studio · build plan`
    : `${schedule.title} · build plan`

  // Cover eyebrow: prefer subtitle, fall back to a sensible default
  const coverEyebrow = schedule.subtitle ?? 'PROJECT SCHEDULE · GANTT'

  return (
    <div style={pageWrap}>
      {/* Preview-mode pill — visible to admins viewing the live state */}
      {isPreview && (
        <div
          style={{
            position: 'fixed',
            top: '1rem',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 50,
            padding: '0.5rem 1rem',
            background: BRAND.ink,
            color: BRAND.surface,
            borderRadius: '999px',
            fontSize: '0.75rem',
            fontWeight: 600,
            letterSpacing: '0.04em',
            boxShadow: '0 8px 24px rgba(31, 44, 26, 0.25)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <span style={{ width: '0.5rem', height: '0.5rem', borderRadius: '50%', background: '#93c98a' }} />
          Admin preview · live, unpublished state
        </div>
      )}

      {/* Cover page */}
      <CoverPage
        eyebrow={coverEyebrow}
        title={schedule.title}
        metadata={metadata}
        projectLabel={projectLabel}
      />

      {/* Sections — each wrapped in PageChrome for the leaf + page-number frame.
          Section number is 1-indexed against the section list. */}
      {sections.map((section, i) => {
        const num = String(i + 1).padStart(2, '0')
        const name = (section.subtitle ?? defaultSectionName(section.type)).toUpperCase()
        return (
          <PageChrome
            key={section.id}
            sectionNumber={num}
            sectionName={name}
            projectLabel={projectLabel}
          >
            <SectionRenderer
              section={section}
              numberOfWeeks={schedule.numberOfWeeks}
              chrome={false}
            />
          </PageChrome>
        )
      })}

      {/* Footer */}
      <footer style={footer}>
        <BrandMark size="sm" />
        <span style={{ fontSize: '0.6875rem', color: BRAND.subtle }}>
          Confidential · prepared {fmtDate(schedule.effectiveDate) ?? 'this period'}
        </span>
      </footer>
    </div>
  )
}

function defaultSectionName(type: string): string {
  switch (type) {
    case 'overview':       return 'Executive overview'
    case 'gantt':          return 'High-level gantt'
    case 'risk_register':  return 'Risk & dependency register'
    case 'raci_matrix':    return 'RACI matrix'
    case 'text':           return 'Notes'
    default:               return type
  }
}

// ── Layout shells ─────────────────────────────────────────────────────────
//
// pageWrap: vertical-only padding so the cover bleeds edge-to-edge.
// Subsequent sections get their own horizontal padding via PageChrome
// (so they stay constrained at 76rem). Result: cover is wider and
// dramatic, sections stay readable.

const pageWrap: React.CSSProperties = {
  minHeight: '100vh',
  background: BRAND.band,
  fontFamily: 'var(--font-manrope, system-ui)',
  color: BRAND.ink,
  padding: 'clamp(1rem, 3vw, 1.5rem) 0',
  display: 'flex',
  flexDirection: 'column',
  gap: 'clamp(1.25rem, 3vw, 2rem)',
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
  padding: '1rem 1.5rem',
  borderTop: `1px solid ${BRAND.borderSubtle}`,
}

const loadingWrap: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: BRAND.band,
  padding: '2rem',
}
