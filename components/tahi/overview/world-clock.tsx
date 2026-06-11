'use client'

// ─── World Clock + Meeting Planner ────────────────────────────────────────────
//
// Liam's second FIRM must-have for "The Studio Ledger, lit" (SPECS/homepage-lit.md,
// card 10). The page's most delightful + useful single widget. Domain OPS
// (achromatic warm ink + one teal accent on the live scrubber). Pure client-side:
// Intl.DateTimeFormat with timeZone, settings persisted to localStorage under
// 'tahi-world-clock'. NO backend, no client data, so no data-private needed.
//
//   <WorldClock />
//
// Three features:
//   (a) LIVE CLOCKS - current time in a set of IANA zones (default NZ home + NY +
//       London + Sydney). Each row: city label, live time, and the day/offset
//       relative to home. Mount-gated so SSR never renders a clock (no hydration
//       mismatch). The shared 1s tick drives the live face.
//   (b) ZONE PICKER - add/remove zones from a curated IANA list; the chosen set
//       persists to localStorage.
//   (c) THE CONVERTER - a draggable 24h time SCRUBBER in the HOME zone plus a day
//       selector (Today / +1 / +2...). Dragging (or arrowing - it is a real
//       role=slider with aria-valuenow + full keyboard) recomputes every zone
//       clock to show that reference instant converted into each zone, with the
//       date shown when a zone crosses midnight. A "Now" button snaps back to live.
//
// The shell matches cash-runway/domain-card: var(--color-bg) surface, 1px hairline
// (borders not shadows), radius-lg, space-6 padding. tabular-nums on every time.
// Reduced-motion safe (no perpetual motion; the only movement is the shared tick
// and direct drag). 44px touch target on the scrubber thumb + all controls.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Globe, Plus, X, RotateCcw } from 'lucide-react'
import { IconChip } from './domain-card'
import { useSharedTick } from '@/lib/use-homepage-motion'

// ── Zone catalogue ────────────────────────────────────────────────────────────
//
// A curated, sensible IANA set. label is the human city; zone is the IANA id.
// The home zone is always Pacific/Auckland (the studio).

const HOME_ZONE = 'Pacific/Auckland'

interface ZoneDef {
  zone: string
  label: string
}

const ZONE_CATALOGUE: ZoneDef[] = [
  { zone: 'Pacific/Auckland', label: 'Auckland' },
  { zone: 'Australia/Sydney', label: 'Sydney' },
  { zone: 'Australia/Melbourne', label: 'Melbourne' },
  { zone: 'Australia/Perth', label: 'Perth' },
  { zone: 'Asia/Singapore', label: 'Singapore' },
  { zone: 'Asia/Dubai', label: 'Dubai' },
  { zone: 'Europe/London', label: 'London' },
  { zone: 'Europe/Dublin', label: 'Dublin' },
  { zone: 'Europe/Paris', label: 'Paris' },
  { zone: 'Europe/Berlin', label: 'Berlin' },
  { zone: 'Europe/Amsterdam', label: 'Amsterdam' },
  { zone: 'Europe/Lisbon', label: 'Lisbon' },
  { zone: 'America/New_York', label: 'New York' },
  { zone: 'America/Chicago', label: 'Chicago' },
  { zone: 'America/Denver', label: 'Denver' },
  { zone: 'America/Los_Angeles', label: 'Los Angeles' },
  { zone: 'America/Toronto', label: 'Toronto' },
  { zone: 'America/Sao_Paulo', label: 'Sao Paulo' },
  { zone: 'Asia/Tokyo', label: 'Tokyo' },
  { zone: 'Asia/Kolkata', label: 'Mumbai' },
]

const DEFAULT_ZONES = ['Pacific/Auckland', 'America/New_York', 'Europe/London', 'Australia/Sydney']

const STORAGE_KEY = 'tahi-world-clock'

function labelFor(zone: string): string {
  const found = ZONE_CATALOGUE.find(z => z.zone === zone)
  if (found) return found.label
  // Fall back to the last IANA segment, underscores to spaces.
  const seg = zone.split('/').pop() ?? zone
  return seg.replace(/_/g, ' ')
}

