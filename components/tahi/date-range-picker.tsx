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
    <div>
      {/* Month/Year header */}
      <div className="text-center text-sm font-semibold text-[var(--color-text)] mb-2">
        {MONTH_NAMES[month]} {year}
      </div>

      {/* Day labels */}
      <div className="grid grid-cols-7 gap-0 mb-1">
        {DAY_LABELS.map((d, i) => (
          <div key={i} className="text-center text-xs font-medium text-[var(--color-text-subtle)] py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-0">
        {cells.map((date, i) => {
          if (!date) {
            return <div key={`empty-${i}`} className="h-8" />
          }

          const isToday = isSameDay(date, today)
          const isStart = selected.from && isSameDay(date, selected.from)
          const isEnd = effectiveTo && isSameDay(date, effectiveTo)
          const inRange = isInRange(date, selected.from, effectiveTo)
          const isSelected = isStart || isEnd

          let bg = 'transparent'
          let textColor = 'var(--color-text)'
          let fontWeight = '400'
          let borderRadius = '9999px'

          if (isSelected) {
            bg = 'var(--color-brand)'
            textColor = '#ffffff'
            fontWeight = '600'
          } else if (inRange) {
            bg = 'var(--color-brand-50, #f0f7ee)'
            textColor = 'var(--color-brand-dark)'
            borderRadius = '0'
          }

          if (isToday && !isSelected) {
            fontWeight = '700'
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
              className="h-8 flex items-center justify-center text-sm transition-colors hover:opacity-80"
              style={{
                background: bg,
                color: textColor,
                fontWeight,
                borderRadius,
              }}
            >
              {date.getDate()}
              {isToday && !isSelected && (
                <span
                  className="absolute mt-5 w-1 h-1 rounded-full"
                  style={{ background: 'var(--color-brand)' }}
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

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
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
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm transition-colors hover:border-[var(--color-brand)]"
        style={{
          borderColor: hasValue ? 'var(--color-brand)' : 'var(--color-border)',
          background: hasValue ? 'var(--color-brand-50, #f0f7ee)' : 'var(--color-bg)',
          color: hasValue ? 'var(--color-brand-dark)' : 'var(--color-text-muted)',
        }}
      >
        <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="truncate max-w-[12.5rem]">{triggerLabel}</span>
        {hasValue && (
          <button
            type="button"
            onClick={handleClear}
            className="ml-0.5 p-0.5 rounded hover:bg-[var(--color-brand-100)] transition-colors"
            aria-label="Clear date filter"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute top-full mt-1 z-[60] bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl shadow-xl flex"
          style={{
            [align === 'right' ? 'right' : 'left']: 0,
          }}
        >
          {/* Presets sidebar */}
          <div className="border-r border-[var(--color-border-subtle)] py-2 w-[10rem] flex-shrink-0">
            {presets.map(preset => (
              <button
                key={preset.key}
                type="button"
                onClick={() => handlePreset(preset)}
                className="w-full text-left px-4 py-1.5 text-sm transition-colors flex items-center justify-between"
                style={{
                  background: activePreset === preset.key ? 'var(--color-brand-50, #f0f7ee)' : 'transparent',
                  color: activePreset === preset.key ? 'var(--color-brand-dark)' : 'var(--color-text-muted)',
                  fontWeight: activePreset === preset.key ? '500' : '400',
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
          <div className="p-4 flex gap-6">
            {/* Navigation */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <button
                  type="button"
                  onClick={prevMonth}
                  className="p-1 rounded-lg hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] transition-colors"
                  aria-label="Previous month"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm font-semibold text-[var(--color-text)]">
                  {MONTH_NAMES[month1.month]} - {MONTH_NAMES[month2.month]} {month2.year}
                </span>
                <button
                  type="button"
                  onClick={nextMonth}
                  className="p-1 rounded-lg hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] transition-colors"
                  aria-label="Next month"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <div className="flex gap-6">
                <MonthGrid
                  year={month1.year}
                  month={month1.month}
                  selected={selecting}
                  hovered={hovered}
                  onDayClick={handleDayClick}
                  onDayHover={setHovered}
                />
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
    <div className="flex flex-wrap items-center gap-2">
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
          className="text-sm px-3 py-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] appearance-none pr-7"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%235a6657' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 0.5rem center',
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
