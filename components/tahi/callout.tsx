'use client'

/**
 * <Callout>. Quiet inline banner for contextual page-level info.
 *
 * When to use which surface:
 *   <Toast>             transient confirmation after a user action
 *                       ("Saved", "Couldn't start timer").
 *   <Callout>           static info that lives inside a page section
 *                       ("This client's retainer is almost out",
 *                        "Stripe is disconnected", a one-off tip).
 *   <AnnouncementBanner> admin-configured, full-width, persisted
 *                       dismissal. Top-of-app announcements only.
 *   <EmptyState>        when a list / section is empty.
 *
 * Example:
 *
 *   <Callout tone="warning" title="Retainer hours nearly out"
 *            action={{ label: 'Review usage', onClick }}>
 *     Physitrack has used 38 of 40 hours this month.
 *   </Callout>
 *
 * Look:
 *   - Borderless. The faint tone-tinted background carries the
 *     semantic colour without shouting.
 *   - 14px icon in the tone colour, no tile wrapper. Conversational.
 *   - Title in 13px medium; body in 12px muted. Same paragraph.
 *   - Action is a text link (with arrow) by default, or a chip button
 *     when emphasis is needed via variant="solid".
 */

import * as React from 'react'
import { Info, CheckCircle2, AlertTriangle, AlertOctagon, X, Sparkles, ArrowRight } from 'lucide-react'

export type CalloutTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral' | 'tip'

interface CalloutAction {
  label: string
  onClick?: () => void
  href?: string
}

interface CalloutProps {
  tone?: CalloutTone
  title?: React.ReactNode
  children?: React.ReactNode
  action?: CalloutAction
  hideIcon?: boolean
  icon?: React.ReactNode
  dismissible?: boolean
  onDismiss?: () => void
  /** Visual variant. Default 'subtle'. */
  variant?: 'subtle' | 'solid'
  className?: string
}

interface ToneDef {
  bg: string
  textTitle: string
  textBody: string
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean }>
  iconColour: string
  actionColour: string
  /** Solid-variant overrides. */
  solid: { bg: string; text: string }
}

// Backgrounds are very subtle (alpha 0.06-0.08) so the callout sits
// quietly on the page. Icon colour carries the tone signal.
const TONES: Record<CalloutTone, ToneDef> = {
  info: {
    bg: 'rgba(96, 165, 250, 0.07)',
    textTitle: 'var(--color-text)',
    textBody: 'var(--color-text-muted)',
    icon: Info,
    iconColour: '#3b82f6',
    actionColour: '#1d4ed8',
    solid: { bg: '#3b82f6', text: '#ffffff' },
  },
  tip: {
    // Brand-warm tip. Uses the brand palette directly instead of a
    // separate purple tone, so tips feel like a Tahi-flavoured note.
    bg: 'var(--color-brand-50, rgba(90, 130, 78, 0.07))',
    textTitle: 'var(--color-text)',
    textBody: 'var(--color-text-muted)',
    icon: Sparkles,
    iconColour: 'var(--color-brand)',
    actionColour: 'var(--color-brand-dark)',
    solid: { bg: 'var(--color-brand)', text: '#ffffff' },
  },
  success: {
    bg: 'var(--color-brand-50, rgba(34, 197, 94, 0.07))',
    textTitle: 'var(--color-text)',
    textBody: 'var(--color-text-muted)',
    icon: CheckCircle2,
    iconColour: 'var(--color-brand)',
    actionColour: 'var(--color-brand-dark)',
    solid: { bg: 'var(--color-brand)', text: '#ffffff' },
  },
  warning: {
    bg: 'rgba(245, 158, 11, 0.08)',
    textTitle: 'var(--color-text)',
    textBody: 'var(--color-text-muted)',
    icon: AlertTriangle,
    iconColour: '#d97706',
    actionColour: '#92400e',
    solid: { bg: '#d97706', text: '#ffffff' },
  },
  danger: {
    bg: 'rgba(220, 38, 38, 0.07)',
    textTitle: 'var(--color-text)',
    textBody: 'var(--color-text-muted)',
    icon: AlertOctagon,
    iconColour: 'var(--color-danger)',
    actionColour: 'var(--color-danger)',
    solid: { bg: 'var(--color-danger)', text: '#ffffff' },
  },
  neutral: {
    bg: 'var(--color-bg-secondary)',
    textTitle: 'var(--color-text)',
    textBody: 'var(--color-text-muted)',
    icon: Info,
    iconColour: 'var(--color-text-muted)',
    actionColour: 'var(--color-text)',
    solid: { bg: 'var(--color-text)', text: '#ffffff' },
  },
}