// ── Time math ─────────────────────────────────────────────────────────────────

// The numeric offset (minutes) of a zone at a given instant, derived purely from
// Intl (DST-correct without any library). We format the same instant as UTC vs
// the target zone and diff the wall-clock readings.
function zoneOffsetMinutes(zone: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = dtf.formatToParts(at)
  const map: Record<string, string> = {}
  for (const p of parts) map[p.type] = p.value
  // Intl renders hour "24" at midnight in some engines; normalise to 00.
  const hour = map.hour === '24' ? '00' : map.hour
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(hour),
    Number(map.minute),
    Number(map.second),
  )
  return Math.round((asUtc - at.getTime()) / 60000)
}

interface ZoneFace {
  hour: number
  minute: number
  weekday: string
  dayLabel: string // "Mon 16" etc
  dayDelta: number // calendar-day diff vs the home zone (-1, 0, +1...)
  offsetLabel: string // "+1h", "same", "-13h" relative to home
}

const TIME_FMT_CACHE = new Map<string, Intl.DateTimeFormat>()
function timeFmt(zone: string): Intl.DateTimeFormat {
  let f = TIME_FMT_CACHE.get(zone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-NZ', {
      timeZone: zone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      weekday: 'short',
      day: 'numeric',
    })
    TIME_FMT_CACHE.set(zone, f)
  }
  return f
}

function describeZone(zone: string, instant: Date, homeOffset: number): ZoneFace {
  const parts = timeFmt(zone).formatToParts(instant)
  const map: Record<string, string> = {}
  for (const p of parts) map[p.type] = p.value
  const hour = map.hour === '24' ? 0 : Number(map.hour)
  const minute = Number(map.minute)
  const weekday = map.weekday ?? ''
  const day = map.day ?? ''

  const offset = zoneOffsetMinutes(zone, instant)
  const deltaMin = offset - homeOffset
  // Day delta vs home: compare local calendar dates of the same instant.
  const dayDelta = calendarDayDelta(zone, HOME_ZONE, instant)

  return {
    hour,
    minute,
    weekday,
    dayLabel: `${weekday} ${day}`,
    dayDelta,
    offsetLabel: formatDeltaHours(deltaMin),
  }
}

// Whole-calendar-day difference between two zones for the same instant.
function calendarDayDelta(zone: string, homeZone: string, instant: Date): number {
  const ds = (z: string) => {
    const p = new Intl.DateTimeFormat('en-CA', {
      timeZone: z,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(instant) // YYYY-MM-DD
    return p
  }
  const a = ds(zone)
  const b = ds(homeZone)
  if (a === b) return 0
  const da = Date.parse(`${a}T00:00:00Z`)
  const db = Date.parse(`${b}T00:00:00Z`)
  return Math.round((da - db) / 86400000)
}

function formatDeltaHours(deltaMin: number): string {
  if (deltaMin === 0) return 'same time'
  const sign = deltaMin > 0 ? '+' : '-'
  const abs = Math.abs(deltaMin)
  const h = Math.floor(abs / 60)
  const m = abs % 60
  return m === 0 ? `${sign}${h}h` : `${sign}${h}h${m}m`
}

function dayDeltaLabel(delta: number): string {
  if (delta === 0) return ''
  if (delta === 1) return 'next day'
  if (delta === -1) return 'prev day'
  return delta > 0 ? `+${delta} days` : `${delta} days`
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

// ── localStorage helpers ──────────────────────────────────────────────────────

function loadZones(): string[] {
  if (typeof window === 'undefined') return DEFAULT_ZONES
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_ZONES
    const parsed = JSON.parse(raw) as { zones?: unknown }
    const zones = Array.isArray(parsed.zones) ? parsed.zones.filter((z): z is string => typeof z === 'string') : null
    if (!zones || zones.length === 0) return DEFAULT_ZONES
    // Home zone is always present and first.
    const withHome = zones.includes(HOME_ZONE) ? zones : [HOME_ZONE, ...zones]
    return [HOME_ZONE, ...withHome.filter(z => z !== HOME_ZONE)]
  } catch {
    return DEFAULT_ZONES
  }
}

function saveZones(zones: string[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ zones }))
  } catch {
    /* storage full / disabled: non-fatal, settings just won't persist */
  }
}

