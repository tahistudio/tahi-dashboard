/**
 * Section renderers for project schedules. Each function returns a slide-
 * style block that renders one section. Used by both the admin editor
 * (read-only display until the user clicks "Edit") and the public viewer.
 *
 * The renderers don't fetch data — they're pure given a section object.
 * The shape of `section.data` per type is documented in db/schema.ts.
 */
'use client'

import React from 'react'
import { GanttGrid, type GanttRow } from '@/components/tahi/gantt-grid'
import { GanttLegend } from '@/components/tahi/gantt-legend'
import { SectionHeader, AccentTitle } from '@/components/tahi/deliverable'

export type SectionType = 'overview' | 'gantt' | 'risk_register' | 'raci_matrix' | 'text'

export interface ScheduleSection {
  id: string
  type: SectionType
  title: string | null
  subtitle: string | null
  startWeek: number | null
  endWeek: number | null
  data: string | null              // JSON; type-specific
  position: number
  rows?: GanttRow[]                // populated for gantt sections by the API
}

interface RiskRow {
  id?: string
  risk: string
  owner: string
  impact: 'Critical' | 'High' | 'Medium' | 'Low' | string
  mitigation: string
  contractualImplication: string
}

interface RaciColumn { id: string; label: string }
interface RaciRow {
  id: string
  label: string
  group?: string | null
  cells: Record<string, 'R' | 'A' | 'C' | 'I' | undefined>
}
interface RaciData {
  columns: RaciColumn[]
  rows: RaciRow[]
  legend?: { R?: string; A?: string; C?: string; I?: string }
}

function safeParse<T>(json: string | null): T | null {
  if (!json) return null
  try { return JSON.parse(json) as T } catch { return null }
}

// ─── Slide chrome (eyebrow + title) ─────────────────────────────────────

interface SlideChromeProps {
  eyebrow?: string
  title?: string
  sub?: string | null
  /** When false, render content directly without the outer card chrome.
   *  Used by the public viewer which wraps each section in <PageChrome>
   *  from components/tahi/deliverable — so the SlideShell card would
   *  double up. Defaults to true to keep the admin editor unchanged. */
  chrome?: boolean
  children: React.ReactNode
}

export function SlideShell({ eyebrow, title, sub, chrome = true, children }: SlideChromeProps) {
  // chrome=false mode: render content with just SectionHeader (eyebrow
  // + accent title), no outer card. Lets the parent <PageChrome>
  // provide the page frame so the deliverable reads as one document.
  if (!chrome) {
    return (
      <div>
        {(eyebrow || title) && (
          <SectionHeader
            eyebrow={eyebrow ?? null}
            title={title ?? ''}
            body={sub}
          />
        )}
        {children}
      </div>
    )
  }
  return (
    <section style={slideShell}>
      {eyebrow && <div style={slideEyebrow}>{eyebrow}</div>}
      {title && (
        <AccentTitle text={title} size="md" as="h2" style={{ margin: 0 }} />
      )}
      {sub && <p style={slideSub}>{sub}</p>}
      <div style={{ marginTop: title || eyebrow ? '1.25rem' : 0 }}>{children}</div>
    </section>
  )
}

// ─── Per-type renderers ─────────────────────────────────────────────────

export function OverviewSection({ section, chrome = true }: { section: ScheduleSection; chrome?: boolean }) {
  const data = safeParse<{ html?: string }>(section.data)
  const html = data?.html ?? ''
  return (
    <SlideShell
      eyebrow={section.subtitle ?? 'Executive overview'}
      title={section.title ?? 'How {{it runs}}.'}
      chrome={chrome}
    >
      <div style={proseStyle} dangerouslySetInnerHTML={{ __html: html }} />
    </SlideShell>
  )
}

export function GanttSection({
  section,
  numberOfWeeks,
  chrome = true,
}: { section: ScheduleSection; numberOfWeeks: number; chrome?: boolean }) {
  const rows = section.rows ?? []
  // Optional zoom: when start/end set, render only those weeks. We map
  // global week indices into the local grid: a row spanning W3-W4 in a
  // section zoomed to W3-W6 renders at position 1-2 of the local grid.
  const zoomStart = section.startWeek ?? 1
  const zoomEnd = section.endWeek ?? numberOfWeeks
  const zoomed = section.startWeek != null || section.endWeek != null
  const localWeekCount = Math.max(1, zoomEnd - zoomStart + 1)

  const localRows: GanttRow[] = zoomed
    ? rows.map(r => {
        if (r.startWeek == null || r.endWeek == null) return r
        // Drop rows entirely outside the zoom window.
        if (r.endWeek < zoomStart || r.startWeek > zoomEnd) {
          return { ...r, startWeek: null, endWeek: null }
        }
        const newStart = Math.max(r.startWeek, zoomStart) - zoomStart + 1
        const newEnd = Math.min(r.endWeek, zoomEnd) - zoomStart + 1
        return { ...r, startWeek: newStart, endWeek: newEnd }
      })
    : rows

  return (
    <SlideShell
      eyebrow={section.subtitle ?? 'Project schedule'}
      title={section.title ?? 'Whole project, {{one view}}.'}
      sub={zoomed ? `Weeks ${zoomStart}–${zoomEnd}` : null}
      chrome={chrome}
    >
      <GanttGrid rows={localRows} numberOfWeeks={localWeekCount} />
      <div style={{ marginTop: '1rem' }}>
        <GanttLegend compact />
      </div>
    </SlideShell>
  )
}