export function Callout({
  tone = 'info',
  title,
  children,
  action,
  hideIcon = false,
  icon,
  dismissible = false,
  onDismiss,
  variant = 'subtle',
  className,
}: CalloutProps) {
  const t = TONES[tone]
  const Icon = t.icon
  const isSolid = variant === 'solid'
  const bg = isSolid ? t.solid.bg : t.bg
  const titleColour = isSolid ? t.solid.text : t.textTitle
  const bodyColour = isSolid ? 'rgba(255, 255, 255, 0.85)' : t.textBody
  const iconColour = isSolid ? '#ffffff' : t.iconColour
  const actionColour = isSolid ? '#ffffff' : t.actionColour

  return (
    <div
      role="status"
      className={className}
      style={{
        display: 'flex',
        gap: '0.625rem',
        padding: '0.625rem 0.875rem',
        background: bg,
        borderRadius: 'var(--radius-md)',
        alignItems: 'flex-start',
      }}
    >
      {!hideIcon && (
        <span
          aria-hidden="true"
          style={{
            display: 'inline-flex',
            color: iconColour,
            flexShrink: 0,
            paddingTop: '0.0625rem',
          }}
        >
          {icon ?? <Icon size={14} strokeWidth={2} aria-hidden={true} />}
        </span>
      )}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '0.125rem',
          fontSize: 'var(--text-sm)',
          lineHeight: 1.45,
        }}
      >
        {title && (
          <span
            style={{
              fontWeight: 600,
              color: titleColour,
            }}
          >
            {title}
          </span>
        )}
        {children && (
          <span style={{ color: bodyColour }}>
            {children}
          </span>
        )}
        {action && !isSolid && (
          <CalloutTextLink
            action={action}
            colour={actionColour}
          />
        )}
      </div>
      {(action && isSolid) && (
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
          <CalloutSolidAction action={action} />
        </div>
      )}
      {dismissible && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          style={{
            background: 'transparent',
            border: 'none',
            padding: '0.1875rem',
            cursor: 'pointer',
            color: isSolid ? 'rgba(255,255,255,0.7)' : 'var(--color-text-subtle)',
            borderRadius: 'var(--radius-sm)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            marginTop: '-0.0625rem',
            transition: 'background-color 120ms ease, color 120ms ease',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = isSolid
              ? 'rgba(255,255,255,0.15)'
              : 'rgba(0, 0, 0, 0.04)'
            e.currentTarget.style.color = isSolid ? '#ffffff' : 'var(--color-text)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = isSolid
              ? 'rgba(255,255,255,0.7)'
              : 'var(--color-text-subtle)'
          }}
        >
          <X size={13} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

function CalloutTextLink({ action, colour }: { action: CalloutAction; colour: string }) {
  const baseStyle: React.CSSProperties = {
    alignSelf: 'flex-start',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.1875rem',
    marginTop: '0.1875rem',
    padding: 0,
    background: 'transparent',
    border: 'none',
    color: colour,
    fontSize: 'var(--text-xs)',
    fontWeight: 600,
    cursor: 'pointer',
    textDecoration: 'none',
    letterSpacing: '0.01em',
  }
  const content = (
    <>
      {action.label}
      <ArrowRight size={11} aria-hidden="true" style={{ transition: 'transform 150ms ease' }} />
    </>
  )
  const onEnter = (e: React.MouseEvent<HTMLElement>) => {
    const arrow = e.currentTarget.querySelector('svg')
    if (arrow) (arrow as SVGElement).style.transform = 'translateX(2px)'
  }
  const onLeave = (e: React.MouseEvent<HTMLElement>) => {
    const arrow = e.currentTarget.querySelector('svg')
    if (arrow) (arrow as SVGElement).style.transform = 'translateX(0)'
  }
  if (action.href) {
    return (
      <a href={action.href} style={baseStyle} onClick={action.onClick} onMouseEnter={onEnter} onMouseLeave={onLeave}>
        {content}
      </a>
    )
  }
  return (
    <button type="button" style={baseStyle} onClick={action.onClick} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      {content}
    </button>
  )
}

function CalloutSolidAction({ action }: { action: CalloutAction }) {
  const baseStyle: React.CSSProperties = {
    padding: '0.25rem 0.625rem',
    background: 'rgba(255, 255, 255, 0.18)',
    border: '1px solid rgba(255, 255, 255, 0.3)',
    borderRadius: 'var(--radius-sm)',
    color: '#ffffff',
    fontSize: 'var(--text-xs)',
    fontWeight: 600,
    cursor: 'pointer',
    textDecoration: 'none',
    whiteSpace: 'nowrap',
    transition: 'background-color 150ms ease',
  }
  const onEnter = (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.28)'
  }
  const onLeave = (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.18)'
  }
  if (action.href) {
    return (
      <a href={action.href} style={baseStyle} onClick={action.onClick} onMouseEnter={onEnter} onMouseLeave={onLeave}>
        {action.label}
      </a>
    )
  }
  return (
    <button type="button" style={baseStyle} onClick={action.onClick} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      {action.label}
    </button>
  )
}
