'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  CheckCircle2, Circle, ArrowRight, Video, Upload,
  FileText, CreditCard, Users, PartyPopper, ChevronDown,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OnboardingState {
  welcomeVideoWatched: boolean
  brandAssetsUploaded: boolean
  firstRequestSubmitted: boolean
  billingSetUp: boolean
  meetTheTeam: boolean
}

export interface OnboardingChecklistProps {
  state: OnboardingState
  loomUrl: string | null
  onToggleStep?: (step: keyof OnboardingState, completed: boolean) => void
  onDismiss?: () => void
}

// ─── Step config ──────────────────────────────────────────────────────────────

interface StepConfig {
  key: keyof OnboardingState
  title: string
  description: string
  ctaLabel: string
  href: string
  icon: React.ReactNode
}

const STEPS: StepConfig[] = [
  {
    key: 'welcomeVideoWatched',
    title: 'Watch the welcome video',
    description: 'A quick intro from the Tahi team to walk you through the dashboard and how we work together.',
    ctaLabel: 'Watch video',
    href: '#loom',
    icon: <Video size={16} />,
  },
  {
    key: 'brandAssetsUploaded',
    title: 'Upload brand assets',
    description: 'Logos, fonts, colour palettes, and brand guidelines help us deliver on-brand work from day one.',
    ctaLabel: 'Upload assets',
    href: '/files',
    icon: <Upload size={16} />,
  },
  {
    key: 'firstRequestSubmitted',
    title: 'Submit your first request',
    description: 'Tell us what you need and the team will get started right away.',
    ctaLabel: 'Submit request',
    href: '/requests?new=1',
    icon: <FileText size={16} />,
  },
  {
    key: 'billingSetUp',
    title: 'Set up billing',
    description: 'Connect your payment method so invoices are handled automatically.',
    ctaLabel: 'Set up billing',
    href: '/settings',
    icon: <CreditCard size={16} />,
  },
  {
    key: 'meetTheTeam',
    title: 'Meet the team',
    description: 'Schedule a quick kickoff call so we can align on goals and get to know each other.',
    ctaLabel: 'Schedule call',
    href: '/calls',
    icon: <Users size={16} />,
  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toLoomEmbedUrl(url: string): string {
  const shareMatch = url.match(/loom\.com\/share\/([a-zA-Z0-9]+)/)
  if (shareMatch) {
    return `https://www.loom.com/embed/${shareMatch[1]}`
  }
  if (url.includes('loom.com/embed/')) {
    return url
  }
  return url
}

// ─── Component ────────────────────────────────────────────────────────────────

export function OnboardingChecklist({ state, loomUrl, onToggleStep, onDismiss }: OnboardingChecklistProps) {
  const [expandedStep, setExpandedStep] = useState<keyof OnboardingState | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  const completedCount = STEPS.filter(s => state[s.key]).length
  const totalSteps = STEPS.length
  const allComplete = completedCount === totalSteps
  const pct = Math.round((completedCount / totalSteps) * 100)

  // Find the first incomplete step (the "current" step)
  const currentStepKey = STEPS.find(s => !state[s.key])?.key ?? null

  if (dismissed) return null

  function handleDismiss() {
    if (onDismiss) onDismiss()
    setDismissed(true)
  }

  function handleToggle(key: keyof OnboardingState) {
    if (onToggleStep) {
      onToggleStep(key, !state[key])
    }
  }

  // All complete state
  if (allComplete && collapsed) return null

  if (allComplete) {
    return (
      <div
        className="rounded-xl"
        style={{
          background: 'var(--color-bg)',
          border: '1px solid var(--color-border)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          overflow: 'hidden',
        }}
      >
        <div className="flex flex-col items-center text-center" style={{ padding: '2rem 1.5rem' }}>
          <div
            style={{
              width: '3.5rem',
              height: '3.5rem',
              borderRadius: 'var(--radius-leaf)',
              background: 'var(--color-brand-50)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '0.75rem',
            }}
          >
            <PartyPopper size={24} style={{ color: 'var(--color-brand)' }} />
          </div>
          <h2 className="text-base font-bold" style={{ color: 'var(--color-text)' }}>
            Onboarding complete!
          </h2>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginTop: '0.25rem', maxWidth: '20rem' }}>
            You are all set. Your team at Tahi is ready to start delivering.
          </p>
          <button
            onClick={() => setCollapsed(true)}
            className="text-xs font-medium transition-opacity hover:opacity-80"
            style={{
              marginTop: '1rem',
              padding: '0.375rem 0.75rem',
              background: 'var(--color-bg-tertiary)',
              color: 'var(--color-text-muted)',
              border: 'none',
              borderRadius: '0.375rem',
              cursor: 'pointer',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-border)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-bg-tertiary)' }}
          >
            Dismiss
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className="rounded-xl"
      style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        overflow: 'hidden',
      }}
    >
      {/* Header with progress */}
      <div
        className="flex items-center justify-between"
        style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--color-border-subtle)' }}
      >
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
              Getting Started
            </h2>
            <span
              className="text-xs font-semibold"
              style={{
                padding: '0.0625rem 0.4375rem',
                borderRadius: '1rem',
                background: 'var(--color-brand-50)',
                color: 'var(--color-brand)',
              }}
            >
              {completedCount}/{totalSteps}
            </span>
          </div>
          <p className="text-xs" style={{ color: 'var(--color-text-subtle)', marginTop: '0.125rem' }}>
            {completedCount} of {totalSteps} steps complete
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Progress bar */}
          <div
            style={{
              width: '5rem',
              height: '0.375rem',
              background: 'var(--color-bg-tertiary)',
              borderRadius: '0.1875rem',
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: '100%',
                background: 'var(--color-brand)',
                borderRadius: '0.1875rem',
                transition: 'width 0.3s ease',
              }}
            />
          </div>
          <button
            onClick={handleDismiss}
            className="text-xs transition-colors"
            style={{
              color: 'var(--color-text-subtle)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '0.125rem',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-text)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-subtle)' }}
            aria-label="Skip onboarding"
          >
            Skip
          </button>
        </div>
      </div>

      {/* Loom embed when step 1 is expanded and loomUrl exists */}
      {loomUrl && expandedStep === 'welcomeVideoWatched' && (
        <div style={{ padding: '0.75rem 1.25rem', borderBottom: '1px solid var(--color-border-subtle)' }}>
          <div
            style={{
              position: 'relative',
              paddingBottom: '56.25%',
              height: 0,
              overflow: 'hidden',
              borderRadius: '0.5rem',
            }}
          >
            <iframe
              src={toLoomEmbedUrl(loomUrl)}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                border: 'none',
              }}
              allowFullScreen
              title="Onboarding video"
            />
          </div>
        </div>
      )}

      {/* Steps */}
      <div>
        {STEPS.map((step, i) => {
          const isComplete = state[step.key]
          const isCurrent = step.key === currentStepKey
          const isExpanded = expandedStep === step.key

          return (
            <div
              key={step.key}
              style={{
                borderBottom: i < STEPS.length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
                background: isCurrent && !isComplete ? 'var(--color-brand-50)' : 'transparent',
                transition: 'background 0.2s ease',
              }}
            >
              {/* Step row */}
              <div
                className="flex items-center gap-3"
                style={{ padding: '0.75rem 1.25rem', cursor: isComplete ? 'default' : 'pointer' }}
                onClick={() => {
                  if (!isComplete) setExpandedStep(isExpanded ? null : step.key)
                }}
              >
                {/* Step number / check */}
                <button
                  onClick={(e) => { e.stopPropagation(); handleToggle(step.key) }}
                  className="flex-shrink-0 transition-colors"
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '1.5rem',
                    height: '1.5rem',
                    minHeight: '2.75rem',
                    minWidth: '2.75rem',
                  }}
                  aria-label={isComplete ? `Mark "${step.title}" as incomplete` : `Mark "${step.title}" as complete`}
                >
                  {isComplete ? (
                    <CheckCircle2 size={20} style={{ color: 'var(--color-brand)' }} />
                  ) : isCurrent ? (
                    <div
                      style={{
                        width: '1.25rem',
                        height: '1.25rem',
                        borderRadius: '50%',
                        border: '2px solid var(--color-brand)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.625rem',
                        fontWeight: 700,
                        color: 'var(--color-brand)',
                      }}
                    >
                      {i + 1}
                    </div>
                  ) : (
                    <Circle size={20} style={{ color: 'var(--color-text-subtle)' }} />
                  )}
                </button>

                {/* Step icon + title */}
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span
                    style={{
                      color: isComplete ? 'var(--color-text-subtle)' : isCurrent ? 'var(--color-brand)' : 'var(--color-text-muted)',
                      display: 'flex',
                      alignItems: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {step.icon}
                  </span>
                  <span
                    className="text-sm font-medium"
                    style={{
                      color: isComplete ? 'var(--color-text-subtle)' : 'var(--color-text)',
                      textDecoration: isComplete ? 'line-through' : 'none',
                    }}
                  >
                    {step.title}
                  </span>
                </div>

                {/* Expand arrow */}
                {!isComplete && (
                  <ChevronDown
                    size={14}
                    style={{
                      color: 'var(--color-text-subtle)',
                      flexShrink: 0,
                      transform: isExpanded ? 'rotate(180deg)' : 'none',
                      transition: 'transform 0.2s ease',
                    }}
                  />
                )}
              </div>

              {/* Expanded detail */}
              {isExpanded && !isComplete && (
                <div style={{ padding: '0 1.25rem 1rem 4.5rem' }}>
                  <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginBottom: '0.75rem', lineHeight: 1.5 }}>
                    {step.description}
                  </p>
                  {step.href === '#loom' && loomUrl ? (
                    <button
                      onClick={() => handleToggle(step.key)}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold transition-opacity hover:opacity-80"
                      style={{
                        padding: '0.4375rem 0.875rem',
                        background: 'var(--color-brand)',
                        color: 'white',
                        borderRadius: '0.5rem',
                        border: 'none',
                        cursor: 'pointer',
                        minHeight: '2.25rem',
                      }}
                    >
                      {step.ctaLabel}
                      <ArrowRight size={12} />
                    </button>
                  ) : (
                    <Link
                      href={step.href}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold transition-opacity hover:opacity-80"
                      style={{
                        padding: '0.4375rem 0.875rem',
                        background: 'var(--color-brand)',
                        color: 'white',
                        borderRadius: '0.5rem',
                        textDecoration: 'none',
                        minHeight: '2.25rem',
                      }}
                    >
                      {step.ctaLabel}
                      <ArrowRight size={12} />
                    </Link>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
