'use client'

/**
 * <Callout>. Static banner used inline on a page to surface a piece
 * of contextual information (a "heads up", a tip, a warning) without
 * blocking interaction. Different from a toast, which is transient.
 *
 *   <Callout tone="info" title="New schedule template">
 *     Pick from the templates library to start a project faster.
 *   </Callout>
 *
 *   <Callout
 *     tone="warning"
 *     title="Retainer hours nearly out"
 *     action={{ label: 'Review usage', onClick: () => router.push('/billing') }}
 *     dismissible
 *     onDismiss={() => setOpen(false)}
 *   >
 *     Physitrack has used 38 of 40 retainer hours this month.
 *   </Callout>
 *
 * Tones:
 *   info     soft blue, sparkles icon
 *   success  soft green, check icon
 *   warning  soft amber, alert-triangle icon
 *   danger   soft red, alert-octagon icon
 *   neutral  bg-secondary, info icon
 *
 * Variants:
 *   subtle  (default) - tinted bg + tone-tinted left edge accent
 *   solid             - filled tone bg, white text
 */

import * as React from 'react'
import { Info, CheckCircle2, AlertTriangle, AlertOctagon, X, Sparkles } from 'lucide-react'

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
  /** Trailing action button. */
  action?: CalloutAction
  /** Hide the leading icon. Default false. */
  hideIcon?: boolean
  /** Override the default icon for the tone. */
  icon?: React.ReactNode
  /** Show an X close button. */
  dismissible?: boolean
  onDismiss?: () => void
  /** Visual variant. Default 'subtle'. */
  variant?: 'subtle' | 'solid'
  className?: string
}

interface ToneDef {
  bg: string
  border: string
  textTitle: string
  textBody: string
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean }>
  iconColour: string
  /** Solid-variant overrides. */
  solid: { bg: string; text: string }
}

