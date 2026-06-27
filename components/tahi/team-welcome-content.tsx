'use client'

/**
 * Team "Welcome to Tahi" flow. A warm hello for a new teammate whose contract
 * is already signed and whose payroll is already set up in Xero (see
 * SPECS/redesign/03-team-onboarding.md). Deliberately NOT an HR wizard: it
 * captures only non-sensitive profile bits and shows a warm day-one picture.
 *
 *   Welcome (role / start / buddy / gear preview)  ->  About you (photo,
 *   preferred name, pronouns, timezone)  ->  routes into the dashboard.
 *
 * The final cream "Ready for day one" screen from the design is intentionally
 * omitted here; that content folds into the first home/tour feature. On finish
 * we call onComplete (the page routes to /overview).
 *
 * Entry context (who this is, their buddy, start date, gear) is resolved from
 * the teammate invite link and passed in as props. See lib/onboarding-entry.ts.
 */

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  SceneShell,
  ScenePill,
  Ledger,
  Stepper,
  useGrow,
  TimezoneField,
  PhotoField,
  Check,
  ONBOARDING_CSS,
  type LedgerStep,
} from '@/components/tahi/onboarding-shell'

export interface TeamHire {
  first: string
  initials: string
  role: string
  /** "Monday 13 July" */
  start: string
  /** "Mon 13 Jul" */
  startShort: string
  /** "MacBook Pro 16" */
  gear: string
}
export interface TeamBuddy {
  first: string
  name: string
  initials: string
  img?: string
}

const STEPS: LedgerStep[] = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'profile', label: 'About you' },
]

function Laptop() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M2 20h20" />
    </svg>
  )
}

function GearPreview({ hire }: { hire: TeamHire }) {
  return (
    <div className="ob-gear">
      <span className="ob-gear-ic"><Laptop /></span>
      <div className="ob-gear-t">
        <b>Your {hire.gear} is on the way</b>
        <small>Set up and shipped, with a Studio Display and the desk kit. Arriving before {hire.startShort}.</small>
      </div>
      <span className="ob-pill info">On its way</span>
    </div>
  )
}

export function TeamWelcomeContent({
  hire,
  buddy,
  redirectTo,
}: {
  hire: TeamHire
  buddy: TeamBuddy
  redirectTo: string
}) {
  const router = useRouter()
  const onComplete = () => {
    // Best-effort: mark onboarding done so re-entry skips to the dashboard.
    fetch('/api/onboarding/complete', { method: 'POST' }).catch(() => {})
    router.push(redirectTo)
  }
  const [idx, setIdx] = React.useState(0)
  const [dir, setDir] = React.useState(1)
  const [photo, setPhoto] = React.useState<string | null>(null)

  const stepId = STEPS[idx].id
  const [growWrap, growInner] = useGrow(stepId)

  const next = () => {
    setDir(1)
    if (idx >= STEPS.length - 1) onComplete()
    else setIdx(idx + 1)
  }
  const back = () => { setDir(-1); setIdx(Math.max(0, idx - 1)) }

  let title = '', sub = '', primary = 'Continue'
  let body: React.ReactNode = null

  if (stepId === 'welcome') {
    title = `Welcome to Tahi, ${hire.first}.`
    sub = `We're so glad you're here. Everything's sorted, this is just a warm hello before you start on ${hire.start}.`
    primary = 'Say hello back'
    body = (
      <>
        <div className="ob-summary" style={{ marginBottom: '14px' }}>
          <div className="ob-srow">Role <b>{hire.role}</b></div>
          <div className="ob-srow">First day <b>{hire.startShort}</b></div>
          <div className="ob-srow total">Your buddy <b>{buddy.name}</b></div>
        </div>
        <GearPreview hire={hire} />
      </>
    )
  } else {
    title = 'A little about you.'
    sub = 'Just the bits that help us welcome you properly. Nothing else needed, the rest is already handled.'
    primary = "That's me"
    body = (
      <>
        <PhotoField photo={photo} setPhoto={setPhoto} fallback={hire.initials} />
        <div className="ob-row2 ob-field">
          <div>
            <label className="ob-label">Preferred name</label>
            <input className="ob-input" defaultValue={hire.first} />
          </div>
          <div>
            <label className="ob-label">Pronouns <span style={{ color: '#9b9a94' }}>(optional)</span></label>
            <input className="ob-input" placeholder="she/her" />
          </div>
        </div>
        <TimezoneField />
      </>
    )
  }

  return (
    <div className="ob-stage">
      <style>{ONBOARDING_CSS}</style>
      <div className="ob-bg" />
      <div className="ob-frame">
        <div className="tahi-auth">
          <SceneShell>
            <ScenePill>Joining the studio</ScenePill>
            <h2 className="ta-headline">Welcome to Tahi. We&apos;ve been looking forward to this.</h2>
            <Ledger steps={STEPS} idx={idx} />
            <div className="ob-lead">
              <span className="ob-lead-av" aria-hidden="true">
                {buddy.img
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={buddy.img} alt="" />
                  : buddy.initials}
              </span>
              <span className="ob-lead-t">
                <b>{buddy.first} is your buddy.</b>
                <span>He&apos;ll meet you at 9:30 on day one.</span>
              </span>
            </div>
          </SceneShell>

          <main className="tahi-auth-form">
            <section className="tahi-auth-card">
              <Stepper steps={STEPS} idx={idx} />
              <div className="ob-grow" ref={growWrap}>
                <div className={cn('ob-body', dir > 0 ? 'ob-in-up' : 'ob-in-down')} key={stepId} ref={growInner}>
                  <h1 className="ob-h1">{title}</h1>
                  <p className="ob-sub">{sub}</p>
                  {body}
                </div>
              </div>
              <div className={cn('ob-footer', idx === 0 && 'end')}>
                {idx > 0 && <button className="ob-back" onClick={back}>Back</button>}
                <button className="ob-next" onClick={next}>
                  {primary}
                  {idx >= STEPS.length - 1 ? <Check size={16} /> : null}
                </button>
              </div>
            </section>
          </main>
        </div>
      </div>
    </div>
  )
}
