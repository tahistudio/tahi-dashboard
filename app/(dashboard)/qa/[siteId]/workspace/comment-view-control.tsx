'use client'

import { useRef, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Popover } from '@/components/tahi/popover'
import { TahiButton } from '@/components/tahi/tahi-button'
import { QA_VIEWPORTS, browserLabel, type QaBrowserKey, type QaViewportKey } from '@/lib/qa/types'
import {
  DEFAULT_COMMENT_VIEW,
  isDefaultCommentView,
  toggleViewBrowser,
  toggleViewViewport,
  viewBrowsers,
  type CommentFilter,
  type CommentView,
} from './comments-helpers'

const STATUS_OPTIONS: { value: CommentFilter; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' },
]

const CHIP_BASE =
  'tahi-focus-ring min-h-[2.75rem] rounded-[var(--radius-leaf-sm)] border px-3 py-1.5 text-[0.8125rem] font-semibold transition-colors disabled:opacity-50'
const CHIP_ON =
  'border-[var(--color-brand)] bg-[var(--color-brand-50)] text-[var(--color-brand-on-tint)] hover:bg-[var(--color-brand-100)]'
const CHIP_OFF =
  'border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-tertiary)]'

function chipClass(on: boolean, extra = ''): string {
  return `${CHIP_BASE} ${on ? CHIP_ON : CHIP_OFF}${extra ? ` ${extra}` : ''}`
}

export interface CommentViewControlProps {
  view: CommentView
  onChange: (next: CommentView) => void
  /** Browsers the round covers; the browser group shows when there is more than one. */
  roundBrowsers: QaBrowserKey[]
  activeBrowser: QaBrowserKey
  /** Viewports that have a frame on screen. */
  viewports: QaViewportKey[]
  shown: number
  total: number
}

/**
 * Compact control for which comment pins the frames draw: a master Show/Hide switch plus status,
 * browser and viewport filters, with a "Showing X of Y" count. View state only; comments are not changed.
 */
export function CommentViewControl({ view, onChange, roundBrowsers, activeBrowser, viewports, shown, total }: CommentViewControlProps) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const effectiveBrowsers = viewBrowsers(view, activeBrowser)
  const Icon = view.show ? Eye : EyeOff
  const label = view.show ? `Showing ${shown} of ${total}` : `Comments hidden (${total})`
  const filtered = view.show && !isDefaultCommentView(view)

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Comment pins: ${label}`}
        onClick={() => setOpen(o => !o)}
        className="tahi-focus-ring inline-flex items-center rounded-[var(--radius-leaf-sm)] border bg-[var(--color-bg)] px-3 text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-tertiary)]"
        style={{
          minHeight: '2.75rem',
          gap: '0.375rem',
          fontSize: '0.8125rem',
          fontWeight: 600,
          borderColor: filtered ? 'var(--color-brand)' : 'var(--color-border)',
        }}
      >
        <Icon className="size-4" aria-hidden="true" />
        <span className="whitespace-nowrap">{label}</span>
      </button>
      <Popover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} align="start" width="20rem" maxHeight="28rem" mobileFullWidth label="Comment pins">
        <div className="flex flex-col" style={{ gap: '0.875rem', padding: '0.75rem' }}>
          <button
            type="button"
            aria-pressed={view.show}
            onClick={() => onChange({ ...view, show: !view.show })}
            className={chipClass(view.show, 'inline-flex items-center justify-between')}
          >
            <span className="inline-flex items-center" style={{ gap: '0.375rem' }}>
              {view.show ? <Eye className="size-4" aria-hidden="true" /> : <EyeOff className="size-4" aria-hidden="true" />}
              {view.show ? 'Hide comments' : 'Show comments'}
            </span>
            <span>{view.show ? 'On' : 'Off'}</span>
          </button>

          <fieldset className="flex flex-col" style={{ gap: '0.375rem', border: 0, margin: 0, padding: 0, minWidth: 0 }} disabled={!view.show}>
            <legend className="text-[var(--color-text-muted)]" style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', padding: 0, marginBottom: '0.375rem' }}>
              Status
            </legend>
            <div role="group" aria-label="Pin status" className="flex flex-wrap" style={{ gap: '0.375rem' }}>
              {STATUS_OPTIONS.map(o => (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={view.status === o.value}
                  onClick={() => onChange({ ...view, status: o.value })}
                  className={chipClass(view.status === o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>

            {roundBrowsers.length > 1 ? (
              <>
                <span className="text-[var(--color-text-muted)]" style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', marginTop: '0.5rem' }}>
                  Browser
                </span>
                <div role="group" aria-label="Pin browsers" className="flex flex-wrap" style={{ gap: '0.375rem' }}>
                  {roundBrowsers.map(b => {
                    const on = effectiveBrowsers.includes(b)
                    return (
                      <button
                        key={b}
                        type="button"
                        aria-pressed={on}
                        onClick={() => onChange(toggleViewBrowser(view, b, activeBrowser))}
                        className={chipClass(on)}
                      >
                        {browserLabel(b)}
                      </button>
                    )
                  })}
                </div>
              </>
            ) : null}

            {viewports.length > 1 || view.hiddenViewports.length > 0 ? (
              <>
                <span className="text-[var(--color-text-muted)]" style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', marginTop: '0.5rem' }}>
                  Viewport
                </span>
                <div role="group" aria-label="Pin viewports" className="flex flex-wrap" style={{ gap: '0.375rem' }}>
                  {QA_VIEWPORTS.filter(v => viewports.includes(v.key) || view.hiddenViewports.includes(v.key)).map(v => {
                    const on = !view.hiddenViewports.includes(v.key)
                    return (
                      <button
                        key={v.key}
                        type="button"
                        aria-pressed={on}
                        onClick={() => onChange(toggleViewViewport(view, v.key))}
                        className={chipClass(on)}
                      >
                        {v.label}
                      </button>
                    )
                  })}
                </div>
              </>
            ) : null}
          </fieldset>

          <div className="flex items-center justify-between" style={{ gap: '0.5rem' }}>
            <span className="text-[var(--color-text-muted)]" style={{ fontSize: '0.75rem' }}>
              A selected comment always keeps its pin. Comments are not changed.
            </span>
            <TahiButton
              variant="ghost"
              size="sm"
              onClick={() => onChange(DEFAULT_COMMENT_VIEW)}
              disabled={isDefaultCommentView(view)}
              style={{ minHeight: '2.75rem' }}
            >
              Reset
            </TahiButton>
          </div>
        </div>
      </Popover>
    </>
  )
}
