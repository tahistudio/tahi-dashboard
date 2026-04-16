'use client'

import { useState, useEffect, useCallback } from 'react'
import { X, ChevronRight, ChevronLeft } from 'lucide-react'

const BRAND = 'var(--color-brand)'

interface TourStep {
  target: string
  title: string
  description: string
  position?: 'top' | 'bottom' | 'left' | 'right'
}

const ADMIN_STEPS: TourStep[] = [
  {
    target: '[data-tour="overview-kpis"]',
    title: 'Welcome to your dashboard',
    description: 'Here you can see key metrics at a glance: active clients, open requests, and outstanding invoices.',
    position: 'bottom',
  },
  {
    target: '[data-tour="nav-requests"]',
    title: 'Create and manage requests',
    description: 'View all requests, switch between list and board views, and create new ones for your clients.',
    position: 'right',
  },
  {
    target: '[data-tour="nav-clients"]',
    title: 'Track all your clients',
    description: 'See client health, plan details, contacts, and manage their entire relationship from one place.',
    position: 'right',
  },
  {
    target: '[data-tour="nav-invoices"]',
    title: 'Manage invoices and billing',
    description: 'Create invoices, track payments, and sync with Stripe and Xero for automated billing.',
    position: 'right',
  },
  {
    target: '[data-tour="nav-messages"]',
    title: 'Message your clients',
    description: 'Communicate directly with clients. All messages are tied to their org for easy context.',
    position: 'right',
  },
]

const CLIENT_STEPS: TourStep[] = [
  {
    target: '[data-tour="overview-kpis"]',
    title: 'Welcome to your portal',
    description: 'Track your active requests, see updates, and manage your account all from here.',
    position: 'bottom',
  },
  {
    target: '[data-tour="nav-requests"]',
    title: 'Submit and track requests',
    description: 'Submit new design or development requests and track their progress in real time.',
    position: 'right',
  },
  {
    target: '[data-tour="nav-messages"]',
    title: 'Chat with your team',
    description: 'Send messages, share files, and get updates on your requests.',
    position: 'right',
  },
]

interface ProductTourProps {
  isAdmin: boolean
}

