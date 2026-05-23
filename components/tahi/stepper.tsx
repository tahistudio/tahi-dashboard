'use client'

/**
 * <Stepper>. Horizontal multi-step indicator. Used for onboarding,
 * proposal builders, schedule templates, anything with a known set
 * of phases and a clear current step.
 *
 *   <Stepper
 *     steps={[
 *       { id: 'discovery', label: 'Discovery' },
 *       { id: 'design',    label: 'Design',  sub: 'Tahi' },
 *       { id: 'build',     label: 'Build' },
 *       { id: 'launch',    label: 'Launch' },
 *     ]}
 *     current="design"
 *     onStepClick={(id) => navigate(id)} // optional, enables back-nav
 *   />
 *
 *   - Steps before `current` render as done (filled brand circle + tick).
 *   - The `current` step renders highlighted with a brand ring.
 *   - Steps after `current` render as upcoming (muted outline).
 *   - Pass `onStepClick` to make completed steps clickable (back-nav).
 *     Upcoming steps stay inert.
 *
 * Compact variant: pass `size="sm"` for tighter footprints.
 */

import * as React from 'react'
import { Check } from 'lucide-react'

export interface StepperStep {
  id: string
  label: string
  /** Optional sub-label below the step name. */
  sub?: string
  /** Optional icon to replace the number/check inside the circle. */
  icon?: React.ReactNode
  /** Mark a step as having an error. Renders a red ring + label. */
  error?: boolean
}

interface StepperProps {
  steps: ReadonlyArray<StepperStep>
  current: string
  /** When set, completed steps fire this on click. Current + upcoming
   *  stay inert. */
  onStepClick?: (id: string) => void
  /** Stack steps vertically instead of horizontally. Default false. */
  vertical?: boolean
  size?: 'md' | 'sm'
  className?: string
  ariaLabel?: string
}