// ── Component ───────────────────────────────────────────────────────────────────

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 'var(--text-2xs, 0.6875rem)',
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--color-text-muted)',
}

export function WorldClock({ className }: { className?: string }) {
  const [mounted, setMounted] = useState(false)
  const [zones, setZones] = useState<string[]>(DEFAULT_ZONES)
  const [pickerOpen, setPickerOpen] = useState(false)

  // Converter state: minutes-from-midnight (0..1439) in the HOME zone, the day
  // offset (0 = today), and whether we are tracking live "Now".
  const [live, setLive] = useState(true)
  const [scrubMinutes, setScrubMinutes] = useState(0)
  const [dayOffset, setDayOffset] = useState(0)

  // Shared 1s tick: drives live faces. We also read it so the live converter
  // instant refreshes each second.
  useSharedTick(1000)

  useEffect(() => {
    setMounted(true)
    setZones(loadZones())
  }, [])

  // The instant we are showing. Live = now. Otherwise = home midnight + dayOffset
  // days + scrubMinutes, expressed as a real UTC instant.
  const instant = useMemo(() => {
    if (live) return new Date()
    return referenceInstant(scrubMinutes, dayOffset)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, scrubMinutes, dayOffset, mounted])

  const homeOffset = useMemo(() => zoneOffsetMinutes(HOME_ZONE, instant), [instant])

  const addZone = useCallback(
    (zone: string) => {
      setZones(prev => {
        if (prev.includes(zone)) return prev
        const next = [...prev, zone]
        saveZones(next)
        return next
      })
    },
    [],
  )

  const removeZone = useCallback((zone: string) => {
    if (zone === HOME_ZONE) return // home is permanent
    setZones(prev => {
      const next = prev.filter(z => z !== zone)
      saveZones(next)
      return next
    })
  }, [])

  // Enter scrub mode seeded at the current home wall-clock so dragging starts
  // from "now" rather than midnight.
  const beginScrub = useCallback(() => {
    const now = new Date()
    const face = describeZone(HOME_ZONE, now, zoneOffsetMinutes(HOME_ZONE, now))
    setScrubMinutes(face.hour * 60 + face.minute)
    setDayOffset(0)
    setLive(false)
  }, [])

  const goNow = useCallback(() => {
    setLive(true)
    setDayOffset(0)
  }, [])

  return (
    <section
      aria-label="World clock and meeting planner"
      className={className}
      style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-6)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between" style={{ gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
        <div className="flex items-center" style={{ gap: 'var(--space-2-5)', minWidth: 0 }}>
          <IconChip domain="ops">
            <Globe size={15} />
          </IconChip>
          <h2 style={LABEL_STYLE}>World clock</h2>
        </div>
        <button
          type="button"
          onClick={() => setPickerOpen(o => !o)}
          aria-expanded={pickerOpen}
          aria-label={pickerOpen ? 'Close zone picker' : 'Add a time zone'}
          className="tahi-press flex items-center justify-center"
          style={{
            width: '2.25rem',
            height: '2.25rem',
            flexShrink: 0,
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            background: pickerOpen ? 'var(--color-bg-secondary)' : 'transparent',
            color: 'var(--color-text-muted)',
            cursor: 'pointer',
          }}
        >
          {pickerOpen ? <X size={15} aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}
        </button>
      </div>

      {/* Mount-gate everything time-dependent so SSR renders nothing time-based */}
      {!mounted ? (
        <div className="tahi-shimmer" style={{ height: '9rem', width: '100%', borderRadius: 'var(--radius-md)' }} />
      ) : (
        <>
          {pickerOpen && (
            <ZonePicker selected={zones} onAdd={addZone} onClose={() => setPickerOpen(false)} />
          )}

          {/* Clock rows */}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {zones.map(zone => (
              <ClockRow
                key={zone}
                zone={zone}
                instant={instant}
                homeOffset={homeOffset}
                isHome={zone === HOME_ZONE}
                live={live}
                onRemove={() => removeZone(zone)}
              />
            ))}
          </ul>

          {/* The converter */}
          <Converter
            live={live}
            scrubMinutes={scrubMinutes}
            dayOffset={dayOffset}
            onScrub={mins => {
              setScrubMinutes(mins)
              if (live) setLive(false)
            }}
            onBeginScrub={beginScrub}
            onDayOffset={delta => {
              setDayOffset(delta)
              if (live) beginScrub()
            }}
            onNow={goNow}
            instant={instant}
          />
        </>
      )}
    </section>
  )
}

