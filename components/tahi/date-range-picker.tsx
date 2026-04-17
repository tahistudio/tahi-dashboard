'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react'

// -- Types --

export interface DateRange {
  from: Date | null
  to: Date | null
}

export interface DateRangePickerProps {
  value: DateRange
  onChange: (range: DateRange) => void
  /** Label shown on the trigger button */
  label?: string
  /** Alignment of the dropdown */
  align?: 'left' | 'right'
}

// -- Helpers --

function startOfDay(d: Date): Date {
  const r = new Date(d)
  r.setHours(0, 0, 0, 0)
  return r
}

function endOfDay(d: Date): Date {
  const r = new Date(d)
  r.setHours(23, 59, 59, 999)
  return r
}

function addMonths(d: Date, n: number): Date {
  const r = new Date(d)
  r.setMonth(r.getMonth() + n)
  return r
}

function subDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() - n)
  return r
}

function startOfWeek(d: Date): Date {
  const r = new Date(d)
  const day = r.getDay()
  r.setDate(r.getDate() - day)
  r.setHours(0, 0, 0, 0)
  return r
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999)
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function isInRange(d: Date, from: Date | null, to: Date | null): boolean {
  if (!from || !to) return false
  const t = d.getTime()
  return t >= startOfDay(from).getTime() && t <= endOfDay(to).getTime()
}

function formatShort(d: Date): string {
  return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

// -- Presets --

type PresetKey = 'today' | 'yesterday' | 'this_week' | 'last_week' | 'past_two_weeks' | 'this_month' | 'last_month' | 'this_year' | 'last_year'

interface Preset {
  key: PresetKey
  label: string
  range: () => DateRange
}

function getPresets(): Preset[] {
  const now = new Date()
  const today = startOfDay(now)

  return [
    {
      key: 'today',
      label: 'Today',
      range: () => ({ from: today, to: endOfDay(now) }),
    },
    {
      key: 'yesterday',
      label: 'Yesterday',
      range: () => {
        const y = subDays(today, 1)
        return { from: y, to: endOfDay(y) }
      },
    },
    {
      key: 'this_week',
      label: 'This week',
      range: () => ({ from: startOfWeek(today), to: endOfDay(now) }),
    },
    {
      key: 'last_week',
      label: 'Last week',
      range: () => {
        const start = subDays(startOfWeek(today), 7)
        const end = subDays(startOfWeek(today), 1)
        return { from: start, to: endOfDay(end) }
      },
    },
    {
      key: 'past_two_weeks',
      label: 'Past two weeks',
      range: () => ({ from: subDays(today, 13), to: endOfDay(now) }),
    },
    {
      key: 'this_month',
      label: 'This month',
      range: () => ({ from: startOfMonth(today), to: endOfDay(now) }),
    },
    {
      key: 'last_month',
      label: 'Last month',
      range: () => {
        const lastM = addMonths(today, -1)
        return { from: startOfMonth(lastM), to: endOfMonth(lastM) }
      },
    },
    {
      key: 'this_year',
      label: 'This year',
      range: () => ({ from: new Date(now.getFullYear(), 0, 1), to: endOfDay(now) }),
    },
    {
      key: 'last_year',
      label: 'Last year',
      range: () => ({
        from: new Date(now.getFullYear() - 1, 0, 1),
        to: new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999),
      }),
    },
  ]
}

// -- Calendar Month Grid --
// Fixed size so the column layout can't collapse.
// Each cell is 2rem x 2rem : total grid is 7 * 2rem = 14rem wide.

