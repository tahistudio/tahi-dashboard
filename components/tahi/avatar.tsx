'use client'

/**
 * <Avatar>. User / contact / team-member portrait.
 *
 * When `src` is set, renders the image inside a circular crop with a
 * 1px brand-tinted ring. When `src` is missing or fails to load, falls
 * back to gradient initials (brand-lighter → brand-dark, 135°).
 *
 * Sizes follow the dashboard ladder. Pass an integer to override.
 *
 *   <Avatar name="Liam Miller" />
 *   <Avatar name="Olivia Chen" src="/o.jpg" size="lg" />
 *   <Avatar name="Bot" status="online" />
 *   <Avatar.Stack>
 *     <Avatar name="A" />
 *     <Avatar name="B" />
 *     <Avatar name="C" />
 *     <Avatar.Overflow count={3} />
 *   </Avatar.Stack>
 */

import * as React from 'react'

type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl'
type StatusDot = 'online' | 'away' | 'offline' | null | undefined

const SIZE_PX: Record<Size, number> = {
  xs: 20,
  sm: 24,
  md: 32,
  lg: 40,
  xl: 56,
}

const STATUS_COLOUR: Record<NonNullable<StatusDot>, string> = {
  online:  'var(--status-delivered-dot)',
  away:    'var(--status-in-review-dot)',
  offline: 'var(--color-text-subtle)',
}

interface AvatarProps {
  name: string
  src?: string | null
  size?: Size | number
  /** Optional presence dot in the bottom-right. */
  status?: StatusDot
  /** Forces ring colour. Defaults to a very subtle neutral. */
  ring?: string
  className?: string
  /** Optional click handler. If set, renders as a button. */
  onClick?: () => void
  /** When `true`, removes the white outer ring used by overlapping stacks. */
  noRing?: boolean
  style?: React.CSSProperties
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function resolveSize(size: Size | number): number {
  return typeof size === 'number' ? size : SIZE_PX[size]
}

function AvatarRoot({
  name,
  src,
  size = 'md',
  status,
  ring,
  className,
  onClick,
  noRing,
  style,
}: AvatarProps) {
  const [errored, setErrored] = React.useState(false)
  const px = resolveSize(size)
  const showImg = src && !errored
  const fontPx = Math.max(10, Math.round(px * 0.4))
  const ringWidth = px <= 24 ? 1 : 2

  const Tag = onClick ? 'button' : 'div'

  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      title={name}
      aria-label={name}
      className={className}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: px,
        height: px,
        borderRadius: '9999px',
        background: 'var(--gradient-leaf-icon)',
        color: '#ffffff',
        fontSize: fontPx,
        fontWeight: 600,
        letterSpacing: '0.01em',
        boxShadow: noRing
          ? undefined
          : `0 0 0 ${ringWidth}px ${ring ?? 'var(--color-bg)'}`,
        overflow: 'hidden',
        flexShrink: 0,
        border: 'none',
        cursor: onClick ? 'pointer' : 'default',
        padding: 0,
        ...style,
      }}
    >
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src!}
          alt=""
          onError={() => setErrored(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <span aria-hidden="true">{initials(name)}</span>
      )}
      {status && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            right: -1,
            bottom: -1,
            width: Math.max(8, Math.round(px * 0.28)),
            height: Math.max(8, Math.round(px * 0.28)),
            borderRadius: '9999px',
            background: STATUS_COLOUR[status],
            boxShadow: '0 0 0 2px var(--color-bg)',
          }}
        />
      )}
    </Tag>
  )
}

// ── Overlapping stack. Avatar.Stack ────────────────────────────────────
function AvatarStack({
  children,
  spacing = 'normal',
  max,
  className,
}: {
  children: React.ReactNode
  spacing?: 'tight' | 'normal' | 'loose'
  /** When set, truncates the children and adds an Overflow chip. */
  max?: number
  className?: string
}) {
  const gap = spacing === 'tight' ? '-0.625rem' : spacing === 'loose' ? '-0.25rem' : '-0.5rem'

  const childArray = React.Children.toArray(children)
  let display = childArray
  let overflowCount = 0
  if (max !== undefined && childArray.length > max) {
    display = childArray.slice(0, max)
    overflowCount = childArray.length - max
  }

  // Explicit z-index so the visual stacking is deterministic across
  // browsers. Each subsequent avatar sits in front of the previous,
  // and the overflow tile sits in front of every avatar. This is the
  // pattern that reads as "and a few more" rather than "ghosted".
  const total = display.length + (overflowCount > 0 ? 1 : 0)
  return (
    <div className={className} style={{ display: 'inline-flex', alignItems: 'center' }}>
      {display.map((child, i) => (
        <span
          key={i}
          style={{
            marginLeft: i === 0 ? 0 : gap,
            display: 'inline-flex',
            position: 'relative',
            zIndex: i + 1,
          }}
        >
          {child}
        </span>
      ))}
      {overflowCount > 0 && (
        <span style={{
          marginLeft: gap,
          display: 'inline-flex',
          position: 'relative',
          zIndex: total + 1,
        }}>
          <AvatarOverflow count={overflowCount} />
        </span>
      )}
    </div>
  )
}

// ── "+3" overflow tile used inside Avatar.Stack ─────────────────────────
function AvatarOverflow({
  count,
  size = 'md',
}: {
  count: number
  size?: Size | number
}) {
  const px = resolveSize(size)
  // The overflow tile reads as a label, not an avatar. White surface,
  // strong border, muted text. With the explicit z-index in
  // Avatar.Stack it sits in front of every avatar.
  return (
    <div
      title={`${count} more`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: px,
        height: px,
        borderRadius: '9999px',
        background: 'var(--color-bg)',
        color: 'var(--color-text-muted)',
        fontSize: Math.max(10, Math.round(px * 0.36)),
        fontWeight: 600,
        boxShadow: '0 0 0 2px var(--color-bg-cream), inset 0 0 0 1px var(--color-border-strong)',
      }}
    >
      +{count}
    </div>
  )
}

export const Avatar = Object.assign(AvatarRoot, {
  Stack: AvatarStack,
  Overflow: AvatarOverflow,
})

export type AvatarSize = Size
