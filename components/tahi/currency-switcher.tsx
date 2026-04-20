/**
 * <CurrencySwitcher> — nav-bar dropdown for the global display currency.
 *
 * Lightweight, compact, keyboard-friendly. Sits next to the notification
 * bell on admin pages. Reads + writes through the DisplayCurrencyContext.
 */

'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { useDisplayCurrency } from '@/lib/display-currency-context'
import type { CurrencyCode } from '@/lib/currency'

export function CurrencySwitcher() {
  const { displayCurrency, setDisplayCurrency, options } = useDisplayCurrency()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const activeOption = options.find(o => o.code === displayCurrency) ?? options[0]

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Display currency: ${activeOption.code}. Change currency.`}
        className="inline-flex items-center"
        style={{
          gap: 'var(--space-1)',
          padding: 'var(--space-1) var(--space-2)',
          fontSize: 'var(--text-xs)',
          fontWeight: 500,
          color: 'var(--color-text-muted)',
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 'var(--radius-sm)',
          cursor: 'pointer',
          lineHeight: 1,
          height: '1.75rem',
          transition: 'background-color 150ms ease, color 150ms ease, border-color 150ms ease',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = 'var(--color-bg-tertiary)'
          e.currentTarget.style.color = 'var(--color-text)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = 'var(--color-bg-secondary)'
          e.currentTarget.style.color = 'var(--color-text-muted)'
        }}
      >
        <span className="tabular-nums">{activeOption.code}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label="Display currency options"
          style={{
            position: 'absolute',
            top: 'calc(100% + 0.25rem)',
            right: 0,
            minWidth: '11rem',
            maxHeight: '18rem',
            overflowY: 'auto',
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-md)',
            padding: 'var(--space-1)',
            margin: 0,
            listStyle: 'none',
            zIndex: 50,
          }}
        >
          {options.map(opt => {
            const selected = opt.code === displayCurrency
            return (
              <li key={opt.code}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    setDisplayCurrency(opt.code as CurrencyCode)
                    setOpen(false)
                  }}
                  className="w-full inline-flex items-center"
                  style={{
                    gap: 'var(--space-2)',
                    padding: 'var(--space-1-5) var(--space-2)',
                    fontSize: 'var(--text-sm)',
                    color: selected ? 'var(--color-text)' : 'var(--color-text-muted)',
                    background: selected ? 'var(--color-bg-secondary)' : 'transparent',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background-color 150ms ease',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'var(--color-bg-tertiary)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = selected ? 'var(--color-bg-secondary)' : 'transparent'
                  }}
                >
                  <span className="tabular-nums" style={{ fontWeight: 600, minWidth: '2.25rem' }}>
                    {opt.code}
                  </span>
                  <span style={{ flex: 1, fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}>
                    {opt.name}
                  </span>
                  {selected && <Check size={12} aria-hidden="true" style={{ color: 'var(--color-brand)' }} />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
