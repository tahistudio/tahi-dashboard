/**
 * <Card> — the foundational surface primitive.
 *
 * Webflow-style compound API with named slots. Use this instead of raw
 * `<div className="border rounded-xl ...">` everywhere so the card look
 * (border, radius, hover, padding) stays locked in one place.
 *
 *   <Card variant="default" padding="md">
 *     <Card.Header>
 *       <Card.Title>Title</Card.Title>
 *       <Card.Subtitle>Meta</Card.Subtitle>
 *       <Card.Action><Button>Refresh</Button></Card.Action>
 *     </Card.Header>
 *     <Card.Body>...</Card.Body>
 *     <Card.Divider />
 *     <Card.Section label="DETAILS">...</Card.Section>
 *     <Card.Footer>...</Card.Footer>
 *   </Card>
 *
 * Variants:
 *   default   1px border, radius-lg, no resting shadow, hover: darker border + shadow-sm
 *   flat      no border, no hover
 *   grouped   no internal padding (children manage their own), used for KPI
 *             strips and any "many cells, internal dividers" pattern
 *   elevated  shadow-md, used for popovers / tooltips / floating UI
 *
 * Padding:
 *   none | sm (12px) | md (20px, default) | lg (32px)
 *
 * interactive = true OR href set → adds cursor: pointer + hover state
 * href → renders as <Link>
 */

import React from 'react'
import Link from 'next/link'

// ── Types ───────────────────────────────────────────────────────────────────

type Variant = 'default' | 'flat' | 'grouped' | 'elevated'
type Padding = 'none' | 'sm' | 'md' | 'lg'

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: Variant
  padding?: Padding
  /** Adds hover state without needing href */
  interactive?: boolean
  /** When set, the card renders as a Next.js Link */
  href?: string
  /** Adds subtle lift on hover (translateY + shadow). Default true for interactive/href. */
  hoverLift?: boolean
  /** Removes default bottom margin radius when the card is inside a scrolling list */
  as?: 'div' | 'article' | 'section'
  children?: React.ReactNode
}

// ── Padding token helper ────────────────────────────────────────────────────

function paddingValue(p: Padding): string {
  switch (p) {
    case 'none': return '0'
    case 'sm':   return 'var(--space-3)'
    case 'md':   return 'var(--space-5)'
    case 'lg':   return 'var(--space-8)'
  }
}

// ── Root ────────────────────────────────────────────────────────────────────

function CardRoot({
  variant = 'default',
  padding = 'md',
  interactive = false,
  hoverLift,
  href,
  as: Tag = 'div',
  className,
  style,
  children,
  ...rest
}: CardProps) {
  const isInteractive = interactive || !!href
  const shouldLift = hoverLift ?? isInteractive

  const baseStyle: React.CSSProperties = {
    background: 'var(--color-bg)',
    borderRadius: 'var(--radius-lg)',
    padding: variant === 'grouped' ? 0 : paddingValue(padding),
    overflow: variant === 'grouped' ? 'hidden' : undefined,
    border: variant === 'flat' ? 'none' : '1px solid var(--color-border-subtle)',
    boxShadow: variant === 'elevated' ? 'var(--shadow-md)' : undefined,
    transition: 'border-color 150ms ease, box-shadow 150ms ease, transform 150ms ease',
    ...style,
  }

  const interactiveProps: React.HTMLAttributes<HTMLElement> = isInteractive
    ? {
        onMouseEnter: e => {
          const el = e.currentTarget as HTMLElement
          if (variant !== 'flat') el.style.borderColor = 'var(--color-border)'
          el.style.boxShadow = 'var(--shadow-sm)'
          if (shouldLift) el.style.transform = 'translateY(-1px)'
        },
        onMouseLeave: e => {
          const el = e.currentTarget as HTMLElement
          if (variant !== 'flat') el.style.borderColor = 'var(--color-border-subtle)'
          el.style.boxShadow = variant === 'elevated' ? 'var(--shadow-md)' : 'none'
          el.style.transform = ''
        },
      }
    : {}

  if (href) {
    return (
      <Link
        href={href}
        className={className}
        style={{ ...baseStyle, cursor: 'pointer', textDecoration: 'none', color: 'inherit', display: 'block' }}
        onMouseEnter={interactiveProps.onMouseEnter as React.MouseEventHandler<HTMLAnchorElement>}
        onMouseLeave={interactiveProps.onMouseLeave as React.MouseEventHandler<HTMLAnchorElement>}
      >
        {children}
      </Link>
    )
  }

  return (
    <Tag
      {...rest}
      className={className}
      style={{ ...baseStyle, cursor: isInteractive ? 'pointer' : undefined }}
      onMouseEnter={interactiveProps.onMouseEnter}
      onMouseLeave={interactiveProps.onMouseLeave}
    >
      {children}
    </Tag>
  )
}

