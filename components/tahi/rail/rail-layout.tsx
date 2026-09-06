'use client'

/**
 * <RailLayout>. The generic rail frame: a 14.5rem rail beside the main
 * column, the view switcher / search / count row, the active-filter chips
 * (which also carry Save as default below 1024px, where the rail's own foot
 * is inside the sheet), and the mobile Filters sheet that stands in for the
 * rail below 1024px.
 *
 * Generalised out of components/tahi/requests/requests-rail-layout.tsx, which
 * is now a thin wrapper over it, so the Tasks page reuses the frame rather
 * than growing a second copy of it. Nothing here knows a vocabulary: the rail
 * itself arrives as a node, the chips as data, and the counted noun as a
 * string.
 *
 * The main column is `min-width: 0`, so a board or a timeline scrolls inside
 * it and the page header above keeps the same width in every view.
 *
 * Four slots are optional, because not every surface has all of them: the
 * switcher, the search box, Save as default, and `trailing` (one action hard
 * right of the count). Notifications is the surface that has views in the
 * rail, no sort, no search its API can honour, no default to save, and one
 * action of its own: Mark all as read. Every default keeps the Requests,
 * Clients and Tasks readings exactly as they were.
 */

import * as React from 'react'
import { Filter, RotateCcw, Search, X } from 'lucide-react'
import { SlideOver } from '@/components/tahi/slide-over'
import { TahiButton } from '@/components/tahi/tahi-button'
import type { RailFilterChip } from '@/components/tahi/rail/rail-controls'

// -- Chips -------------------------------------------------------------------

/** Every chip source renders through the same box: a rail's own dimensions
 *  and any URL-only ones that have no rail control. */
type AnyFilterChip = Pick<RailFilterChip, 'dimension' | 'label' | 'dot'>

export function FilterChip({ chip, onClear }: { chip: AnyFilterChip; onClear: () => void }) {
  return (
    <span
      className="inline-flex items-center h-11 lg:h-8"
      style={{
        gap: '0.375rem',
        padding: '0 0 0 0.5625rem',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--color-bg)',
        fontSize: '0.75rem',
        fontWeight: 600,
        color: 'var(--color-text)',
        whiteSpace: 'nowrap',
      }}
    >
      {chip.dot && (
        <span
          aria-hidden="true"
          style={{ width: '0.4375rem', height: '0.4375rem', borderRadius: 'var(--radius-full)', background: chip.dot, flexShrink: 0 }}
        />
      )}
      <span style={{ color: 'var(--color-text-subtle)' }}>{chip.dimension}</span>
      <span>{chip.label}</span>
      <button
        type="button"
        onClick={onClear}
        className="tahi-focus-ring inline-flex items-center justify-center h-11 w-11 lg:h-6 lg:w-6"
        aria-label={`Clear the ${chip.dimension.toLowerCase()} filter`}
        style={{
          border: 'none',
          borderRadius: 'var(--radius-sm)',
          background: 'transparent',
          color: 'var(--color-text-subtle)',
          cursor: 'pointer',
          transition: 'background-color var(--motion-quick) var(--ease-out), color var(--motion-quick) var(--ease-out)',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = 'var(--color-bg-tertiary)'
          e.currentTarget.style.color = 'var(--color-text)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.color = 'var(--color-text-subtle)'
        }}
      >
        <X size={12} aria-hidden="true" />
      </button>
    </span>
  )
}

// -- The frame ---------------------------------------------------------------