export function ProductTour({ isAdmin }: ProductTourProps) {
  const [active, setActive] = useState(false)
  const [step, setStep] = useState(0)
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 })

  const steps = isAdmin ? ADMIN_STEPS : CLIENT_STEPS

  useEffect(() => {
    if (typeof window === 'undefined') return
    const completed = localStorage.getItem('tahi-tour-complete')
    const seen = localStorage.getItem('tahi-tour-seen')
    if (!completed && !seen) {
      localStorage.setItem('tahi-tour-seen', '1')
      // Delay to let the page render
      const timer = setTimeout(() => setActive(true), 1500)
      return () => clearTimeout(timer)
    }
  }, [])

  const positionTooltip = useCallback(() => {
    if (!active || step >= steps.length) return
    const el = document.querySelector(steps[step].target)
    if (!el) return
    const rect = el.getBoundingClientRect()
    const pos = steps[step].position ?? 'bottom'
    const tooltipW = 320
    const tooltipH = 160
    let top = 0
    let left = 0

    switch (pos) {
      case 'bottom':
        top = rect.bottom + 12
        left = rect.left + rect.width / 2 - tooltipW / 2
        break
      case 'top':
        top = rect.top - tooltipH - 12
        left = rect.left + rect.width / 2 - tooltipW / 2
        break
      case 'right':
        top = rect.top + rect.height / 2 - tooltipH / 2
        left = rect.right + 12
        break
      case 'left':
        top = rect.top + rect.height / 2 - tooltipH / 2
        left = rect.left - tooltipW - 12
        break
    }

    // Clamp to viewport
    left = Math.max(12, Math.min(left, window.innerWidth - tooltipW - 12))
    top = Math.max(12, Math.min(top, window.innerHeight - tooltipH - 12))

    setTooltipPos({ top, left })
  }, [active, step, steps])

  useEffect(() => {
    positionTooltip()
    window.addEventListener('resize', positionTooltip)
    return () => window.removeEventListener('resize', positionTooltip)
  }, [positionTooltip])

  // Add highlight to current target
  useEffect(() => {
    if (!active || step >= steps.length) return
    const el = document.querySelector(steps[step].target) as HTMLElement | null
    if (!el) return
    el.style.position = 'relative'
    el.style.zIndex = '10001'
    el.style.boxShadow = `0 0 0 4px ${BRAND}40, 0 0 24px ${BRAND}20`
    el.style.borderRadius = '0.5rem'
    el.style.transition = 'box-shadow 0.3s'
    return () => {
      el.style.zIndex = ''
      el.style.boxShadow = ''
      el.style.borderRadius = ''
      el.style.transition = ''
    }
  }, [active, step, steps])

  function close() {
    setActive(false)
    localStorage.setItem('tahi-tour-complete', '1')
  }

  function next() {
    if (step >= steps.length - 1) {
      close()
    } else {
      setStep(s => s + 1)
    }
  }

  function prev() {
    if (step > 0) setStep(s => s - 1)
  }

  if (!active || step >= steps.length) return null

  const currentStep = steps[step]

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={close}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.3)',
          zIndex: 10000,
        }}
      />

      {/* Tooltip */}
      <div
        style={{
          position: 'fixed',
          top: tooltipPos.top,
          left: tooltipPos.left,
          width: '20rem',
          zIndex: 10002,
          background: 'var(--color-bg)',
          border: '1px solid var(--color-border)',
          borderRadius: '0.75rem',
          boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
          padding: '1.25rem',
        }}
      >
        <div className="flex items-start justify-between" style={{ marginBottom: '0.5rem' }}>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            {currentStep.title}
          </h3>
          <button
            onClick={close}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-text-subtle)',
              padding: '0.125rem',
              display: 'flex',
            }}
            aria-label="Close tour"
          >
            <X size={14} />
          </button>
        </div>
        <p className="text-xs" style={{ color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
          {currentStep.description}
        </p>
        <div className="flex items-center justify-between" style={{ marginTop: '1rem' }}>
          <span className="text-xs" style={{ color: 'var(--color-text-subtle)' }}>
            {step + 1} of {steps.length}
          </span>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                onClick={prev}
                className="flex items-center gap-1 text-xs font-medium transition-opacity hover:opacity-80"
                style={{
                  padding: '0.375rem 0.625rem',
                  background: 'var(--color-bg-tertiary)',
                  color: 'var(--color-text)',
                  border: 'none',
                  borderRadius: '0.375rem',
                  cursor: 'pointer',
                }}
              >
                <ChevronLeft size={12} />
                Back
              </button>
            )}
            <button
              onClick={next}
              className="flex items-center gap-1 text-xs font-semibold transition-opacity hover:opacity-80"
              style={{
                padding: '0.375rem 0.75rem',
                background: BRAND,
                color: 'white',
                border: 'none',
                borderRadius: '0.375rem',
                cursor: 'pointer',
              }}
            >
              {step === steps.length - 1 ? 'Finish' : 'Next'}
              {step < steps.length - 1 && <ChevronRight size={12} />}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

/** Button to restart the product tour from settings or nav */
export function StartTourButton({ isAdmin }: { isAdmin: boolean }) {
  const [showTour, setShowTour] = useState(false)

  function startTour() {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('tahi-tour-complete')
      localStorage.removeItem('tahi-tour-seen')
    }
    setShowTour(true)
  }

  return (
    <>
      <button
        onClick={startTour}
        className="flex items-center gap-2 text-sm font-medium transition-opacity hover:opacity-80"
        style={{
          padding: '0.5rem 0.875rem',
          background: 'var(--color-bg)',
          border: '1px solid var(--color-border)',
          borderRadius: '0.5rem',
          cursor: 'pointer',
          color: 'var(--color-text)',
        }}
      >
        Take a tour
      </button>
      {showTour && <ProductTour isAdmin={isAdmin} />}
    </>
  )
}
