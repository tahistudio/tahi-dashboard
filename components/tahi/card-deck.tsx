'use client'

// ─── CardDeck ────────────────────────────────────────────────────────────────
//
// A peek-behind card stack (Liam's "card behind other cards that can be sliders"
// from the Crextio reference). The active card sits on top; up to two cards peek
// from behind it, offset + scaled + faded for depth. Page through with the
// prev/next controls, the dots, or the arrow keys when focused. One card's worth
// of vertical space holds several items: density without a wall of cards.
//
// Reduced motion: transitions collapse to instant. Empty: renders emptyState.

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface CardDeckProps<T> {
  items: T[]
  renderCard: (item: T, isActive: boolean) => React.ReactNode
  getKey: (item: T, index: number) => string
  ariaLabel: string
  /** Height of the deck (the active card). Cards behind add a little below. */
  minHeight?: string
  emptyState?: React.ReactNode
}

const PEEK = 2 // how many cards peek behind the active one

export function CardDeck<T>({ items, renderCard, getKey, ariaLabel, minHeight = '7rem', emptyState }: CardDeckProps<T>) {
  const [active, setActive] = useState(0)
  const regionRef = useRef<HTMLDivElement | null>(null)

  // Clamp the active index if the items list shrinks.
  useEffect(() => {
    if (active > items.length - 1) setActive(Math.max(0, items.length - 1))
  }, [items.length, active])

  const go = useCallback((dir: 1 | -1) => {
    setActive(a => {
      const n = items.length
      if (n === 0) return 0
      return (a + dir + n) % n
    })
  }, [items.length])

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1) }
  }, [go])

  if (items.length === 0) return <>{emptyState ?? null}</>

  return (
    <div
      ref={regionRef}
      role="group"
      aria-roledescription="carousel"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      tabIndex={0}
      className="card-deck"
      style={{ position: 'relative', outline: 'none' }}
    >
      <div style={{ position: 'relative', minHeight }}>
        {items.map((item, i) => {
          // Depth relative to the active card, wrapping so the deck feels circular.
          const n = items.length
          let depth = i - active
          if (depth < 0) depth += n
          const isActive = depth === 0
          const behind = depth > 0 && depth <= PEEK
          if (!isActive && !behind) {
            // Off-stack cards stay mounted but hidden (keeps focus order sane).
            return (
              <div key={getKey(item, i)} aria-hidden="true" style={{ position: 'absolute', inset: 0, opacity: 0, pointerEvents: 'none', visibility: 'hidden' }}>
                {renderCard(item, false)}
              </div>
            )
          }
          return (
            <div
              key={getKey(item, i)}
              aria-hidden={!isActive}
              className="card-deck-card"
              style={{
                position: isActive ? 'relative' : 'absolute',
                inset: isActive ? undefined : 0,
                zIndex: PEEK + 1 - depth,
                transform: `translateY(${depth * 0.5}rem) scale(${1 - depth * 0.035})`,
                opacity: isActive ? 1 : 0.55 - (depth - 1) * 0.2,
                transformOrigin: 'top center',
                pointerEvents: isActive ? 'auto' : 'none',
                transition: 'transform var(--motion-medium) var(--ease-productive), opacity var(--motion-medium) var(--ease-productive)',
              }}
            >
              {renderCard(item, isActive)}
            </div>
          )
        })}
      </div>

      {items.length > 1 && (
        <div className="flex items-center justify-between" style={{ marginTop: 'var(--space-3)' }}>
          {/* Dots */}
          <div className="flex items-center" style={{ gap: 'var(--space-1-5)' }} aria-hidden="true">
            {items.map((_, i) => (
              <span
                key={i}
                style={{
                  width: i === active ? '1.125rem' : '0.375rem',
                  height: '0.375rem',
                  borderRadius: '9999px',
                  background: i === active ? 'var(--color-brand)' : 'var(--color-border-strong)',
                  transition: 'width var(--motion-base) var(--ease-productive), background-color var(--motion-base) var(--ease-productive)',
                }}
              />
            ))}
          </div>
          {/* Prev / next */}
          <div className="flex items-center" style={{ gap: 'var(--space-1)' }}>
            <DeckBtn label="Previous" onClick={() => go(-1)}><ChevronLeft size={15} aria-hidden="true" /></DeckBtn>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', fontVariantNumeric: 'tabular-nums', minWidth: '2.25rem', textAlign: 'center' }}>
              {active + 1} / {items.length}
            </span>
            <DeckBtn label="Next" onClick={() => go(1)}><ChevronRight size={15} aria-hidden="true" /></DeckBtn>
          </div>
        </div>
      )}
    </div>
  )
}

function DeckBtn({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex items-center justify-center new-menu-item"
      style={{
        width: '1.75rem',
        height: '1.75rem',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--color-border-subtle)',
        background: 'var(--color-bg)',
        color: 'var(--color-text-muted)',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}