export interface RailLayoutProps {
  /** The desktop rail contents. Rendered inside the 14.5rem aside. */
  rail: React.ReactNode
  /** Accessible name for the rail and the sheet it folds into. A surface with
   *  no sort must not claim one. */
  railLabel?: string
  sheetTitle?: string
  /** The same rail with 44px targets, rendered inside the mobile sheet. */
  railTouch: React.ReactNode
  /** The view switcher, rendered first in the toolbar row. Optional: the
   *  Notifications page has no desktop switcher (its views live in the rail)
   *  and passes only the phone's segmented track. */
  switcher?: React.ReactNode
  chips: readonly RailFilterChip[]
  onClearChip: (chip: RailFilterChip) => void
  onClearAll: () => void
  /** Put the view back to the saved default. Omitted when there is no saved
   *  default, or when the view already matches it. */
  onResetDefault?: () => void
  /** Search is opt-in: the box renders only when there is a handler to take
   *  it. A surface whose API cannot search must not draw a field that
   *  silently searches one loaded page. */
  query?: string
  onQueryChange?: (next: string) => void
  searchPlaceholder?: string
  /** Rows after the saved view, filters and search have been applied. */
  total: number
  /** Singular noun for the count, e.g. 'request' or 'task'. */
  itemNoun: string
  /** Plural, when it is not just `${itemNoun}s`. */
  itemNounPlural?: string
  /** Shows a quiet loading word in place of the count on the first fetch. */
  loading?: boolean
  /** Stands in for the count when the surface has no honest number to give,
   *  e.g. 'Could not load' after a failed read. The count row is aria-live, so
   *  a stale or zero total there is announced as fact beside an error card.
   *  The sheet's primary button falls back to Close for the same reason:
   *  "Show 0" is a claim the page cannot make. */
  countOverride?: string
  /** Adds to the mobile Filters badge alongside the chip count, e.g. 1 when
   *  a saved view is active. */
  extraActiveCount?: number
  /** Rendered at the right of the chip row below lg, where the rail's own
   *  foot is inside the sheet. Pass <SaveDefaultControl touch />. Omitted on
   *  a surface with no saved default to keep. */
  saveDefaultTouch?: React.ReactNode
  /** Sits after the count, hard right of the toolbar row: the one action the
   *  list itself owns, e.g. Mark all as read. */
  trailing?: React.ReactNode
  children: React.ReactNode
}

