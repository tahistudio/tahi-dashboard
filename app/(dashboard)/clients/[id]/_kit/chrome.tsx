'use client'

/**
 * The small shared chrome the client detail tabs are laid out with: a section
 * bar, a section title, a muted count, a KPI tile and the "View all" link.
 *
 * These are layout atoms, not new primitives. Anything with real behaviour
 * (Card, Badge, DataTable, EmptyState, SlideOver, TahiButton, Menu, Popover,
 * Tooltip, SegmentedControl) comes from components/tahi.
 *
 * Two house rules are enforced here rather than repeated at every call site:
 * borders are all sides or absent, and every interactive element clears a
 * 2.75rem touch target below md.
 */

import * as React from 'react'
import { Card } from '@/components/tahi/card'

/** A row of controls above a table or list: title, count, then actions. */
export function SubBar({
  children,
  style,
}: {
  children: React.ReactNode
  style?: React.CSSProperties
}) {
  return (
    <div
      className="flex items-center flex-wrap"
      style={{ gap: '0.625rem', minHeight: '2.75rem', ...style }}
    >
      {children}
    </div>
  )
}

/** The heading inside a SubBar. */
export function SectionTitle({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h3
      id={id}
      style={{ margin: 0, fontSize: '0.875rem', fontWeight: 700, color: 'var(--color-text)' }}
    >
      {children}
    </h3>
  )
}

/** The muted "12 requests" line that sits next to a SectionTitle. */
export function CountText({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--color-text-muted)' }}>
      {children}
    </span>
  )
}

/** Pushes everything after it to the right of a SubBar. */
export function Grow() {
  return <span style={{ flex: 1, minWidth: 0 }} aria-hidden="true" />
}

/**
 * A text action that still clears 2.75rem on touch. Used for "View all",
 * "Billing settings" and the hero's stat links, all of which the design
 * critic flagged as sub-target at 375px.
 */
export function InlineAction({
  children,
  onClick,
  href,
  disabled,
  ariaLabel,
  title,
}: {
  children: React.ReactNode
  onClick?: () => void
  href?: string
  disabled?: boolean
  ariaLabel?: string
  title?: string
}) {
  const style: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.25rem',
    minHeight: '2.75rem',
    padding: '0 0.5rem',
    border: 'none',
    background: 'none',
    borderRadius: 'var(--radius-sm)',
    fontSize: '0.75rem',
    fontWeight: 600,
    color: disabled ? 'var(--color-text-subtle)' : 'var(--color-brand-dark)',
    textDecoration: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'background var(--motion-quick) var(--ease-out), color var(--motion-quick) var(--ease-out)',
  }

  if (href && !disabled) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="tahi-focus-ring"
        style={style}
        aria-label={ariaLabel}
        title={title}
      >
        {children}
      </a>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="tahi-focus-ring"
      style={style}
      aria-label={ariaLabel}
      title={title}
    >
      {children}
    </button>
  )
}

/**
 * An anchor that reads as a button. <TahiButton> is a <button> and cannot
 * carry an href, and a download has to be a real link so middle-click and
 * "save link as" keep working.
 */
export function LinkButton({
  href,
  children,
  tone = 'secondary',
  ariaLabel,
}: {
  href: string
  children: React.ReactNode
  tone?: 'primary' | 'secondary'
  ariaLabel?: string
}) {
  const primary = tone === 'primary'
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={ariaLabel}
      className="tahi-focus-ring min-h-[2.75rem] md:min-h-[2.25rem]"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.375rem',
        padding: '0 0.875rem',
        borderRadius: 'var(--radius-button)',
        border: `1px solid ${primary ? 'var(--color-brand)' : 'var(--color-border-strong)'}`,
        background: primary ? 'var(--color-brand)' : 'var(--color-bg)',
        color: primary ? '#ffffff' : 'var(--color-text)',
        fontSize: '0.8125rem',
        fontWeight: 500,
        textDecoration: 'none',
        whiteSpace: 'nowrap',
        transition: 'background-color var(--motion-quick) var(--ease-out), border-color var(--motion-quick) var(--ease-out)',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = primary ? 'var(--color-brand-dark)' : 'var(--color-bg-secondary)'
        if (!primary) e.currentTarget.style.borderColor = 'var(--color-brand)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = primary ? 'var(--color-brand)' : 'var(--color-bg)'
        if (!primary) e.currentTarget.style.borderColor = 'var(--color-border-strong)'
      }}
    >
      {children}
    </a>
  )
}

/** A responsive grid of KPI tiles. */
export function TileGrid({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4"
      style={{ gap: '0.75rem' }}
    >
      {children}
    </div>
  )
}

/** One KPI tile: a label, a big number, and a line of context under it. */
export function Tile({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  tone?: 'neutral' | 'danger' | 'positive'
}) {
  const valueColour =
    tone === 'danger' ? 'var(--color-danger)'
      : tone === 'positive' ? 'var(--color-brand)'
        : 'var(--color-text)'
  return (
    <Card padding="sm" style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', minWidth: 0 }}>
      <span
        className="uppercase"
        style={{ fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.05em', color: 'var(--color-text-subtle)' }}
      >
        {label}
      </span>
      <span
        className="tabular-nums"
        style={{ fontSize: '1.25rem', lineHeight: 1.1, fontWeight: 700, letterSpacing: '-0.01em', color: valueColour }}
      >
        {value}
      </span>
      {hint != null && (
        <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--color-text-subtle)' }}>
          {hint}
        </span>
      )}
    </Card>
  )
}

/** The Overview column block: a titled card whose body is a list of rows. */
export function Block({
  icon,
  title,
  count,
  action,
  children,
}: {
  icon?: React.ReactNode
  title: string
  count?: number
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Card padding="none" style={{ overflow: 'hidden' }}>
      <div
        className="flex items-center"
        style={{
          gap: '0.5rem',
          padding: '0.5rem 0.875rem',
          minHeight: '2.75rem',
          background: 'var(--color-bg-secondary)',
        }}
      >
        {icon && (
          <span
            aria-hidden="true"
            className="inline-flex items-center justify-center flex-shrink-0"
            style={{
              width: '1.5rem',
              height: '1.5rem',
              borderRadius: 'var(--radius-leaf-sm)',
              background: 'var(--color-bg)',
              color: 'var(--color-text-muted)',
            }}
          >
            {icon}
          </span>
        )}
        <h3 style={{ margin: 0, fontSize: '0.8125rem', fontWeight: 700, color: 'var(--color-text)' }}>
          {title}
        </h3>
        {count != null && (
          <span className="tabular-nums" style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-subtle)' }}>
            {count}
          </span>
        )}
        {action && <span style={{ marginLeft: 'auto', display: 'inline-flex' }}>{action}</span>}
      </div>
      <div style={{ padding: '0.5rem' }}>{children}</div>
    </Card>
  )
}