export function Stepper({
  steps,
  current,
  onStepClick,
  vertical = false,
  size = 'md',
  className,
  ariaLabel,
}: StepperProps) {
  const currentIndex = steps.findIndex(s => s.id === current)
  const circleSize = size === 'sm' ? '1.25rem' : '1.5rem'
  const numberFontSize = size === 'sm' ? '0.625rem' : '0.6875rem'
  const labelFontSize = size === 'sm' ? 'var(--text-xs)' : 'var(--text-sm)'

  if (vertical) {
    return (
      <ol
        className={className}
        aria-label={ariaLabel ?? 'Steps'}
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {steps.map((step, i) => {
          const state = stateFor(i, currentIndex, step.error)
          const clickable = !!onStepClick && (state === 'done' || state === 'current')
          const isLast = i === steps.length - 1
          return (
            <li
              key={step.id}
              style={{
                display: 'grid',
                gridTemplateColumns: `${circleSize} 1fr`,
                gap: '0.75rem',
                alignItems: 'start',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <StepCircle
                  state={state}
                  index={i}
                  icon={step.icon}
                  size={circleSize}
                  numberFontSize={numberFontSize}
                  clickable={clickable}
                  onClick={clickable ? () => onStepClick?.(step.id) : undefined}
                  ariaLabel={step.label}
                />
                {!isLast && (
                  <div
                    aria-hidden="true"
                    style={{
                      width: 1.5,
                      flex: 1,
                      minHeight: '1.5rem',
                      background: state === 'done'
                        ? 'var(--color-brand)'
                        : 'var(--color-border)',
                      opacity: state === 'done' ? 1 : 0.6,
                      transition: 'background-color 320ms ease, opacity 320ms ease',
                    }}
                  />
                )}
              </div>
              <div style={{ paddingBottom: isLast ? 0 : '1.25rem' }}>
                <StepLabel
                  step={step}
                  state={state}
                  labelFontSize={labelFontSize}
                  clickable={clickable}
                  onClick={clickable ? () => onStepClick?.(step.id) : undefined}
                />
              </div>
            </li>
          )
        })}
      </ol>
    )
  }

  // Horizontal layout.
  return (
    <ol
      className={className}
      aria-label={ariaLabel ?? 'Steps'}
      style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        display: 'flex',
        alignItems: 'flex-start',
        width: '100%',
      }}
    >
      {steps.map((step, i) => {
        const state = stateFor(i, currentIndex, step.error)
        const clickable = !!onStepClick && (state === 'done' || state === 'current')
        const isLast = i === steps.length - 1
        return (
          <li
            key={step.id}
            style={{
              flex: isLast ? 'none' : 1,
              display: 'flex',
              alignItems: 'flex-start',
              minWidth: 0,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 0 }}>
              <StepCircle
                state={state}
                index={i}
                icon={step.icon}
                size={circleSize}
                numberFontSize={numberFontSize}
                clickable={clickable}
                onClick={clickable ? () => onStepClick?.(step.id) : undefined}
                ariaLabel={step.label}
              />
              <div style={{ marginTop: '0.5rem', textAlign: 'center', minWidth: 0, maxWidth: '10rem' }}>
                <StepLabel
                  step={step}
                  state={state}
                  labelFontSize={labelFontSize}
                  clickable={clickable}
                  onClick={clickable ? () => onStepClick?.(step.id) : undefined}
                />
              </div>
            </div>
            {!isLast && (
              <div
                aria-hidden="true"
                style={{
                  flex: 1,
                  height: 1.5,
                  marginTop: `calc(${circleSize} / 2 - 1px)`,
                  marginLeft: '0.625rem',
                  marginRight: '0.625rem',
                  background: state === 'done'
                    ? 'var(--color-brand)'
                    : 'var(--color-border)',
                  opacity: state === 'done' ? 1 : 0.6,
                  transition: 'background-color 320ms ease, opacity 320ms ease',
                }}
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────────

type StepState = 'done' | 'current' | 'upcoming' | 'error'

function stateFor(i: number, currentIndex: number, error?: boolean): StepState {
  if (error) return 'error'
  if (currentIndex < 0) return 'upcoming'
  if (i < currentIndex) return 'done'
  if (i === currentIndex) return 'current'
  return 'upcoming'
}

function StepCircle({
  state,
  index,
  icon,
  size,
  numberFontSize,
  clickable,
  onClick,
  ariaLabel,
}: {
  state: StepState
  index: number
  icon?: React.ReactNode
  size: string
  numberFontSize: string
  clickable: boolean
  onClick?: () => void
  ariaLabel: string
}) {
  const isDone = state === 'done'
  const isCurrent = state === 'current'
  const isError = state === 'error'

  // Three clean states, no halo. Done = filled brand circle with a
  // check inside. Current = filled brand circle with a small white
  // INNER dot so it reads as "active, not yet complete". Upcoming =
  // neutral outline with the step number. Error = outlined danger.
  let bg = 'transparent'
  let border = '1.5px solid var(--color-border)'
  let textColour = 'var(--color-text-subtle)'

  if (isDone) {
    bg = 'var(--color-brand)'
    border = '1.5px solid var(--color-brand)'
    textColour = '#ffffff'
  } else if (isCurrent) {
    bg = 'var(--color-brand)'
    border = '1.5px solid var(--color-brand)'
    textColour = '#ffffff'
  } else if (isError) {
    bg = 'transparent'
    border = '1.5px solid var(--color-danger)'
    textColour = 'var(--color-danger)'
  }

  // Content. Current shows the inner dot, done shows the check,
  // upcoming + error show the index number (or a caller-supplied icon).
  let content: React.ReactNode
  if (isDone) {
    content = <Check size={11} strokeWidth={3} aria-hidden="true" />
  } else if (isCurrent) {
    content = (
      <span
        aria-hidden="true"
        style={{
          width: '0.375rem',
          height: '0.375rem',
          borderRadius: '50%',
          background: '#ffffff',
        }}
      />
    )
  } else if (icon) {
    content = icon
  } else {
    content = <span>{index + 1}</span>
  }

  const inner = (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        background: bg,
        border,
        color: textColour,
        fontSize: numberFontSize,
        fontWeight: 600,
        transition: 'background-color 220ms ease, border-color 220ms ease',
        flexShrink: 0,
      }}
    >
      {content}
    </span>
  )

  if (!clickable) return inner
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Go to ${ariaLabel}`}
      style={{
        background: 'transparent',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        display: 'inline-flex',
        borderRadius: '50%',
        transition: 'box-shadow 150ms ease',
      }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 0 0 3px var(--color-brand-100)' }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none' }}
      onFocus={e => { e.currentTarget.style.boxShadow = '0 0 0 3px var(--color-brand-100)' }}
      onBlur={e => { e.currentTarget.style.boxShadow = 'none' }}
    >
      {inner}
    </button>
  )
}

function StepLabel({
  step,
  state,
  labelFontSize,
  clickable,
  onClick,
}: {
  step: StepperStep
  state: StepState
  labelFontSize: string
  clickable: boolean
  onClick?: () => void
}) {
  const isDone = state === 'done'
  const isCurrent = state === 'current'
  const isError = state === 'error'
  const labelColour = isError
    ? 'var(--color-danger)'
    : isCurrent
      ? 'var(--color-text-active)'
      : isDone
        ? 'var(--color-text)'
        : 'var(--color-text-muted)'
  const subColour = 'var(--color-text-subtle)'

  const content = (
    <>
      <div
        style={{
          fontSize: labelFontSize,
          fontWeight: isCurrent || isError ? 600 : 500,
          color: labelColour,
          lineHeight: 1.3,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {step.label}
      </div>
      {step.sub && (
        <div
          style={{
            fontSize: '0.6875rem',
            color: subColour,
            marginTop: '0.125rem',
            lineHeight: 1.3,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {step.sub}
        </div>
      )}
    </>
  )

  if (!clickable) return <div>{content}</div>
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'transparent',
        border: 'none',
        padding: 0,
        margin: 0,
        textAlign: 'inherit',
        font: 'inherit',
        cursor: 'pointer',
        color: 'inherit',
        width: '100%',
      }}
    >
      {content}
    </button>
  )
}
