/**
 * <CurrencySwitcher> — nav-bar dropdown for the global display currency.
 *
 * Lightweight, compact, keyboard-friendly. Sits next to the notification
 * bell on admin pages. Reads + writes through the DisplayCurrencyContext.
 *
 * Visual skin: app-shell forest design. Classes .tb-cur, .cur-chev,
 * .cur-row, .cr-code, .cr-name, .cr-check are defined in app-shell.css.
 * Dropdown is rendered through <Popover> (portal, auto-flip, outside-click
 * and Escape handled internally).
 */

'use client'

import { useRef, useState } from 'react'
import { useDisplayCurrency } from '@/lib/display-currency-context'
import { ShellIcon } from '@/components/tahi/shell-icons'
import type { CurrencyCode } from '@/lib/currency'
import { Popover } from '@/components/tahi/popover'

export function CurrencySwitcher() {
  const { displayCurrency, setDisplayCurrency, options } = useDisplayCurrency()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const activeOption = options.find(o => o.code === displayCurrency) ?? options[0]

  function pick(code: CurrencyCode) {
    setDisplayCurrency(code)
    setOpen(false)
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="tb-cur"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Display currency: ${activeOption.code}. Change currency.`}
      >
        {activeOption.code}
        <span className="cur-chev"><ShellIcon n="chevron" s={13} /></span>
      </button>

      <Popover
        anchorRef={triggerRef}
        open={open}
        onClose={() => setOpen(false)}
        width="236px"
        align="end"
      >
        <div
          style={{
            padding: '8px 11px 6px',
            fontWeight: 700,
            fontSize: '11px',
            letterSpacing: '.05em',
            textTransform: 'uppercase',
            color: 'var(--color-text-subtle)',
          }}
        >
          Display currency
        </div>
        {options.map(opt => (
          <button
            key={opt.code}
            type="button"
            role="option"
            aria-selected={opt.code === displayCurrency}
            className={'cur-row' + (opt.code === displayCurrency ? ' on' : '')}
            onClick={() => pick(opt.code)}
          >
            <span className="cr-code">{opt.symbol}</span>
            <span className="cr-name">{opt.name}</span>
            {opt.code === displayCurrency && (
              <span className="cr-check"><ShellIcon n="check" s={16} /></span>
            )}
          </button>
        ))}
      </Popover>
    </>
  )
}