export function RiskRegisterSection({ section, chrome = true }: { section: ScheduleSection; chrome?: boolean }) {
  const data = safeParse<{ rows?: RiskRow[] }>(section.data)
  const rows = data?.rows ?? []

  return (
    <SlideShell
      eyebrow={section.subtitle ?? 'Risk & dependency register'}
      title={section.title ?? 'What can {{slow this down}}, and who owns it.'}
      chrome={chrome}
    >
      {rows.length === 0 ? (
        <EmptyHint>No risks listed yet.</EmptyHint>
      ) : (
        <div style={tableWrap}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Risk / dependency</th>
                <th style={{ ...thStyle, width: '6rem' }}>Owner</th>
                <th style={{ ...thStyle, width: '5.5rem' }}>Impact</th>
                <th style={thStyle}>Mitigation</th>
                <th style={thStyle}>Contractual / timeline implication</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id ?? i} style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
                  <td style={tdLabelStyle}>{r.risk}</td>
                  <td style={tdStyle}>{r.owner}</td>
                  <td style={tdStyle}>
                    <ImpactPill level={r.impact} />
                  </td>
                  <td style={tdStyle}>{r.mitigation}</td>
                  <td style={tdStyle}>{r.contractualImplication}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SlideShell>
  )
}

export function RaciMatrixSection({ section, chrome = true }: { section: ScheduleSection; chrome?: boolean }) {
  const data = safeParse<RaciData>(section.data)
  const cols = data?.columns ?? []
  const rows = data?.rows ?? []

  // Group rows so we render section bands like "DISCOVERY & STRUCTURE"
  type Group = { name: string; rows: RaciRow[] }
  const groups: Group[] = []
  for (const row of rows) {
    const groupName = row.group ?? ''
    let g = groups[groups.length - 1]
    if (!g || g.name !== groupName) {
      g = { name: groupName, rows: [] }
      groups.push(g)
    }
    g.rows.push(row)
  }

  return (
    <SlideShell
      eyebrow={section.subtitle ?? 'RACI matrix'}
      title={section.title ?? 'Who is {{responsible}} for what.'}
      chrome={chrome}
    >
      {rows.length === 0 || cols.length === 0 ? (
        <EmptyHint>No RACI data yet.</EmptyHint>
      ) : (
        <>
          <div style={raciLegend}>
            <RaciKey k="R" label="Responsible (does the work)" />
            <RaciKey k="A" label="Accountable (signs off)" />
            <RaciKey k="C" label="Consulted (provides input)" />
            <RaciKey k="I" label="Informed (kept in the loop)" />
          </div>
          <div style={tableWrap}>
            <table style={{ ...tableStyle, minWidth: `${20 + cols.length * 7}rem` }}>
              <thead>
                <tr>
                  <th style={thStyle}>Workstream / decision</th>
                  {cols.map(c => (
                    <th key={c.id} style={{ ...thStyle, width: '6rem', textAlign: 'center' }}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.flatMap(g => [
                  g.name ? (
                    <tr key={`group-${g.name}`} style={{ background: '#1f2c1a', color: '#ffffff' }}>
                      <td colSpan={cols.length + 1} style={{ padding: '0.5rem 0.875rem', fontSize: '0.6875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        {g.name}
                      </td>
                    </tr>
                  ) : null,
                  ...g.rows.map(r => (
                    <tr key={r.id} style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
                      <td style={tdLabelStyle}>{r.label}</td>
                      {cols.map(c => (
                        <td key={c.id} style={{ ...tdStyle, textAlign: 'center', padding: '0.5rem' }}>
                          <RaciCell value={r.cells?.[c.id]} />
                        </td>
                      ))}
                    </tr>
                  )),
                ])}
              </tbody>
            </table>
          </div>
        </>
      )}
    </SlideShell>
  )
}

export function TextSection({ section, chrome = true }: { section: ScheduleSection; chrome?: boolean }) {
  const data = safeParse<{ html?: string }>(section.data)
  const html = data?.html ?? ''
  return (
    <SlideShell
      eyebrow={section.subtitle ?? undefined}
      title={section.title ?? undefined}
      chrome={chrome}
    >
      <div style={proseStyle} dangerouslySetInnerHTML={{ __html: html }} />
    </SlideShell>
  )
}

// ─── Dispatcher ─────────────────────────────────────────────────────────

export function SectionRenderer({
  section, numberOfWeeks, chrome = true,
}: { section: ScheduleSection; numberOfWeeks: number; chrome?: boolean }) {
  switch (section.type) {
    case 'overview':       return <OverviewSection section={section} chrome={chrome} />
    case 'gantt':          return <GanttSection section={section} numberOfWeeks={numberOfWeeks} chrome={chrome} />
    case 'risk_register':  return <RiskRegisterSection section={section} chrome={chrome} />
    case 'raci_matrix':    return <RaciMatrixSection section={section} chrome={chrome} />
    case 'text':           return <TextSection section={section} chrome={chrome} />
    default:               return <SlideShell chrome={chrome} title="Unknown section type"><EmptyHint>Type {section.type} is not yet supported.</EmptyHint></SlideShell>
  }
}

// ─── Subcomponents ──────────────────────────────────────────────────────

function ImpactPill({ level }: { level: string }) {
  const norm = level?.toLowerCase()
  let bg = '#e8f0e6'
  let fg = '#5a6657'
  if (norm === 'critical') { bg = '#fef2f2'; fg = '#dc2626' }
  else if (norm === 'high') { bg = '#fff7ed'; fg = '#c2410c' }
  else if (norm === 'medium') { bg = '#fefce8'; fg = '#a16207' }
  else if (norm === 'low') { bg = '#f0fdf4'; fg = '#15803d' }
  return (
    <span style={{
      display: 'inline-block',
      padding: '0.125rem 0.5rem',
      fontSize: '0.6875rem',
      fontWeight: 700,
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
      borderRadius: 'var(--radius-full)',
      background: bg,
      color: fg,
    }}>
      {level}
    </span>
  )
}

function RaciCell({ value }: { value: 'R' | 'A' | 'C' | 'I' | undefined }) {
  if (!value) return <span style={{ color: '#cdd5cb' }}>·</span>
  // Map letter → swatch colour. R/A use brand; C/I are neutrals so the
  // primary-responsible cells pop visually.
  const palette: Record<string, { bg: string; fg: string }> = {
    R: { bg: '#5A824E', fg: '#ffffff' },
    A: { bg: '#d4a017', fg: '#ffffff' },
    C: { bg: '#e8f0e6', fg: '#1f2c1a' },
    I: { bg: '#f5f7f5', fg: '#5a6657' },
  }
  const { bg, fg } = palette[value]
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '1.5rem',
      height: '1.5rem',
      borderRadius: 'var(--radius-full)',
      background: bg,
      color: fg,
      fontSize: '0.6875rem',
      fontWeight: 700,
      letterSpacing: '0.04em',
    }}>
      {value}
    </span>
  )
}

function RaciKey({ k, label }: { k: 'R' | 'A' | 'C' | 'I'; label: string }) {
  return (
    <span className="inline-flex items-center" style={{ gap: '0.4375rem', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
      <RaciCell value={k} />
      {label}
    </span>
  )
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: '1.25rem',
        textAlign: 'center',
        background: 'var(--color-bg-secondary)',
        border: '1px dashed var(--color-border)',
        borderRadius: 'var(--radius-md)',
        fontSize: '0.8125rem',
        color: 'var(--color-text-subtle)',
      }}
    >
      {children}
    </div>
  )
}

// ─── Styles ─────────────────────────────────────────────────────────────

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

const proseStyle: React.CSSProperties = {
  fontSize: '0.9375rem',
  lineHeight: 1.7,
  color: '#1f2c1a',
}

const tableWrap: React.CSSProperties = {
  overflowX: 'auto',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-md)',
}

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.8125rem',
  textAlign: 'left',
}

const thStyle: React.CSSProperties = {
  padding: '0.625rem 0.875rem',
  background: 'var(--color-bg-secondary)',
  fontSize: '0.6875rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--color-text-muted)',
  borderBottom: '1px solid var(--color-border)',
  whiteSpace: 'nowrap',
}

const tdStyle: React.CSSProperties = {
  padding: '0.625rem 0.875rem',
  color: 'var(--color-text-muted)',
  verticalAlign: 'top',
}

const tdLabelStyle: React.CSSProperties = {
  ...tdStyle,
  color: 'var(--color-text)',
  fontWeight: 600,
}

const raciLegend: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '1rem',
  marginBottom: '0.875rem',
}
