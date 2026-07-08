'use client'

// ─── The Studio (the AHEAD zone, right) ──────────────────────────────────────
//
// Capacity rendered as BEAKERS: one upright vessel per team member, filled with
// brand-green liquid proportional to allocated / weekly capacity. Amber above 90%,
// red above 100% (over the brim). The percentage sits beneath each beaker; the
// member name (data-private) beneath that. One plain-English verdict line is
// derived from overall utilisation. A small live ember (.workshop-pulse) rides a
// beaker only if the data exposes a running-timer signal for that member; we never
// invent it. See SPECS/homepage-studio-ledger.md (The Studio / two beakers + verdict).
//
// Reuses PipelineCapacityCard's fetch verbatim: /api/admin/pipeline/capacity.

import useSWR from 'swr'

interface CapacityMember {
  id: string
  name: string
  weeklyCapacityHours: number
  currentHoursAllocated: number
  utilization: number
  // Optional running-timer signal. The capacity endpoint does not currently
  // emit this; when it does, the ember lights up. Until then it stays absent.
  hasRunningTimer?: boolean
}

interface CapacityData {
  teamMembers: CapacityMember[]
  totalCapacity: number
  totalAllocated: number
  pipelineImpact: number
  availableCapacity: number
  forecastedCapacity: number
}

export function StudioCapacity({ className }: { className?: string }) {
  const { data, isLoading: loading } = useSWR<CapacityData>('/api/admin/pipeline/capacity')

  const shell: React.CSSProperties = {
    background: 'var(--color-bg)',
    border: '1px solid var(--color-border-subtle)',
    borderRadius: 'var(--radius-lg)',
    padding: 'var(--space-6)',
  }

  if (loading) {
    return (
      <section aria-label="The studio" className={className} style={shell}>
        <Header />
        <div className="flex flex-wrap" style={{ gap: 'var(--space-5)' }}>
          {[0, 1].map(n => (
            <div key={n} className="flex flex-col items-center" style={{ gap: 'var(--space-2)' }}>
              <div className="tahi-shimmer" style={{ height: '5.5rem', width: '2.75rem' }} />
              <div className="tahi-shimmer" style={{ height: '0.75rem', width: '3rem' }} />
            </div>
          ))}
        </div>
      </section>
    )
  }

  const members = data?.teamMembers ?? []

  if (members.length === 0) {
    return (
      <section aria-label="The studio" className={className} style={shell}>
        <Header />
        <p style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-muted)', lineHeight: 1.55 }}>
          No one in the studio yet. Add team members and log hours to fill the beakers.
        </p>
      </section>
    )
  }

  const overallUtil = data && data.totalCapacity > 0
    ? Math.round((data.totalAllocated / data.totalCapacity) * 100)
    : 0
  const verdict = verdictLine(overallUtil, data?.totalCapacity ?? 0, data?.totalAllocated ?? 0)

  return (
    <section aria-label="The studio" className={className} style={shell}>
      <Header />

      {/* Beakers — wrap on mobile, stay tidy. */}
      <div
        className="flex flex-wrap"
        style={{ gap: 'var(--space-5)', rowGap: 'var(--space-4)', marginBottom: 'var(--space-5)' }}
      >
        {members.map(m => (
          <Beaker key={m.id} member={m} />
        ))}
      </div>

      {/* Plain-English verdict sill */}
      <div
        className="flex items-center"
        style={{
          gap: 'var(--space-2-5)',
          paddingTop: 'var(--space-4)',
          borderTop: '1px solid var(--color-border-subtle)',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: '0.5rem',
            height: '0.5rem',
            borderRadius: 'var(--radius-full)',
            background: verdict.colour,
            flexShrink: 0,
          }}
        />
        <p style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--color-text)', lineHeight: 1.5 }}>
          {verdict.text}
        </p>
      </div>
    </section>
  )
}

// ─── A single beaker ──────────────────────────────────────────────────────────

const BEAKER_HEIGHT = '5.5rem'
const BEAKER_WIDTH = '2.75rem'

function Beaker({ member }: { member: CapacityMember }) {
  const util = Math.max(0, member.utilization)
  // Fill height capped at 100% of the vessel; the colour signals overflow.
  const fillPct = Math.min(util, 100)
  const fillColour =
    util > 100 ? 'var(--color-danger)' : util > 90 ? 'var(--color-warning)' : 'var(--color-brand)'
  const pctColour =
    util > 100 ? 'var(--color-danger)' : util > 90 ? 'var(--color-due-soon-text)' : 'var(--color-text)'

  return (
    <div className="flex flex-col items-center" style={{ gap: 'var(--space-2)', minWidth: BEAKER_WIDTH }}>
      {/* Vessel */}
      <div
        style={{
          position: 'relative',
          width: BEAKER_WIDTH,
          height: BEAKER_HEIGHT,
          background: 'var(--color-bg-tertiary)',
          border: '1px solid var(--color-border)',
          borderRadius: '0 0 var(--radius-md) var(--radius-md)',
          overflow: 'hidden',
        }}
        role="img"
        aria-label={`${util}% utilised`}
      >
        {/* Liquid fill */}
        <div
          className="studio-beaker-fill"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: `${fillPct}%`,
            background: fillColour,
            opacity: 0.85,
          }}
        />
        {/* Brim line at the top — quiet hairline marking the 100% level. */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 1,
            background: 'var(--color-border)',
          }}
        />
        {/* Live ember — only when a running-timer signal is present in the data. */}
        {member.hasRunningTimer && (
          <span
            className="workshop-pulse"
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: '0.25rem',
              right: '0.25rem',
              width: '0.4375rem',
              height: '0.4375rem',
              borderRadius: 'var(--radius-full)',
              background: 'var(--color-brand)',
              display: 'inline-block',
            }}
          />
        )}
      </div>

      {/* Percentage */}
      <span className="tabular-nums" style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: pctColour, lineHeight: 1 }}>
        {util}%
      </span>

      {/* Member name */}
      <span
        data-private
        className="truncate"
        style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', maxWidth: '5rem', textAlign: 'center' }}
      >
        {firstName(member.name)}
      </span>
    </div>
  )
}

// ─── Verdict from overall utilisation ─────────────────────────────────────────

function verdictLine(util: number, totalCapacity: number, totalAllocated: number): { text: string; colour: string } {
  if (util > 100) {
    // Over-committed by N hours (allocated beyond total capacity).
    const overH = Math.max(0, Math.round(totalAllocated - totalCapacity))
    return { text: `Over-committed by ${overH}h`, colour: 'var(--color-danger)' }
  }
  if (util >= 90) {
    return { text: 'Fully committed', colour: 'var(--color-warning)' }
  }
  if (util >= 70) {
    return { text: 'About right', colour: 'var(--color-brand)' }
  }
  return { text: 'Room for one more project', colour: 'var(--color-brand)' }
}

// ─── Letterpress zone header ──────────────────────────────────────────────────

function Header() {
  return (
    <p
      style={{
        fontSize: 'var(--text-2xs, 0.6875rem)',
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--color-text-subtle)',
        marginBottom: 'var(--space-5)',
      }}
    >
      The Studio
    </p>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name
}
