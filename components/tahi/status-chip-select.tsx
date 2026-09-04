'use client'

/**
 * <StatusChipSelect>. Editable status control rendered as a Badge chip.
 * Lifted from the request-detail inline chip so requests, tasks, and any
 * other status-bearing surface share one accessible picker.
 *
 *   <StatusChipSelect
 *     value={request.status}
 *     options={REQUEST_STATUSES}
 *     onChange={(next) => patchStatus(next)}   // may return a Promise
 *   />
 *
 * Clicking the chip opens a Popover listbox of the supplied options.
 * Picking one fires onChange. When onChange returns a Promise the chip
 * shows a spinner and locks until it settles (the caller still owns the
 * optimistic update / PATCH). Pass `busy` to drive that lock externally
 * instead.
 *
 * Accessibility: the trigger is aria-haspopup="listbox" + aria-expanded;
 * the panel is role="listbox"; each choice is role="option" with
 * aria-selected. Trigger and options carry the tahi-focus-ring class.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, Loader2 } from 'lucide-react'
import { Badge, type BadgeTone, type BadgeSize } from '@/components/tahi/badge'
import { Popover } from '@/components/tahi/popover'

export interface StatusChipOption {
  value: string
  label: string
  tone: BadgeTone
}

interface StatusChipSelectProps {
  /** Current status slug. */
  value: string
  /** Ordered choices. Drive this off REQUEST_STATUSES / TASK_STATUSES. */
  options: readonly StatusChipOption[]
  /** Fires with the picked slug. May return a Promise to lock the chip
   *  (spinner) until it resolves. */
  onChange: (next: string) => void | Promise<void>
  /** Hard-disable the control (no open, no change). */
  disabled?: boolean
  /** External busy lock, e.g. when the parent owns the in-flight state.
   *  ORed with the internal async lock. */
  busy?: boolean
  /** Chip size. Defaults to 'sm' to sit inline in dense rows. */
  size?: BadgeSize
  /**
   * Trigger height. `default` is the 2.75rem touch target the requests-list
   * status column wears at every width. `compact` keeps that target below md
   * and drops to 2.25rem from md up, so the chip lines up with the other
   * commands in the request detail's Actions card, which all sit at
   * `min-h-11 md:min-h-9`.
   */
  density?: 'default' | 'compact'
  /** Popover alignment against the trigger. */
  align?: 'start' | 'end'
  /** Popover width. Defaults to 11rem. */
  width?: string | number
  /** Accessible name for the trigger. Defaults to 'Change status'. */
  'aria-label'?: string
}

const TRIGGER_MIN_HEIGHT = '2.75rem'

// Both spellings written out in full: a Tailwind class must never be
// assembled from parts at runtime, or the compiler cannot see it.
const TRIGGER_CLASS = 'tahi-focus-ring inline-flex items-center'
const TRIGGER_CLASS_COMPACT = 'tahi-focus-ring inline-flex items-center min-h-11 md:min-h-9'

export function StatusChipSelect({
  value,
  options,
  onChange,
  disabled = false,
  busy = false,
  size = 'sm',
  density = 'default',
  align = 'start',
  width = '11rem',
  'aria-label': ariaLabel = 'Change status',
}: StatusChipSelectProps) {
  const ref = useRef<HTMLButtonElement | null>(null)
  const mountedRef = useRef(true)
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const locked = disabled || busy || pending

  // Always render the current value even if it is not one of the supplied
  // options, so a legacy / non-standard status still shows a chip.
  const current = options.find((o) => o.value === value)
  const choices: StatusChipOption[] = current
    ? [...options]
    : [{ value, label: value, tone: 'neutral' }, ...options]
  const currentTone: BadgeTone = current?.tone ?? 'neutral'
  const currentLabel = current?.label ?? value

  const handlePick = useCallback(
    async (next: string) => {
      setOpen(false)
      if (next === value) return
      try {
        const result = onChange(next)
        if (result instanceof Promise) {
          setPending(true)
          await result
        }
      } finally {
        if (mountedRef.current) setPending(false)
      }
    },
    [onChange, value],
  )

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => {
          if (!locked) setOpen((o) => !o)
        }}
        disabled={locked}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={density === 'compact' ? TRIGGER_CLASS_COMPACT : TRIGGER_CLASS}
        style={{
          gap: '0.375rem',
          padding: '0.25rem 0.4375rem',
          background: 'transparent',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          cursor: locked ? 'not-allowed' : 'pointer',
          opacity: locked && !pending ? 0.6 : 1,
          // The compact trigger carries its height in classes so it can drop
          // at md; an inline minHeight would win over both.
          minHeight: density === 'compact' ? undefined : TRIGGER_MIN_HEIGHT,
          transition: 'border-color 150ms ease, background-color 150ms ease',
        }}
        onMouseEnter={(e) => {
          if (!locked) e.currentTarget.style.borderColor = 'var(--color-brand)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'var(--color-border)'
        }}
      >
        <Badge tone={currentTone} variant="soft" size={size} leader="dot">
          {currentLabel}
        </Badge>
        {pending || busy ? (
          <Loader2
            size={12}
            className="animate-spin"
            aria-hidden="true"
            style={{ color: 'var(--color-text-subtle)' }}
          />
        ) : (
          <ChevronDown size={12} aria-hidden="true" style={{ color: 'var(--color-text-subtle)' }} />
        )}
      </button>
      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} align={align} width={width}>
        <div role="listbox" aria-label={ariaLabel} style={{ padding: '0.25rem' }}>
          {choices.map((o) => {
            const isActive = o.value === value
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => void handlePick(o.value)}
                className="tahi-focus-ring w-full inline-flex items-center"
                style={{
                  gap: '0.5rem',
                  padding: '0.4375rem 0.625rem',
                  minHeight: TRIGGER_MIN_HEIGHT,
                  background: isActive ? 'var(--color-bg-secondary)' : 'transparent',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 'var(--text-sm)',
                  color: 'var(--color-text)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background-color 120ms ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--color-bg-secondary)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = isActive
                    ? 'var(--color-bg-secondary)'
                    : 'transparent'
                }}
              >
                <Badge tone={o.tone} variant="soft" size={size} leader="dot">
                  {o.label}
                </Badge>
              </button>
            )
          })}
        </div>
      </Popover>
    </>
  )
}
