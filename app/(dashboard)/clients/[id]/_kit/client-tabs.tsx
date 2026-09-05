'use client'

/**
 * <ClientTabs>. One frame, nine doors.
 *
 * A scrolling strip with a pill that slides to the open tab, a count on the
 * tabs that carry one, and a danger-toned count when that number is something
 * going wrong (an overdue invoice, a request past its due date).
 *
 * Not <SegmentedControl>: that primitive takes plain string labels and sizes
 * itself to fit, which is right for two or three options and wrong for nine
 * with badges. This keeps the same pill motion and the same roving keyboard
 * model, and adds the horizontal scroll that nine tabs need at 375px, where
 * the strip keeps the active tab in view on every change.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { ClientTabId } from './types'

export interface ClientTabDef {
  id: ClientTabId
  label: string
  icon: LucideIcon
  count?: number
  /** Renders the count in the danger tone: this number is a problem. */
  warn?: boolean
}

export function ClientTabs({
  tabs,
  value,
  onChange,
}: {
  tabs: ClientTabDef[]
  value: ClientTabId
  onChange: (next: ClientTabId) => void
}) {
  const stripRef = useRef<HTMLDivElement>(null)
  const fromKeyboard = useRef(false)
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null)

  const measure = useCallback(() => {
    const strip = stripRef.current
    if (!strip) return
    const active = strip.querySelector<HTMLButtonElement>('[data-tab-active="true"]')
    if (active) setPill({ left: active.offsetLeft, width: active.offsetWidth })
  }, [])

  useLayoutEffect(() => { measure() }, [measure, value, tabs.length])

  useEffect(() => {
    const onResize = () => measure()
    window.addEventListener('resize', onResize)
    // Fonts land after first paint and move every offset; re-measure once.
    const t = window.setTimeout(measure, 150)
    return () => {
      window.removeEventListener('resize', onResize)
      window.clearTimeout(t)
    }
  }, [measure])

  // Keep the open tab on screen, and take focus with it. At 375px nine tabs are
  // three screens wide, so switching by keyboard or by a deep link has to bring
  // its tab into view. Focus moves in the same pass: under a roving tabindex
  // the old button drops to -1, so leaving focus behind means the ring sits on
  // a tab that is no longer selected and Enter re-selects the stale one.
  // Selection is only chased by focus when the keyboard drove it, so a click
  // does not yank focus and a first render does not steal it from the page.
  useEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    const active = strip.querySelector<HTMLButtonElement>('[data-tab-active="true"]')
    if (!active) return
    const left = active.offsetLeft - 12
    const right = active.offsetLeft + active.offsetWidth + 12
    if (left < strip.scrollLeft) strip.scrollTo({ left, behavior: 'smooth' })
    else if (right > strip.scrollLeft + strip.clientWidth) {
      strip.scrollTo({ left: right - strip.clientWidth, behavior: 'smooth' })
    }
    if (fromKeyboard.current) {
      fromKeyboard.current = false
      active.focus()
    }
  }, [value])

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const i = tabs.findIndex(t => t.id === value)
    if (i < 0) return
    let next = i
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = tabs.length - 1
    else return
    e.preventDefault()
    if (tabs[next].id === value) return
    fromKeyboard.current = true
    onChange(tabs[next].id)
  }

  return (
    <div
      ref={stripRef}
      role="tablist"
      aria-label="Client sections"
      onKeyDown={onKeyDown}
      className="h-scroll scrollbar-hide"
      style={{
        position: 'relative',
        display: 'flex',
        gap: '0.1875rem',
        padding: '0.1875rem',
        borderRadius: 'var(--radius-card)',
        border: '1px solid var(--color-border-subtle)',
        background: 'var(--color-bg-secondary)',
      }}
    >
      {pill && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: '0.1875rem',
            bottom: '0.1875rem',
            left: 0,
            zIndex: 0,
            width: pill.width,
            transform: `translateX(${pill.left}px)`,
            borderRadius: 'var(--radius-button)',
            background: 'var(--color-bg)',
            boxShadow: 'var(--shadow-sm)',
            transition: 'transform var(--motion-slow) var(--ease-out), width var(--motion-slow) var(--ease-out)',
            pointerEvents: 'none',
          }}
        />
      )}
      {tabs.map(tab => {
        const Icon = tab.icon
        const on = tab.id === value
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`client-tab-${tab.id}`}
            aria-selected={on}
            // Only the open tab has a panel in the document, so only it can
            // point at one. An aria-controls at an id that is not rendered
            // resolves to nothing for a screen reader.
            aria-controls={on ? `client-panel-${tab.id}` : undefined}
            tabIndex={on ? 0 : -1}
            data-tab-active={on ? 'true' : 'false'}
            onClick={() => onChange(tab.id)}
            className="tahi-focus-ring"
            style={{
              position: 'relative',
              zIndex: 1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4375rem',
              minHeight: '2.75rem',
              padding: '0 0.75rem',
              border: 'none',
              borderRadius: 'var(--radius-button)',
              background: 'none',
              color: on ? 'var(--color-text)' : 'var(--color-text-muted)',
              fontSize: '0.8125rem',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              flexShrink: 0,
              cursor: 'pointer',
              transition: 'color var(--motion-base) var(--ease-out)',
            }}
            onMouseEnter={e => { if (!on) e.currentTarget.style.color = 'var(--color-text)' }}
            onMouseLeave={e => { if (!on) e.currentTarget.style.color = 'var(--color-text-muted)' }}
          >
            <Icon
              className="w-3.5 h-3.5"
              aria-hidden="true"
              style={{ color: on ? 'var(--color-brand)' : 'var(--color-text-subtle)' }}
            />
            {tab.label}
            {tab.count != null && tab.count > 0 && (
              <span
                className="tabular-nums inline-flex items-center justify-center"
                style={{
                  minWidth: '1.125rem',
                  height: '1.125rem',
                  padding: '0 0.3125rem',
                  borderRadius: '9999px',
                  border: `1px solid ${tab.warn ? 'var(--badge-danger-border)' : 'var(--color-border-subtle)'}`,
                  background: tab.warn ? 'var(--badge-danger-bg)' : 'var(--color-bg)',
                  color: tab.warn ? 'var(--badge-danger-text)' : 'var(--color-text-muted)',
                  fontSize: '0.6875rem',
                  fontWeight: 700,
                }}
              >
                {tab.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