// ── Reference instant ───────────────────────────────────────────────────────────
//
// Build a real UTC instant for "home wall clock = midnight + dayOffset days +
// scrubMinutes". We solve it by taking today's home date, advancing the date,
// and finding the instant whose home wall-clock matches the requested minutes.
function referenceInstant(scrubMinutes: number, dayOffset: number): Date {
  const now = new Date()
  // Home calendar date today.
  const homeDateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: HOME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now) // YYYY-MM-DD
  const [y, m, d] = homeDateStr.split('-').map(Number)

  const hour = Math.floor(scrubMinutes / 60)
  const minute = scrubMinutes % 60

  // First guess: treat the wanted wall-clock as if it were UTC, then correct by
  // the home offset at that approximate instant (two passes handle DST edges).
  let guess = Date.UTC(y, m - 1, d + dayOffset, hour, minute, 0)
  for (let i = 0; i < 2; i++) {
    const off = zoneOffsetMinutes(HOME_ZONE, new Date(guess))
    guess = Date.UTC(y, m - 1, d + dayOffset, hour, minute, 0) - off * 60000
  }
  return new Date(guess)
}

// ── Clock row ───────────────────────────────────────────────────────────────────

function ClockRow({
  zone,
  instant,
  homeOffset,
  isHome,
  live,
  onRemove,
}: {
  zone: string
  instant: Date
  homeOffset: number
  isHome: boolean
  live: boolean
  onRemove: () => void
}) {
  const face = describeZone(zone, instant, homeOffset)
  const dayNote = dayDeltaLabel(face.dayDelta)

  return (
    <li
      className="world-clock-row flex items-center justify-between"
      style={{
        gap: 'var(--space-3)',
        padding: 'var(--space-2-5) 0',
        borderBottom: '1px solid var(--color-border-subtle)',
        minWidth: 0,
      }}
    >
      {/* Left: city + offset / day note */}
      <div style={{ minWidth: 0 }}>
        <div className="flex items-center" style={{ gap: 'var(--space-1-5)' }}>
          <span
            style={{
              fontSize: 'var(--text-sm)',
              fontWeight: 600,
              color: 'var(--color-text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {labelFor(zone)}
          </span>
          {isHome && (
            <span
              style={{
                fontSize: 'var(--text-2xs, 0.6875rem)',
                fontWeight: 600,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: 'var(--domain-delivery)',
              }}
            >
              home
            </span>
          )}
        </div>
        <div
          className="flex items-center"
          style={{ gap: 'var(--space-1-5)', fontSize: 'var(--text-2xs, 0.6875rem)', color: 'var(--color-text-subtle)' }}
        >
          <span>{isHome ? 'reference' : face.offsetLabel}</span>
          {dayNote && (
            <>
              <span aria-hidden="true" style={{ opacity: 0.6 }}>&middot;</span>
              <span style={{ color: 'var(--color-text-muted)' }}>{dayNote}</span>
            </>
          )}
        </div>
      </div>

      {/* Right: the time + weekday/date + remove */}
      <div className="flex items-center" style={{ gap: 'var(--space-2)', flexShrink: 0 }}>
        <div style={{ textAlign: 'right' }}>
          <div
            className="tabular-nums"
            style={{
              fontSize: 'var(--text-lg)',
              fontWeight: 700,
              lineHeight: 1.1,
              color: live ? 'var(--color-text)' : 'var(--domain-delivery)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {pad2(face.hour)}:{pad2(face.minute)}
          </div>
          <div style={{ fontSize: 'var(--text-2xs, 0.6875rem)', color: 'var(--color-text-subtle)' }}>
            {face.dayLabel}
          </div>
        </div>
        {!isHome && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${labelFor(zone)}`}
            className="world-clock-remove tahi-press flex items-center justify-center"
            style={{
              width: '1.75rem',
              height: '1.75rem',
              border: 'none',
              background: 'transparent',
              color: 'var(--color-text-subtle)',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
            }}
          >
            <X size={13} aria-hidden="true" />
          </button>
        )}
      </div>
    </li>
  )
}

// ── Zone picker ─────────────────────────────────────────────────────────────────

function ZonePicker({
  selected,
  onAdd,
  onClose,
}: {
  selected: string[]
  onAdd: (zone: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const q = query.trim().toLowerCase()
  const available = ZONE_CATALOGUE.filter(
    z => !selected.includes(z.zone) && (q === '' || z.label.toLowerCase().includes(q) || z.zone.toLowerCase().includes(q)),
  )

  return (
    <div
      style={{
        marginBottom: 'var(--space-4)',
        padding: 'var(--space-3)',
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') onClose()
        }}
        placeholder="Search a city to add"
        aria-label="Search a city to add"
        style={{
          width: '100%',
          minHeight: '2.5rem',
          padding: '0 var(--space-3)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--color-bg)',
          fontSize: 'var(--text-sm)',
          color: 'var(--color-text)',
          outline: 'none',
        }}
      />
      <div className="flex flex-wrap" style={{ gap: 'var(--space-1-5)', marginTop: 'var(--space-3)' }}>
        {available.length === 0 ? (
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}>
            {q ? 'No matching cities.' : 'All cities added.'}
          </p>
        ) : (
          available.slice(0, 12).map(z => (
            <button
              key={z.zone}
              type="button"
              onClick={() => onAdd(z.zone)}
              className="world-clock-chip tahi-press flex items-center"
              style={{
                gap: 'var(--space-1)',
                minHeight: '2.25rem',
                padding: '0 var(--space-3)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-full)',
                background: 'var(--color-bg)',
                color: 'var(--color-text-muted)',
                fontSize: 'var(--text-xs)',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              <Plus size={12} aria-hidden="true" /> {z.label}
            </button>
          ))
        )}
      </div>
    </div>
  )
}

// ── The converter (draggable scrubber + day selector) ─────────────────────────

const DAY_OPTIONS = [0, 1, 2, 3, 4, 5, 6]
const MAX_MINUTES = 24 * 60 - 1

function Converter({
  live,
  scrubMinutes,
  dayOffset,
  onScrub,
  onBeginScrub,
  onDayOffset,
  onNow,
  instant,
}: {
  live: boolean
  scrubMinutes: number
  dayOffset: number
  onScrub: (mins: number) => void
  onBeginScrub: () => void
  onDayOffset: (delta: number) => void
  onNow: () => void
  instant: Date
}) {
  // The reference label is the home wall-clock at the shown instant.
  const homeFace = describeZone(HOME_ZONE, instant, zoneOffsetMinutes(HOME_ZONE, instant))
  const refMinutes = live ? homeFace.hour * 60 + homeFace.minute : scrubMinutes
  const refLabel = `${pad2(Math.floor(refMinutes / 60))}:${pad2(refMinutes % 60)}`

  // Day label for the chosen offset, computed from the home date.
  const dayLabels = useMemo(() => buildDayLabels(), [])

  const handleSliderInput = useCallback(
    (raw: number) => {
      const clamped = Math.max(0, Math.min(MAX_MINUTES, Math.round(raw)))
      onScrub(clamped)
    },
    [onScrub],
  )

  return (
    <div style={{ marginTop: 'var(--space-5)' }}>
      <div className="flex items-center justify-between" style={{ gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
        <p style={LABEL_STYLE}>Meeting planner</p>
        <button
          type="button"
          onClick={onNow}
          className="tahi-press flex items-center"
          aria-pressed={live}
          style={{
            gap: 'var(--space-1)',
            minHeight: '1.75rem',
            padding: '0 var(--space-2-5)',
            border: '1px solid',
            borderColor: live ? 'var(--domain-delivery)' : 'var(--color-border)',
            borderRadius: 'var(--radius-full)',
            background: live ? 'var(--domain-delivery-tint)' : 'transparent',
            color: live ? 'var(--domain-delivery)' : 'var(--color-text-muted)',
            fontSize: 'var(--text-2xs, 0.6875rem)',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <RotateCcw size={11} aria-hidden="true" /> Now
        </button>
      </div>

      {/* Reference readout */}
      <div className="flex items-baseline" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
        <span
          className="tabular-nums"
          style={{
            fontSize: 'var(--text-2xl)',
            fontWeight: 700,
            lineHeight: 1,
            letterSpacing: '-0.01em',
            color: live ? 'var(--color-text)' : 'var(--domain-delivery)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {refLabel}
        </span>
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
          {dayLabels[dayOffset] ?? 'Today'} in {labelFor(HOME_ZONE)}
        </span>
      </div>

      {/* The scrubber: a real range input (drag + keyboard + a11y). */}
      <input
        type="range"
        min={0}
        max={MAX_MINUTES}
        step={15}
        value={refMinutes}
        onPointerDown={() => {
          if (live) onBeginScrub()
        }}
        onChange={e => handleSliderInput(Number(e.target.value))}
        aria-label="Reference time of day in Auckland"
        aria-valuetext={`${refLabel} ${dayLabels[dayOffset] ?? 'Today'} in Auckland`}
        className="world-clock-scrubber"
        style={{ width: '100%' }}
      />

      {/* Hour ticks under the scrubber */}
      <div
        aria-hidden="true"
        className="flex items-center justify-between"
        style={{ marginTop: 'var(--space-1)', fontSize: 'var(--text-2xs, 0.6875rem)', color: 'var(--color-text-subtle)' }}
      >
        <span className="tabular-nums">00</span>
        <span className="tabular-nums">06</span>
        <span className="tabular-nums">12</span>
        <span className="tabular-nums">18</span>
        <span className="tabular-nums">24</span>
      </div>

      {/* Day selector */}
      <div className="flex flex-wrap" style={{ gap: 'var(--space-1-5)', marginTop: 'var(--space-4)' }} role="group" aria-label="Day">
        {DAY_OPTIONS.map(offset => {
          const selected = !live && dayOffset === offset
          return (
            <button
              key={offset}
              type="button"
              onClick={() => onDayOffset(offset)}
              aria-pressed={selected}
              className="tahi-press"
              style={{
                minHeight: '2.25rem',
                minWidth: '2.75rem',
                padding: '0 var(--space-2-5)',
                border: '1px solid',
                borderColor: selected ? 'var(--domain-delivery)' : 'var(--color-border)',
                borderRadius: 'var(--radius-md)',
                background: selected ? 'var(--domain-delivery-tint)' : 'transparent',
                color: selected ? 'var(--domain-delivery)' : 'var(--color-text-muted)',
                fontSize: 'var(--text-xs)',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {dayLabels[offset]}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// Build short day labels (Today, Tomorrow, then weekday names) from the home date.
function buildDayLabels(): string[] {
  const now = new Date()
  const homeDateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: HOME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  const [y, m, d] = homeDateStr.split('-').map(Number)
  const labels: string[] = []
  for (let i = 0; i < 7; i++) {
    if (i === 0) {
      labels.push('Today')
    } else if (i === 1) {
      labels.push('Tomorrow')
    } else {
      // Use a UTC date purely to read the weekday name for the home date + i.
      const dt = new Date(Date.UTC(y, m - 1, d + i))
      labels.push(new Intl.DateTimeFormat('en-NZ', { weekday: 'short', timeZone: 'UTC' }).format(dt))
    }
  }
  return labels
}
