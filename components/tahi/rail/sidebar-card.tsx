'use client'

/**
 * <SidebarCard>. The boxed card every detail rail is made of: a leaf-radius
 * icon tile, an 11px uppercase title with 0.05em tracking, an optional
 * tabular count, and an action slot hard right.
 *
 * Every card is `overflow: hidden` with no escape hatch. Menus leave through
 * the portalled <Popover>, never out of the card box, which is what keeps a
 * long option list from stretching the rail.
 *
 * Extracted from app/(dashboard)/requests/[id]/request-detail.tsx so the
 * Tasks detail composes the same card instead of hand-rolling a fifth copy.
 *
 * It lives under rail/ rather than at components/tahi/sidebar-card.tsx
 * because that path is already taken by an unrelated, live <SidebarCard> plus
 * <SidebarSection> pair (the "one outer card, many labelled sections" shape
 * the deal detail uses). Two different components cannot share one name in
 * one module, and the deals surface is not this slice's to rename.
 */

import * as React from 'react'
import { Card } from '@/components/tahi/card'

/** The icon tile in a rail card head. Decorative: the title carries meaning. */
export function RailHeadIcon({ children }: { children: React.ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex items-center justify-center flex-shrink-0"
      style={{
        width: '1.5rem',
        height: '1.5rem',
        borderRadius: 'var(--radius-leaf-sm)',
        background: 'var(--color-bg-secondary)',
        color: 'var(--color-text-muted)',
      }}
    >
      {children}
    </span>
  )
}

/** The head's tabular count, e.g. how many calls or checklists a card holds. */
export function RailHeadCount({ value }: { value: number }) {
  return (
    <span
      className="tabular-nums"
      style={{ fontSize: '0.71875rem', fontWeight: 600, color: 'var(--color-text-subtle)' }}
    >
      {value}
    </span>
  )
}

export interface SidebarCardProps {
  title: string
  icon?: React.ReactNode
  count?: number
  /** Sits hard right in the head: an add button, a toggle. */
  action?: React.ReactNode
  /** Prototype default. Details passes a tighter vertical pad, because its
   *  rows carry their own rhythm and dividers. */
  bodyPadding?: string
  children: React.ReactNode
}

export function SidebarCard({
  title,
  icon,
  count,
  action,
  bodyPadding = '0.8125rem 0.875rem',
  children,
}: SidebarCardProps) {
  return (
    <Card padding="none" style={{ overflow: 'hidden' }}>
      <div
        className="flex items-center"
        style={{
          gap: '0.5rem',
          padding: '0.6875rem 0.875rem',
          borderBottom: '1px solid var(--color-border-subtle)',
        }}
      >
        {icon && <RailHeadIcon>{icon}</RailHeadIcon>}
        <h3
          className="uppercase"
          style={{
            margin: 0,
            fontSize: '0.6875rem',
            fontWeight: 700,
            letterSpacing: '0.05em',
            color: 'var(--color-text-subtle)',
          }}
        >
          {title}
        </h3>
        {count != null && <RailHeadCount value={count} />}
        {action && <span style={{ marginLeft: 'auto', display: 'inline-flex' }}>{action}</span>}
      </div>
      <div style={{ padding: bodyPadding }}>
        {children}
      </div>
    </Card>
  )
}

/**
 * Every command in the Actions card wears the rail's one button shape, ported
 * from the prototype's `.req-timer-btn`: full width, 2.25rem tall from md up
 * and 2.75rem below it, a 12.5px/600 label with the icon on the left. Each
 * caller supplies only what differs (border, fill, text, hover), so the four
 * of them cannot drift apart again.
 */
export const RAIL_ACTION_CLASS = 'tahi-focus-ring flex items-center w-full min-h-11 md:min-h-9'
export const RAIL_ACTION_STYLE: React.CSSProperties = {
  gap: '0.4375rem',
  padding: '0 0.6875rem',
  fontSize: '0.78125rem',
  fontWeight: 600,
  borderRadius: 'var(--radius-md)',
  justifyContent: 'flex-start',
  transition: 'background-color 140ms ease, border-color 140ms ease, color 140ms ease',
}