export function RailLayout({
  rail,
  railLabel = 'Saved views, filters and sort',
  sheetTitle = 'Filters and sort',
  railTouch,
  switcher,
  chips,
  onClearChip,
  onClearAll,
  onResetDefault,
  query,
  onQueryChange,
  searchPlaceholder,
  total,
  itemNoun,
  itemNounPlural,
  loading = false,
  countOverride,
  extraActiveCount = 0,
  saveDefaultTouch,
  trailing,
  children,
}: RailLayoutProps) {
  const [sheetOpen, setSheetOpen] = React.useState(false)
  const activeCount = chips.length + extraActiveCount
  const anyChips = chips.length > 0
  const countLabel = countOverride
    ?? `${total} ${total === 1 ? itemNoun : (itemNounPlural ?? `${itemNoun}s`)}`

  return (
    <div className="flex" style={{ gap: '1.25rem' }}>
      <aside
        className="hidden lg:block"
        aria-label={railLabel}
        style={{ width: '14.5rem', flexShrink: 0 }}
      >
        {rail}
      </aside>

      <div className="flex-1 min-w-0 flex flex-col" style={{ gap: '0.75rem' }}>
        <div className="flex items-center flex-wrap" style={{ gap: '0.625rem' }}>
          {switcher}

          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="tahi-focus-ring lg:hidden inline-flex items-center h-11 px-3.5 flex-shrink-0"
            aria-expanded={sheetOpen}
            style={{
              gap: '0.5rem',
              border: `1px solid ${activeCount > 0 ? 'var(--color-brand)' : 'var(--color-border)'}`,
              borderRadius: 'var(--radius-md)',
              background: activeCount > 0 ? 'var(--color-brand-50)' : 'var(--color-bg)',
              fontFamily: 'inherit',
              fontSize: '0.8125rem',
              fontWeight: 600,
              color: activeCount > 0 ? 'var(--color-brand-dark)' : 'var(--color-text)',
              cursor: 'pointer',
            }}
          >
            <Filter size={16} aria-hidden="true" />
            Filters
            {activeCount > 0 && (
              <span
                style={{
                  minWidth: '1.125rem',
                  padding: '0 0.25rem',
                  borderRadius: 'var(--radius-full)',
                  background: 'var(--color-brand)',
                  color: 'var(--color-text-on-dark)',
                  fontSize: '0.6875rem',
                  fontVariantNumeric: 'tabular-nums',
                  lineHeight: '1.125rem',
                  textAlign: 'center',
                }}
              >
                {activeCount}
              </span>
            )}
          </button>

          <div className="hidden lg:block" style={{ flex: 1, minWidth: 0 }} />

          {onQueryChange && (
          <div
            className="tahi-input-group tahi-focus-within flex items-center h-11 lg:h-8"
            style={{
              flex: '1 1 12rem',
              maxWidth: '20rem',
              minWidth: '9rem',
              gap: '0.4375rem',
              padding: '0 0.625rem',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-bg)',
            }}
          >
            <Search size={14} aria-hidden="true" style={{ color: 'var(--color-text-subtle)', flexShrink: 0 }} />
            <input
              value={query ?? ''}
              onChange={e => onQueryChange(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder ?? 'Search'}
              style={{
                flex: 1,
                minWidth: 0,
                border: 'none',
                outline: 'none',
                background: 'transparent',
                fontFamily: 'inherit',
                fontSize: '0.8125rem',
                color: 'var(--color-text)',
              }}
            />
            {query && (
              <button
                type="button"
                onClick={() => onQueryChange('')}
                className="tahi-focus-ring inline-flex items-center justify-center h-11 w-11 lg:h-6 lg:w-6 flex-shrink-0"
                aria-label="Clear search"
                style={{
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  background: 'transparent',
                  color: 'var(--color-text-subtle)',
                  cursor: 'pointer',
                }}
              >
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </div>
          )}

          <span
            aria-live="polite"
            style={{
              flexShrink: 0,
              fontSize: '0.75rem',
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
              color: 'var(--color-text-subtle)',
            }}
          >
            {loading ? 'Loading' : countLabel}
          </span>

          {trailing}
        </div>

        {/* Chips, plus Save as default below lg. Above it the rail's own foot
            carries that control; below it the rail is inside the Filters
            sheet, and a phone should not have to open a sheet to keep the
            view it has just set up. The row is here even with no chips at
            that width, which is exactly when it is only the save affordance. */}
        {(anyChips || onResetDefault || saveDefaultTouch) && (
        <div
          className={anyChips || onResetDefault
            ? 'flex items-center flex-wrap'
            : 'flex lg:hidden items-center flex-wrap'}
          style={{ gap: '0.5rem' }}
        >
          {chips.map(chip => (
            <FilterChip key={chip.key} chip={chip} onClear={() => onClearChip(chip)} />
          ))}
          {/* The other half of Save as default. Without a way back, the
              snapshot only ever labelled itself; this is what makes saving
              one worth the click once the user has wandered. */}
          {onResetDefault && (
            <button
              type="button"
              onClick={onResetDefault}
              className="tahi-focus-ring inline-flex items-center h-11 lg:h-8"
              style={{
                gap: '0.375rem',
                padding: '0 0.625rem',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--color-bg)',
                fontFamily: 'inherit',
                fontSize: '0.75rem',
                fontWeight: 600,
                color: 'var(--color-text-muted)',
                whiteSpace: 'nowrap',
                cursor: 'pointer',
                transition: 'border-color 150ms ease, color 150ms ease',
              }}
              // Brand ink on text is --color-link: --color-brand-dark has no
              // `.dark` override and reads at roughly 2.2:1 on the dark card.
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = 'var(--color-brand)'
                e.currentTarget.style.color = 'var(--color-link)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'var(--color-border)'
                e.currentTarget.style.color = 'var(--color-text-muted)'
              }}
            >
              <RotateCcw size={13} aria-hidden="true" />
              Reset to default
            </button>
          )}
          {saveDefaultTouch && (
            <div className="lg:hidden inline-flex items-center" style={{ marginLeft: 'auto' }}>
              {saveDefaultTouch}
            </div>
          )}
        </div>
        )}

        {children}
      </div>

      <SlideOver
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={sheetTitle}
        icon={<Filter size={15} />}
        maxWidth="22rem"
      >
        <SlideOver.Body>
          {railTouch}
        </SlideOver.Body>
        {/* No Save as default here: the chips row above carries it below lg,
            and two controls with the same accessible name on screen at once
            is worse than one in a slightly less obvious place. */}
        <SlideOver.Footer>
          <TahiButton variant="secondary" size="md" style={{ minHeight: '2.75rem' }} onClick={onClearAll}>
            Clear all
          </TahiButton>
          <div style={{ flex: 1 }} />
          <TahiButton variant="primary" size="md" style={{ minHeight: '2.75rem' }} onClick={() => setSheetOpen(false)}>
            {countOverride ? 'Close' : `Show ${total}`}
          </TahiButton>
        </SlideOver.Footer>
      </SlideOver>
    </div>
  )
}