const TONES: Record<CalloutTone, ToneDef> = {
  info: {
    bg: 'rgba(96, 165, 250, 0.10)',
    border: 'rgba(96, 165, 250, 0.30)',
    textTitle: 'var(--color-text)',
    textBody: 'var(--color-text-muted)',
    icon: Info,
    iconColour: '#3b82f6',
    solid: { bg: '#3b82f6', text: '#ffffff' },
  },
  tip: {
    bg: 'rgba(167, 139, 250, 0.10)',
    border: 'rgba(167, 139, 250, 0.30)',
    textTitle: 'var(--color-text)',
    textBody: 'var(--color-text-muted)',
    icon: Sparkles,
    iconColour: '#7c3aed',
    solid: { bg: '#7c3aed', text: '#ffffff' },
  },
  success: {
    bg: 'var(--color-success-bg, rgba(34, 197, 94, 0.10))',
    border: 'rgba(34, 197, 94, 0.30)',
    textTitle: 'var(--color-text)',
    textBody: 'var(--color-text-muted)',
    icon: CheckCircle2,
    iconColour: 'var(--color-brand)',
    solid: { bg: 'var(--color-brand)', text: '#ffffff' },
  },
  warning: {
    bg: 'rgba(245, 158, 11, 0.10)',
    border: 'rgba(245, 158, 11, 0.30)',
    textTitle: 'var(--color-text)',
    textBody: 'var(--color-text-muted)',
    icon: AlertTriangle,
    iconColour: '#d97706',
    solid: { bg: '#d97706', text: '#ffffff' },
  },
  danger: {
    bg: 'rgba(220, 38, 38, 0.10)',
    border: 'rgba(220, 38, 38, 0.30)',
    textTitle: 'var(--color-text)',
    textBody: 'var(--color-text-muted)',
    icon: AlertOctagon,
    iconColour: 'var(--color-danger)',
    solid: { bg: 'var(--color-danger)', text: '#ffffff' },
  },
  neutral: {
    bg: 'var(--color-bg-secondary)',
    border: 'var(--color-border-subtle)',
    textTitle: 'var(--color-text)',
    textBody: 'var(--color-text-muted)',
    icon: Info,
    iconColour: 'var(--color-text-muted)',
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
  const bodyColour = isSolid ? 'rgba(255, 255, 255, 0.88)' : t.textBody
  const iconColour = isSolid ? '#ffffff' : t.iconColour
  const borderColour = isSolid ? t.solid.bg : t.border

  return (
    <div
      role="status"
      className={className}
      style={{
        display: 'flex',
        gap: '0.75rem',
        padding: '0.875rem 1rem',
        background: bg,
        border: `1px solid ${borderColour}`,
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
            paddingTop: title ? '0.0625rem' : 0,
          }}
        >
          {icon ?? <Icon size={16} strokeWidth={2} aria-hidden={true} />}
        </span>
      )}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
        {title && (
          <div
            style={{
              fontSize: 'var(--text-sm)',
              fontWeight: 600,
              color: titleColour,
              lineHeight: 1.4,
            }}
          >
            {title}
          </div>
        )}
        {children && (
          <div
            style={{
              fontSize: title ? 'var(--text-xs)' : 'var(--text-sm)',
              color: bodyColour,
              lineHeight: 1.5,
            }}
          >
            {children}
          </div>
        )}
      </div>
      {(action || dismissible) && (
        <div style={{ display: 'flex', gap: '0.25rem', flexShrink: 0, alignItems: 'center' }}>
          {action && (
            action.href
              ? (
                <a
                  href={action.href}
                  onClick={action.onClick}
                  style={calloutActionStyle(isSolid)}
                  onMouseEnter={onCalloutActionEnter(isSolid)}
                  onMouseLeave={onCalloutActionLeave(isSolid)}
                >
                  {action.label}
                </a>
              )
              : (
                <button
                  type="button"
                  onClick={action.onClick}
                  style={calloutActionStyle(isSolid)}
                  onMouseEnter={onCalloutActionEnter(isSolid)}
                  onMouseLeave={onCalloutActionLeave(isSolid)}
                >
                  {action.label}
                </button>
              )
          )}
          {dismissible && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss"
              style={{
                background: 'transparent',
                border: 'none',
                padding: '0.25rem',
                cursor: 'pointer',
                color: isSolid ? 'rgba(255,255,255,0.7)' : 'var(--color-text-subtle)',
                borderRadius: 'var(--radius-sm)',
                transition: 'background-color 150ms ease, color 150ms ease',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = isSolid
                  ? 'rgba(255,255,255,0.15)'
                  : 'var(--color-bg-tertiary)'
                e.currentTarget.style.color = isSolid ? '#ffffff' : 'var(--color-text)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = isSolid
                  ? 'rgba(255,255,255,0.7)'
                  : 'var(--color-text-subtle)'
              }}
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function calloutActionStyle(isSolid: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.3125rem',
    padding: '0.3125rem 0.625rem',
    borderRadius: 'var(--radius-sm)',
    fontSize: 'var(--text-xs)',
    fontWeight: 600,
    cursor: 'pointer',
    background: isSolid ? 'rgba(255, 255, 255, 0.16)' : 'var(--color-bg)',
    border: isSolid ? '1px solid rgba(255, 255, 255, 0.32)' : '1px solid var(--color-border-subtle)',
    color: isSolid ? '#ffffff' : 'var(--color-text)',
    textDecoration: 'none',
    transition: 'background-color 150ms ease, border-color 150ms ease',
    whiteSpace: 'nowrap',
  }
}

function onCalloutActionEnter(isSolid: boolean) {
  return (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.background = isSolid
      ? 'rgba(255, 255, 255, 0.26)'
      : 'var(--color-bg-secondary)'
  }
}
function onCalloutActionLeave(isSolid: boolean) {
  return (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.background = isSolid
      ? 'rgba(255, 255, 255, 0.16)'
      : 'var(--color-bg)'
  }
}
