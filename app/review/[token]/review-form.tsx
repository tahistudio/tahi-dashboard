'use client'

import { useState, useEffect, useCallback } from 'react'
import { ArrowRight, ArrowLeft, Check, Loader2 } from 'lucide-react'

const BRAND = '#5A824E'

interface OrgInfo {
  orgId: string
  orgName: string
  submissionId: string
  projectName: string | null
  hasExistingReview: boolean
}

type Step = 'loading' | 'nps' | 'testimonial' | 'video' | 'case_study' | 'permissions' | 'done' | 'error' | 'already_done'

export function ReviewForm({ token }: { token: string }) {
  const [step, setStep] = useState<Step>('loading')
  const [orgInfo, setOrgInfo] = useState<OrgInfo | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  // Form state
  const [npsScore, setNpsScore] = useState<number | null>(null)
  const [testimonial, setTestimonial] = useState('')
  const [videoUrl, setVideoUrl] = useState('')
  const [caseStudyInterest, setCaseStudyInterest] = useState(false)
  const [logoPermission, setLogoPermission] = useState(false)
  const [marketingPermission, setMarketingPermission] = useState(false)

  const [submitting, setSubmitting] = useState(false)

  const fetchInfo = useCallback(async () => {
    try {
      const res = await fetch(`/api/public/review?token=${encodeURIComponent(token)}`)
      if (res.status === 409) {
        setStep('already_done')
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Invalid link' })) as { error?: string }
        setErrorMsg(data.error ?? 'This link is invalid or has expired.')
        setStep('error')
        return
      }
      const data = await res.json() as OrgInfo
      setOrgInfo(data)
      setStep('nps')
    } catch {
      setErrorMsg('Unable to load. Please check your connection and try again.')
      setStep('error')
    }
  }, [token])

  useEffect(() => { void fetchInfo() }, [fetchInfo])

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      const res = await fetch('/api/public/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          npsScore,
          writtenReview: testimonial || undefined,
          logoPermission,
          marketingPermission,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        setErrorMsg(data.error ?? 'Failed to submit. Please try again.')
        setStep('error')
        return
      }
      setStep('done')
    } catch {
      setErrorMsg('Network error. Please try again.')
      setStep('error')
    } finally {
      setSubmitting(false)
    }
  }

  const goNext = () => {
    const flow: Step[] = ['nps', 'testimonial', 'video', 'case_study', 'permissions']
    const idx = flow.indexOf(step)
    if (idx >= 0 && idx < flow.length - 1) {
      setStep(flow[idx + 1])
    }
  }

  const goBack = () => {
    const flow: Step[] = ['nps', 'testimonial', 'video', 'case_study', 'permissions']
    const idx = flow.indexOf(step)
    if (idx > 0) {
      setStep(flow[idx - 1])
    }
  }

  const stepIndex = ['nps', 'testimonial', 'video', 'case_study', 'permissions'].indexOf(step)
  const totalSteps = 5

  if (step === 'loading') {
    return (
      <PageShell>
        <div className="flex flex-col items-center gap-4" aria-live="polite">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: BRAND }} aria-hidden="true" />
          <p className="text-sm" style={{ color: '#5a6657' }}>Loading your review...</p>
        </div>
      </PageShell>
    )
  }

  if (step === 'error') {
    return (
      <PageShell>
        <div className="text-center">
          <h1 className="text-xl font-bold mb-2" style={{ color: '#121A0F' }}>Something went wrong</h1>
          <p className="text-sm" style={{ color: '#5a6657' }}>{errorMsg}</p>
        </div>
      </PageShell>
    )
  }

  if (step === 'already_done') {
    return (
      <PageShell>
        <div className="text-center">
          <div className="mx-auto mb-4 w-12 h-12 rounded-full flex items-center justify-center" style={{ background: '#d1fae5' }}>
            <Check className="w-6 h-6" style={{ color: '#059669' }} aria-hidden="true" />
          </div>
          <h1 className="text-xl font-bold mb-2" style={{ color: '#121A0F' }}>Already submitted</h1>
          <p className="text-sm" style={{ color: '#5a6657' }}>You have already submitted your review. Thank you!</p>
        </div>
      </PageShell>
    )
  }

  if (step === 'done') {
    return (
      <PageShell>
        <div className="text-center">
          <div className="mx-auto mb-4 w-12 h-12 rounded-full flex items-center justify-center" style={{ background: '#d1fae5' }}>
            <Check className="w-6 h-6" style={{ color: '#059669' }} aria-hidden="true" />
          </div>
          <h1 className="text-xl font-bold mb-2" style={{ color: '#121A0F' }}>Thank you!</h1>
          <p className="text-sm" style={{ color: '#5a6657' }}>
            Your feedback means a lot to us. We truly appreciate you taking the time to share your experience.
          </p>
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell>
      {/* Progress bar */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium" style={{ color: '#8a9987' }}>
            Step {stepIndex + 1} of {totalSteps}
          </p>
          <p className="text-xs" style={{ color: '#8a9987' }}>
            {orgInfo?.orgName}
          </p>
        </div>
        <div style={{ height: 4, background: '#eef3ec', borderRadius: 2 }}>
          <div
            style={{
              width: `${((stepIndex + 1) / totalSteps) * 100}%`,
              height: '100%',
              background: BRAND,
              borderRadius: 2,
              transition: 'width 0.3s',
            }}
          />
        </div>
      </div>

      {/* Step: NPS */}
      {step === 'nps' && (
        <div>
          <h2 className="text-lg font-bold mb-1" style={{ color: '#121A0F' }}>
            How likely are you to recommend Tahi Studio?
          </h2>
          <p className="text-sm mb-6" style={{ color: '#5a6657' }}>
            On a scale from 0 (not at all) to 10 (absolutely).
          </p>
          <div className="flex flex-wrap gap-2 mb-6 justify-center">
            {Array.from({ length: 11 }, (_, i) => (
              <button
                key={i}
                onClick={() => setNpsScore(i)}
                className="transition-all"
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 8,
                  border: npsScore === i ? `2px solid ${BRAND}` : '1px solid #d4e0d0',
                  background: npsScore === i ? '#f0f7ee' : '#ffffff',
                  color: npsScore === i ? BRAND : '#121A0F',
                  fontWeight: npsScore === i ? 700 : 500,
                  fontSize: '0.875rem',
                  cursor: 'pointer',
                }}
                aria-label={`Score ${i}`}
                aria-pressed={npsScore === i}
              >
                {i}
              </button>
            ))}
          </div>
          <div className="flex justify-between text-xs" style={{ color: '#8a9987' }}>
            <span>Not likely</span>
            <span>Very likely</span>
          </div>
        </div>
      )}

      {/* Step: Testimonial */}
      {step === 'testimonial' && (
        <div>
          <h2 className="text-lg font-bold mb-1" style={{ color: '#121A0F' }}>
            Share your experience
          </h2>
          <p className="text-sm mb-4" style={{ color: '#5a6657' }}>
            Tell us what you enjoyed most about working with Tahi Studio.
          </p>
          <textarea
            value={testimonial}
            onChange={e => setTestimonial(e.target.value)}
            rows={5}
            placeholder="Working with Tahi has been..."
            className="w-full text-sm transition-colors"
            style={{
              padding: '0.75rem 1rem',
              border: '1px solid #d4e0d0',
              borderRadius: 8,
              background: '#ffffff',
              color: '#121A0F',
              resize: 'vertical',
              outline: 'none',
            }}
            onFocus={e => { e.currentTarget.style.borderColor = BRAND }}
            onBlur={e => { e.currentTarget.style.borderColor = '#d4e0d0' }}
          />
        </div>
      )}

      {/* Step: Video */}
      {step === 'video' && (
        <div>
          <h2 className="text-lg font-bold mb-1" style={{ color: '#121A0F' }}>
            Video testimonial (optional)
          </h2>
          <p className="text-sm mb-4" style={{ color: '#5a6657' }}>
            If you have recorded a video, paste the link below. Loom, YouTube, or any public URL works.
          </p>
          <input
            type="url"
            value={videoUrl}
            onChange={e => setVideoUrl(e.target.value)}
            placeholder="https://www.loom.com/share/..."
            className="w-full text-sm"
            style={{
              padding: '0.625rem 1rem',
              border: '1px solid #d4e0d0',
              borderRadius: 8,
              background: '#ffffff',
              color: '#121A0F',
              outline: 'none',
            }}
            onFocus={e => { e.currentTarget.style.borderColor = BRAND }}
            onBlur={e => { e.currentTarget.style.borderColor = '#d4e0d0' }}
          />
        </div>
      )}

      {/* Step: Case study interest */}
      {step === 'case_study' && (
        <div>
          <h2 className="text-lg font-bold mb-1" style={{ color: '#121A0F' }}>
            Case study interest
          </h2>
          <p className="text-sm mb-6" style={{ color: '#5a6657' }}>
            Would you be open to us writing a case study about the work we did together?
            This helps future clients understand what working with us looks like.
          </p>
          <div className="flex gap-3">
            <ToggleCard
              selected={caseStudyInterest}
              onClick={() => setCaseStudyInterest(true)}
              label="Yes, sounds good"
            />
            <ToggleCard
              selected={!caseStudyInterest}
              onClick={() => setCaseStudyInterest(false)}
              label="No thanks"
            />
          </div>
        </div>
      )}

      {/* Step: Permissions */}
      {step === 'permissions' && (
        <div>
          <h2 className="text-lg font-bold mb-1" style={{ color: '#121A0F' }}>
            Permissions
          </h2>
          <p className="text-sm mb-6" style={{ color: '#5a6657' }}>
            Let us know how we can use your feedback.
          </p>
          <div className="space-y-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={logoPermission}
                onChange={e => setLogoPermission(e.target.checked)}
                className="mt-0.5"
                style={{ accentColor: BRAND, width: 18, height: 18 }}
              />
              <div>
                <p className="text-sm font-medium" style={{ color: '#121A0F' }}>Logo permission</p>
                <p className="text-xs" style={{ color: '#5a6657' }}>
                  We can display your company logo on our website and marketing materials.
                </p>
              </div>
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={marketingPermission}
                onChange={e => setMarketingPermission(e.target.checked)}
                className="mt-0.5"
                style={{ accentColor: BRAND, width: 18, height: 18 }}
              />
              <div>
                <p className="text-sm font-medium" style={{ color: '#121A0F' }}>Marketing permission</p>
                <p className="text-xs" style={{ color: '#5a6657' }}>
                  We can quote your testimonial on our website, social media, and in proposals.
                </p>
              </div>
            </label>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between mt-8">
        {stepIndex > 0 ? (
          <button
            onClick={goBack}
            className="flex items-center gap-1.5 text-sm font-medium transition-opacity hover:opacity-80"
            style={{
              padding: '0.5rem 1rem',
              background: 'transparent',
              border: '1px solid #d4e0d0',
              borderRadius: 8,
              color: '#5a6657',
              cursor: 'pointer',
            }}
          >
            <ArrowLeft size={14} aria-hidden="true" />
            Back
          </button>
        ) : (
          <div />
        )}
        {step === 'permissions' ? (
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex items-center gap-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{
              padding: '0.5rem 1.25rem',
              background: BRAND,
              border: 'none',
              borderRadius: '0 0.5rem 0 0.5rem',
              cursor: submitting ? 'not-allowed' : 'pointer',
              opacity: submitting ? 0.7 : 1,
              minHeight: 44,
            }}
          >
            {submitting ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
            {submitting ? 'Submitting...' : 'Submit Review'}
          </button>
        ) : (
          <button
            onClick={goNext}
            disabled={step === 'nps' && npsScore === null}
            className="flex items-center gap-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{
              padding: '0.5rem 1.25rem',
              background: BRAND,
              border: 'none',
              borderRadius: '0 0.5rem 0 0.5rem',
              cursor: (step === 'nps' && npsScore === null) ? 'not-allowed' : 'pointer',
              opacity: (step === 'nps' && npsScore === null) ? 0.5 : 1,
              minHeight: 44,
            }}
          >
            Next
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        )}
      </div>
    </PageShell>
  )
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: '#f5f7f5', padding: '1rem' }}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: 12,
          padding: '2rem',
          width: '100%',
          maxWidth: '32rem',
          boxShadow: '0 4px 6px -1px rgba(0,0,0,0.08)',
        }}
      >
        <div className="text-center mb-6">
          <p className="text-sm font-bold" style={{ color: BRAND }}>Tahi Studio</p>
        </div>
        {children}
      </div>
    </div>
  )
}

function ToggleCard({
  selected,
  onClick,
  label,
}: {
  selected: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className="flex-1 text-sm font-medium transition-all"
      style={{
        padding: '0.75rem 1rem',
        borderRadius: 8,
        border: selected ? `2px solid ${BRAND}` : '1px solid #d4e0d0',
        background: selected ? '#f0f7ee' : '#ffffff',
        color: selected ? BRAND : '#5a6657',
        cursor: 'pointer',
        minHeight: 44,
      }}
      aria-pressed={selected}
    >
      {label}
    </button>
  )
}