// ── Header / Title / Subtitle / Action ──────────────────────────────────────

function CardHeader({
  children,
  className,
  style,
  bordered = false,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { bordered?: boolean }) {
  return (
    <div
      {...rest}
      className={className}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 'var(--space-3)',
        marginBottom: 'var(--space-4)',
        paddingBottom: bordered ? 'var(--space-3)' : undefined,
        borderBottom: bordered ? '1px solid var(--color-border-subtle)' : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

function CardTitle({ children, className, style, as: Tag = 'h3', ...rest }: React.HTMLAttributes<HTMLHeadingElement> & { as?: 'h1' | 'h2' | 'h3' | 'h4' }) {
  return (
    <Tag
      {...rest}
      className={className}
      style={{
        fontSize: 'var(--text-md)',
        fontWeight: 600,
        color: 'var(--color-text)',
        letterSpacing: '-0.005em',
        ...style,
      }}
    >
      {children}
    </Tag>
  )
}

function CardSubtitle({ children, className, style, ...rest }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      {...rest}
      className={className}
      style={{
        fontSize: 'var(--text-xs)',
        color: 'var(--color-text-muted)',
        marginTop: 'var(--space-1)',
        ...style,
      }}
    >
      {children}
    </p>
  )
}

function CardAction({ children, className, style, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={className}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        flexShrink: 0,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

// ── Body / Footer / Section / Divider ───────────────────────────────────────

function CardBody({ children, className, style, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={className} style={style}>
      {children}
    </div>
  )
}

function CardFooter({ children, className, style, bordered = false, ...rest }: React.HTMLAttributes<HTMLDivElement> & { bordered?: boolean }) {
  return (
    <div
      {...rest}
      className={className}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        marginTop: 'var(--space-4)',
        paddingTop: bordered ? 'var(--space-3)' : undefined,
        borderTop: bordered ? '1px solid var(--color-border-subtle)' : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

function CardDivider({ style }: { style?: React.CSSProperties }) {
  return (
    <hr
      style={{
        border: 'none',
        borderTop: '1px solid var(--color-border-subtle)',
        margin: 'var(--space-4) 0',
        ...style,
      }}
    />
  )
}

/**
 * Card.Section — a labelled block inside a Card. Used mostly for the
 * deal/request/task detail sidebar pattern: one outer Card, many Sections
 * each with a small uppercase label and a divider between them.
 */
function CardSection({
  label,
  children,
  className,
  style,
  last = false,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { label?: React.ReactNode; last?: boolean }) {
  return (
    <div
      {...rest}
      className={className}
      style={{
        padding: 'var(--space-4) 0',
        borderBottom: last ? 'none' : '1px solid var(--color-border-subtle)',
        ...style,
      }}
    >
      {label && (
        <div
          style={{
            fontSize: 'var(--text-xs)',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--color-text-subtle)',
            marginBottom: 'var(--space-2)',
          }}
        >
          {label}
        </div>
      )}
      {children}
    </div>
  )
}

// ── Compound export ─────────────────────────────────────────────────────────

export const Card = Object.assign(CardRoot, {
  Header: CardHeader,
  Title: CardTitle,
  Subtitle: CardSubtitle,
  Action: CardAction,
  Body: CardBody,
  Footer: CardFooter,
  Divider: CardDivider,
  Section: CardSection,
})