function MonthGrid({
  year,
  month,
  selected,
  hovered,
  onDayClick,
  onDayHover,
}: {
  year: number
  month: number
  selected: DateRange
  hovered: Date | null
  onDayClick: (d: Date) => void
  onDayHover: (d: Date | null) => void
}) {
  const firstDay = new Date(year, month, 1)
  const startDayOfWeek = firstDay.getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const today = startOfDay(new Date())

  // Build the 6-row grid (max needed)
  const cells: (Date | null)[] = []
  for (let i = 0; i < startDayOfWeek; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d))
  while (cells.length % 7 !== 0) cells.push(null)

  // Determine the effective "to" for hover preview
  const effectiveTo = selected.from && !selected.to && hovered ? hovered : selected.to

  return (
    <div style={{ width: '14rem', flexShrink: 0 }}>
      {/* Month/Year header */}
      <div
        className="text-center"
        style={{
          fontSize: 'var(--text-sm)',
          fontWeight: 600,
          color: 'var(--color-text)',
          marginBottom: 'var(--space-2)',
        }}
      >
        {MONTH_NAMES[month]} {year}
      </div>

      {/* Day labels */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 2rem)',
          marginBottom: 'var(--space-1)',
        }}
      >
        {DAY_LABELS.map((d, i) => (
          <div
            key={i}
            className="text-center"
            style={{
              fontSize: 'var(--text-xs)',
              fontWeight: 500,
              color: 'var(--color-text-subtle)',
              padding: '0.25rem 0',
            }}
          >
            {d}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 2rem)' }}>
        {cells.map((date, i) => {
          if (!date) {
            return <div key={`empty-${i}`} style={{ height: '2rem', width: '2rem' }} />
          }

          const isToday = isSameDay(date, today)
          const isStart = selected.from && isSameDay(date, selected.from)
          const isEnd = effectiveTo && isSameDay(date, effectiveTo)
          const inRange = isInRange(date, selected.from, effectiveTo)
          const isSelected = isStart || isEnd

          let bg = 'transparent'
          let textColor = 'var(--color-text)'
          let fontWeight = 400
          let borderRadius = '9999px'

          if (isSelected) {
            bg = 'var(--color-brand)'
            textColor = '#ffffff'
            fontWeight = 600
          } else if (inRange) {
            bg = 'var(--color-brand-50)'
            textColor = 'var(--color-brand-dark)'
            borderRadius = '0'
          }

          if (isToday && !isSelected) {
            fontWeight = 700
          }

          // Soften range edges
          if (isStart && effectiveTo && !isSameDay(selected.from!, effectiveTo)) {
            borderRadius = '9999px 0 0 9999px'
          } else if (isEnd && selected.from && !isSameDay(selected.from, effectiveTo!)) {
            borderRadius = '0 9999px 9999px 0'
          }

          return (
            <button
              key={date.toISOString()}
              type="button"
              onClick={() => onDayClick(date)}
              onMouseEnter={() => onDayHover(date)}
              onMouseLeave={() => onDayHover(null)}
              className="relative flex items-center justify-center"
              style={{
                height: '2rem',
                width: '2rem',
                fontSize: 'var(--text-sm)',
                background: bg,
                color: textColor,
                fontWeight,
                borderRadius,
                border: 'none',
                transition: 'background 150ms ease, color 150ms ease',
              }}
              onMouseOver={e => {
                if (!isSelected && !inRange) {
                  e.currentTarget.style.background = 'var(--color-bg-secondary)'
                }
              }}
              onMouseOut={e => {
                if (!isSelected && !inRange) {
                  e.currentTarget.style.background = 'transparent'
                }
              }}
            >
              {date.getDate()}
              {isToday && !isSelected && (
                <span
                  style={{
                    position: 'absolute',
                    bottom: '0.1875rem',
                    width: '0.25rem',
                    height: '0.25rem',
                    borderRadius: '9999px',
                    background: 'var(--color-brand)',
                  }}
                />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// -- Main Component --

export function DateRangePicker({ value, onChange, label = 'Date range', align = 'left' }: DateRangePickerProps) {
  const [open, setOpen] = useState(false)
  const [viewDate, setViewDate] = useState(() => value.from ?? new Date())
  const [selecting, setSelecting] = useState<DateRange>({ from: null, to: null })
  const [hovered, setHovered] = useState<Date | null>(null)
  const [activePreset, setActivePreset] = useState<PresetKey | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const presets = useMemo(() => getPresets(), [])

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  // Sync selecting state when opening
  useEffect(() => {
    if (open) {
      setSelecting({ from: value.from, to: value.to })
      if (value.from) setViewDate(value.from)
    }
  }, [open, value.from, value.to])

  const handleDayClick = useCallback((d: Date) => {
    setActivePreset(null)
    if (!selecting.from || selecting.to) {
      // Start new selection
      setSelecting({ from: startOfDay(d), to: null })
    } else {
      // Complete selection
      const from = selecting.from
      let newFrom: Date, newTo: Date
      if (d < from) {
        newFrom = startOfDay(d)
        newTo = endOfDay(from)
      } else {
        newFrom = from
        newTo = endOfDay(d)
      }
      setSelecting({ from: newFrom, to: newTo })
      onChange({ from: newFrom, to: newTo })
      setOpen(false)
    }
  }, [selecting, onChange])

  const handlePreset = useCallback((preset: Preset) => {
    const range = preset.range()
    setSelecting(range)
    setActivePreset(preset.key)
    onChange(range)
    if (range.from) setViewDate(range.from)
    setOpen(false)
  }, [onChange])

  const handleClear = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onChange({ from: null, to: null })
    setSelecting({ from: null, to: null })
    setActivePreset(null)
  }, [onChange])

  const prevMonth = useCallback(() => setViewDate(v => addMonths(v, -1)), [])
  const nextMonth = useCallback(() => setViewDate(v => addMonths(v, 1)), [])

  const month1 = { year: viewDate.getFullYear(), month: viewDate.getMonth() }
  const m2 = addMonths(viewDate, 1)
  const month2 = { year: m2.getFullYear(), month: m2.getMonth() }

  const hasValue = value.from && value.to
  const triggerLabel = hasValue
    ? `${formatShort(value.from!)} - ${formatShort(value.to!)}`
    : label

  return (
    <div ref={ref} className="relative inline-block">
      {/* Trigger button : matches the native <select> filter chip style */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center"
        style={{
          gap: 'var(--space-2)',
          padding: 'var(--space-1-5) var(--space-3)',
          height: '2.25rem',
          borderRadius: 'var(--radius-md)',
          border: `1px solid ${hasValue ? 'var(--color-brand)' : 'var(--color-border)'}`,
          background: hasValue ? 'var(--color-brand-50)' : 'var(--color-bg)',
          color: hasValue ? 'var(--color-brand-dark)' : 'var(--color-text-muted)',
          fontSize: 'var(--text-sm)',
          fontWeight: 500,
          transition: 'border-color 150ms ease, background 150ms ease, color 150ms ease',
          cursor: 'pointer',
        }}
        onMouseEnter={e => {
          if (!hasValue) e.currentTarget.style.borderColor = 'var(--color-brand)'
        }}
        onMouseLeave={e => {
          if (!hasValue) e.currentTarget.style.borderColor = 'var(--color-border)'
        }}
      >
        <Calendar size={14} className="flex-shrink-0" aria-hidden="true" />
        <span className="truncate" style={{ maxWidth: '12.5rem' }}>{triggerLabel}</span>
        {hasValue && (
          <span
            role="button"
            tabIndex={0}
            onClick={handleClear}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                handleClear(e as unknown as React.MouseEvent)
              }
            }}
            aria-label="Clear date filter"
            className="flex items-center justify-center"
            style={{
              width: '1rem',
              height: '1rem',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
            }}
          >
            <X size={12} />
          </span>
        )}
      </button>

      {/* Dropdown : mobile = stacked column with single month, desktop = presets + two months */}
      {open && (
        <div
          className="absolute top-full z-[60] flex flex-col sm:flex-row"
          style={{
            marginTop: 'var(--space-1)',
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-lg)',
            [align === 'right' ? 'right' : 'left']: 0,
            maxWidth: '95vw',
            overflow: 'hidden',
          }}
        >
          {/* Presets sidebar : horizontal scroller on mobile, vertical sidebar on desktop */}
          <div
            className="flex sm:flex-col flex-shrink-0 h-scroll sm:h-auto"
            style={{
              borderRight: '1px solid var(--color-border-subtle)',
              padding: 'var(--space-2) 0',
              minWidth: '10rem',
              maxWidth: '100%',
            }}
          >
            {presets.map(preset => (
              <button
                key={preset.key}
                type="button"
                onClick={() => handlePreset(preset)}
                className="text-left flex items-center justify-between whitespace-nowrap"
                style={{
                  padding: 'var(--space-1-5) var(--space-4)',
                  fontSize: 'var(--text-sm)',
                  background: activePreset === preset.key ? 'var(--color-brand-50)' : 'transparent',
                  color: activePreset === preset.key ? 'var(--color-brand-dark)' : 'var(--color-text-muted)',
                  fontWeight: activePreset === preset.key ? 500 : 400,
                  border: 'none',
                  transition: 'background 150ms ease, color 150ms ease',
                  cursor: 'pointer',
                  width: '100%',
                }}
                onMouseEnter={e => {
                  if (activePreset !== preset.key) {
                    e.currentTarget.style.background = 'var(--color-bg-secondary)'
                    e.currentTarget.style.color = 'var(--color-text)'
                  }
                }}
                onMouseLeave={e => {
                  if (activePreset !== preset.key) {
                    e.currentTarget.style.background = 'transparent'
                    e.currentTarget.style.color = 'var(--color-text-muted)'
                  }
                }}
              >
                {preset.label}
                {activePreset === preset.key && (
                  <span style={{ color: 'var(--color-brand)' }}>&#10003;</span>
                )}
              </button>
            ))}
          </div>

          {/* Calendar grids */}
          <div style={{ padding: 'var(--space-4)' }}>
            {/* Navigation header */}
            <div
              className="flex items-center justify-between"
              style={{ marginBottom: 'var(--space-3)', gap: 'var(--space-3)' }}
            >
              <button
                type="button"
                onClick={prevMonth}
                aria-label="Previous month"
                className="flex items-center justify-center"
                style={{
                  width: '2rem',
                  height: '2rem',
                  borderRadius: 'var(--radius-md)',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--color-text-muted)',
                  cursor: 'pointer',
                  transition: 'background 150ms ease',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                <ChevronLeft size={16} />
              </button>
              <span
                style={{
                  fontSize: 'var(--text-sm)',
                  fontWeight: 600,
                  color: 'var(--color-text)',
                  whiteSpace: 'nowrap',
                }}
              >
                <span className="hidden md:inline">
                  {MONTH_NAMES[month1.month]} {month1.year} – {MONTH_NAMES[month2.month]} {month2.year}
                </span>
                <span className="md:hidden">
                  {MONTH_NAMES[month1.month]} {month1.year}
                </span>
              </span>
              <button
                type="button"
                onClick={nextMonth}
                aria-label="Next month"
                className="flex items-center justify-center"
                style={{
                  width: '2rem',
                  height: '2rem',
                  borderRadius: 'var(--radius-md)',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--color-text-muted)',
                  cursor: 'pointer',
                  transition: 'background 150ms ease',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                <ChevronRight size={16} />
              </button>
            </div>

            {/* Months : 1 on mobile (md-), 2 on desktop (md+) */}
            <div className="flex" style={{ gap: 'var(--space-5)' }}>
              <MonthGrid
                year={month1.year}
                month={month1.month}
                selected={selecting}
                hovered={hovered}
                onDayClick={handleDayClick}
                onDayHover={setHovered}
              />
              <div className="hidden md:block">
                <MonthGrid
                  year={month2.year}
                  month={month2.month}
                  selected={selecting}
                  hovered={hovered}
                  onDayClick={handleDayClick}
                  onDayHover={setHovered}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// -- Convenience: Filter Chip Bar --

export interface FilterChip {
  key: string
  label: string
  options: { value: string; label: string }[]
  value: string
  onChange: (value: string) => void
}

export function FilterBar({
  chips,
  dateRange,
  onDateRangeChange,
  dateLabel,
}: {
  chips?: FilterChip[]
  dateRange?: DateRange
  onDateRangeChange?: (range: DateRange) => void
  dateLabel?: string
}) {
  return (
    <div className="flex flex-wrap items-center" style={{ gap: 'var(--space-2)' }}>
      {onDateRangeChange && dateRange && (
        <DateRangePicker
          value={dateRange}
          onChange={onDateRangeChange}
          label={dateLabel ?? 'Date range'}
        />
      )}
      {chips?.map(chip => (
        <select
          key={chip.key}
          value={chip.value}
          onChange={e => chip.onChange(e.target.value)}
          aria-label={chip.label}
          className="appearance-none"
          style={{
            fontSize: 'var(--text-sm)',
            fontWeight: 500,
            padding: 'var(--space-1-5) var(--space-8) var(--space-1-5) var(--space-3)',
            height: '2.25rem',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg)',
            color: 'var(--color-text)',
            cursor: 'pointer',
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%235a6657' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 0.625rem center',
          }}
        >
          {chip.options.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      ))}
    </div>
  )
}
