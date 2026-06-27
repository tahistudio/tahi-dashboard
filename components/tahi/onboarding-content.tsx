'use client'

/**
 * Client onboarding flow (Studio Ledger). Driven entirely by the entry context
 * resolved from the person's link (see lib/onboarding-entry.ts), NOT by an
 * in-page persona switcher: the design's Tweaks panel and the duplicate
 * SelfServe component are preview-only and are dropped here.
 *
 * Paths:
 *   - new + self-serve -> chooser (retainer self-serve & paid | project enquiry
 *     -> proposal dead-end, project clients are invited to the platform later).
 *   - new + invited (project/contract attached) -> care-first, no payment.
 *   - existing client -> open a new project/retainer, no re-payment friction.
 *
 * Steps are assembled by buildSteps(). The final cream "portal" screens from the
 * design are omitted; on finish we call onComplete (the page routes into the
 * studio). Payment is simulated (doPay) with a clear seam for Stripe; invites
 * are local with a seam for persistence.
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
  Check,
  ONBOARDING_CSS,
  type LedgerStep,
} from '@/components/tahi/onboarding-shell'
import { OnboardingPayment } from '@/components/tahi/onboarding-payment'
import type { ClientEntry } from '@/lib/onboarding-entry'

export interface OnboardingLead {
  name: string
  first: string
  role: string
  initials: string
  img?: string
}

// ── icons (flow-specific) ──────────────────────────────────────────────
function I({ size, children }: { size?: number; children: React.ReactNode }) {
  const s = size || 16
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  )
}
const PlayFill = ({ size }: { size?: number }) => (
  <svg width={size || 14} height={size || 14} viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
)
const PauseFill = ({ size }: { size?: number }) => (
  <svg width={size || 14} height={size || 14} viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
)

// ── plans / copy ───────────────────────────────────────────────────────
interface Plan { id: string; name: string; out: string; price: string; base: number; track: number; rec: boolean; feats: string[] }
const PLANS: Plan[] = [
  { id: 'maintain', name: 'Maintain', out: 'Steady upkeep, handled.', price: '$1,500', base: 1500, track: 1000, rec: false, feats: ['One active track of work', 'Design and build, ongoing', '48-hour response', 'Monthly check-in'] },
  { id: 'scale', name: 'Scale', out: 'Ongoing design and build, handled.', price: '$4,000', base: 4000, track: 1500, rec: true, feats: ['Multiple tracks in parallel', 'Priority design and build', 'Same-day response', 'Strategy and roadmap'] },
]
const ANCHOR = 'Hiring the equivalent specialists separately runs $5,200 to $17,500+ a month. This is one calm line item, change it anytime.'
const BUDGETS = ['Not sure yet', 'Under $5k', '$5k to $15k', '$15k to $50k', '$50k+']
const DISCIPLINES = ['Design', 'Development', 'Both design and development']
const SLOT_TIMES = ['9:30 am', '11:00 am', '1:30 pm', '3:00 pm']

const META: Record<string, string> = {
  welcome: 'Welcome', plan: 'Your plan', pay: 'Payment', details: 'Confirm you',
  work: 'Your brief', invite: 'Your team', kickoff: 'Kickoff', orient: 'Welcome',
}

function upcomingDays(n: number): Date[] {
  const out: Date[] = []
  const d = new Date()
  let guard = 0
  while (out.length < n && guard++ < 30) {
    d.setDate(d.getDate() + 1)
    const wd = d.getDay()
    if (wd === 0 || wd === 6) continue
    out.push(new Date(d))
  }
  return out
}

function buildSteps(engagement: 'project' | 'retainer', clientType: 'new' | 'existing'): string[] {
  const project = engagement === 'project'
  if (clientType === 'existing') {
    if (project) return ['welcome', 'kickoff']
    return ['welcome', 'plan', 'pay']
  }
  if (project) return ['welcome', 'details', 'invite', 'kickoff']
  return ['welcome', 'plan', 'pay', 'details', 'invite']
}

// ── Loom-style hello modal ─────────────────────────────────────────────
const VID_DUR = 62
const VID_CAPTIONS: [number, string][] = [
  [0, `Hey {first}, Liam here. Welcome to Tahi, so glad to have you.`],
  [10, 'This is your studio. Everything for our work together lives right here.'],
  [22, 'Need something? Just send a request, describe it and we pick it up.'],
  [34, 'We work in focused tracks, so things ship fast, not slowly all at once.'],
  [46, 'Message us any time in here, real people, quick replies.'],
  [55, "That's it. Can't wait to get started. Dive in whenever you're ready."],
]
function captionAt(t: number, first: string): string {
  let line = VID_CAPTIONS[0][1]
  for (const [start, txt] of VID_CAPTIONS) if (t >= start) line = txt
  return line.replace('{first}', first)
}

function VideoModal({ open, onClose, lead }: { open: boolean; onClose: () => void; lead: OnboardingLead }) {
  const [playing, setPlaying] = React.useState(true)
  const [t, setT] = React.useState(0)
  const first = lead.first
  React.useEffect(() => { if (open) { setPlaying(true); setT(0) } }, [open])
  React.useEffect(() => {
    if (!open || !playing) return
    const id = setInterval(() => { setT(x => { const n = x + 0.1; if (n >= VID_DUR) { setPlaying(false); return VID_DUR } return n }) }, 100)
    return () => clearInterval(id)
  }, [open, playing])
  React.useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); if (e.key === ' ') { e.preventDefault(); setPlaying(p => !p) } }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open, onClose])
  if (!open) return null
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  const pct = Math.min(100, (t / VID_DUR) * 100)
  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    setT(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * VID_DUR)
  }
  const replay = t >= VID_DUR
  return (
    <div className="ob-vid-overlay" onClick={onClose}>
      <div className="ob-vid" onClick={e => e.stopPropagation()} role="dialog" aria-label={`A hello from ${first}`}>
        <button className="ob-vid-x" onClick={onClose} aria-label="Close">&times;</button>
        <div className="ob-vid-stage" onClick={() => setPlaying(p => !p)}>
          {lead.img
            // eslint-disable-next-line @next/next/no-img-element
            ? <img className={cn('ob-vid-poster', playing && 'playing')} src={lead.img} alt="" />
            : <div className="ob-vid-poster ob-vid-poster-fallback" />}
          <div className="ob-vid-scrim" aria-hidden="true" />
          <div className="ob-vid-meta"><span className="ob-vid-badge"><span className="ob-vid-live" />{first} &middot; Tahi</span></div>
          <div className="ob-vid-cap"><p key={captionAt(t, first)}>{captionAt(t, first)}</p></div>
          {!playing && (
            <button className="ob-vid-bigplay" onClick={e => { e.stopPropagation(); if (replay) setT(0); setPlaying(true) }} aria-label={replay ? 'Replay' : 'Play'}>
              {replay ? <I size={30}><><path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-6.4 2.6L3 8" /><path d="M3 3v5h5" /></></I> : <PlayFill size={30} />}
            </button>
          )}
        </div>
        <div className="ob-vid-controls">
          <button className="ob-vid-pp" onClick={() => { if (replay) setT(0); setPlaying(p => !p) }} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <PauseFill size={16} /> : <PlayFill size={16} />}</button>
          <span className="ob-vid-time">{fmt(t)}</span>
          <div className="ob-vid-bar" onClick={seek}><div className="ob-vid-fill" style={{ width: pct + '%' }}><span className="ob-vid-knob" /></div></div>
          <span className="ob-vid-time muted">{fmt(VID_DUR)}</span>
        </div>
      </div>
    </div>
  )
}

function SlotPicker({ calDays, slot, setSlot }: { calDays: Date[]; slot: string | null; setSlot: (s: string) => void }) {
  return (
    <div className="ob-cal">
      {calDays.map((d, di) => {
        const wd = d.toLocaleDateString('en-NZ', { weekday: 'short' })
        const dom = d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })
        return (
          <div className="ob-cal-day" key={di}>
            <div className="ob-cal-d"><b>{wd}</b><span>{dom}</span></div>
            <div className="ob-slots">
              {SLOT_TIMES.map(time => {
                const id = di + '-' + time
                return <button key={time} className={cn('ob-slot-chip', slot === id && 'on')} onClick={() => setSlot(id)}>{time}</button>
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── scene ──────────────────────────────────────────────────────────────
function LeadCard({ lead, note }: { lead: OnboardingLead; note: string }) {
  return (
    <div className="ob-lead">
      <span className="ob-lead-av" aria-hidden="true">
        {lead.img
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={lead.img} alt="" />
          : lead.initials}
      </span>
      <span className="ob-lead-t"><b>{lead.first} is your lead.</b><span>{note}</span></span>
    </div>
  )
}

// ── app ────────────────────────────────────────────────────────────────
export function OnboardingContent({
  entry,
  lead,
  redirectTo,
}: {
  entry: ClientEntry
  lead: OnboardingLead
  redirectTo: string
}) {
  const router = useRouter()
  const onComplete = () => router.push(redirectTo)
  const contact = {
    name: entry.contactName ?? 'there',
    email: entry.contactEmail ?? '',
    initials: (entry.contactName ?? 'You').split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase(),
  }
  const company = entry.companyName ?? 'your company'
  const first = contact.name.split(' ')[0]

  // engagement/clientType can change locally only via the self-serve chooser.
  const [engagement, setEngagement] = React.useState(entry.engagement)
  const clientType = entry.clientType
  const decidedSelfServe = entry.persona !== 'selfserve'
  const [chosen, setChosen] = React.useState(decidedSelfServe)
  const [selfView, setSelfView] = React.useState<'choose' | 'proposal' | 'done'>('choose')

  const [idx, setIdx] = React.useState(0)
  const [dir, setDir] = React.useState(1)
  const [plan, setPlan] = React.useState('scale')
  const [addon, setAddon] = React.useState(false)
  const [slot, setSlot] = React.useState<string | null>(null)
  const [videoOpen, setVideoOpen] = React.useState(false)
  const [invites, setInvites] = React.useState<string[]>([])
  const [inviteEmail, setInviteEmail] = React.useState('')

  const calDays = React.useMemo(() => upcomingDays(4), [])
  const steps = React.useMemo(() => buildSteps(engagement, clientType), [engagement, clientType])
  const ledgerSteps: LedgerStep[] = steps.map(s => ({ id: s, label: META[s] }))
  const stepId = steps[Math.min(idx, steps.length - 1)]

  const inChooser = clientType === 'new' && entry.entry === 'selfserve' && !chosen
  const [growWrap, growInner] = useGrow((inChooser ? 'self:' + selfView : stepId))

  const next = () => { setDir(1); if (idx >= steps.length - 1) onComplete(); else setIdx(idx + 1) }
  const back = () => { setDir(-1); setIdx(Math.max(0, idx - 1)) }
  const goSelf = (v: 'choose' | 'proposal' | 'done', d = 1) => { setDir(d); setSelfView(v) }
  const pickRetainer = () => { setDir(1); setEngagement('retainer'); setChosen(true); setIdx(0) }

  // Send any pending invites (Clerk org invitations) then advance.
  const sendInvitesAndNext = async () => {
    if (invites.length) {
      try {
        await fetch('/api/portal/invites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ emails: invites }),
        })
      } catch {
        // non-fatal: invites can be re-sent from the studio
      }
    }
    next()
  }

  const money = (n: number) => '$' + n.toLocaleString('en-US')
  const planObj = PLANS.find(p => p.id === plan)!
  const monthly = planObj.base + (addon ? planObj.track : 0)
  const amount = money(monthly)

  let title = '', sub = '', primary: string | null = 'Continue', onPrimary = next
  let body: React.ReactNode = null, skip: string | null = null, wide = false, footer = true

  if (inChooser) {
    footer = false
    if (selfView === 'done') {
      body = (
        <div className="ob-success" style={{ padding: '8px 0' }}>
          <div className="ring"><Check size={28} /></div>
          <h2>Thanks, we&apos;re on it.</h2>
          <p>We&apos;ll shape a proposal and email it to {contact.email || 'you'} within two working days. {lead.first} may reach out to learn more.</p>
        </div>
      )
    } else if (selfView === 'proposal') {
      body = (
        <>
          <h1 className="ob-h1">Tell us about the project.</h1>
          <p className="ob-sub">A few details and we&apos;ll come back with a proposal scoped to you. No commitment.</p>
          <div className="ob-identity"><span className="ob-identity-av">{contact.initials}</span><span className="ob-identity-t"><b>{contact.name}</b><small>{contact.email}</small></span><span className="ob-identity-tag">From your sign-up</span></div>
          <div className="ob-row2 ob-field"><div><label className="ob-label">Company name</label><input className="ob-input" placeholder="Company name" /></div><div><label className="ob-label">Website <span style={{ color: '#9b9a94' }}>(if you have one)</span></label><input className="ob-input" placeholder="yourcompany.com" /></div></div>
          <div className="ob-field"><label className="ob-label">What are you after?</label><textarea className="ob-textarea" placeholder="A new site, a rebrand, a product surface. A sentence or two is enough." /></div>
          <div className="ob-row2 ob-field">
            <div><label className="ob-label">Rough budget</label><select className="ob-select" defaultValue="Not sure yet">{BUDGETS.map(b => <option key={b} value={b}>{b}</option>)}</select></div>
            <div><label className="ob-label">You&apos;re after</label><select className="ob-select" defaultValue="Both design and development">{DISCIPLINES.map(d => <option key={d} value={d}>{d}</option>)}</select></div>
          </div>
          <div className="ob-footer"><button className="ob-back" onClick={() => goSelf('choose', -1)}>Back</button><button className="ob-next" onClick={() => goSelf('done', 1)}>Send and get a proposal</button></div>
        </>
      )
    } else {
      body = (
        <>
          <h1 className="ob-h1">Welcome, {first}. How can we help?</h1>
          <p className="ob-sub">Two ways to work with us, pick the one that fits. You can change your mind any time.</p>
          <div className="ob-fd-options">
            <button className="ob-fd-opt rec" onClick={pickRetainer}>
              <span className="ob-fd-ic"><I size={20}><><path d="M3 3v18h18" /><path d="M7 14l3-4 4 3 5-7" /></></I></span>
              <span className="ob-fd-t"><b>Ongoing design &amp; build</b><small>A monthly retainer. Pick a plan and start today, fully self-serve.</small></span>
              <span className="ob-fd-go"><I size={17}><path d="M5 12h14M13 6l6 6-6 6" /></I></span>
            </button>
            <button className="ob-fd-opt" onClick={() => goSelf('proposal', 1)}>
              <span className="ob-fd-ic"><I size={20}><><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M9 13h6M9 17h4" /></></I></span>
              <span className="ob-fd-t"><b>A one-off project</b><small>Bespoke work, scoped to you. Tell us about it and we&apos;ll send a proposal.</small></span>
              <span className="ob-fd-go"><I size={17}><path d="M5 12h14M13 6l6 6-6 6" /></I></span>
            </button>
          </div>
          <p className="ob-fd-note">Not sure which? Start a project enquiry, we&apos;ll point you the right way.</p>
        </>
      )
    }
  } else if (stepId === 'welcome' || stepId === 'orient') {
    const existing = clientType === 'existing'
    if (existing) {
      title = `Welcome back, ${first}.`
      sub = `Let's open your new ${engagement === 'retainer' ? 'retainer' : 'project'}, your studio and team are already set up.`
      primary = 'Get started'
    } else {
      const known = entry.entry === 'invited'
      title = known ? `Everything's ready, ${first}.` : `Welcome to Tahi, ${first}.`
      sub = known
        ? `${company}'s studio is set up and waiting. A quick hello from ${lead.first}, then a couple of light steps to make it yours.`
        : `So glad you're here. A quick hello from ${lead.first}, then we'll get your retainer set up, only takes a few minutes.`
      primary = 'Step inside'
      const note = known
        ? `"Really looking forward to working with you and the ${company} team, ${first}. Everything's set up our end, give me a shout in here any time."`
        : `"Welcome aboard, ${first}. Genuinely excited to get going, I'll be your point of contact the whole way through."`
      body = (
        <div className="ob-welcomecard">
          <div className="ob-wc-lead">
            <span className="ob-kickoff-av">
              {lead.img
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={lead.img} alt="" />
                : lead.initials}
            </span>
            <div><b>{lead.name}</b><small>{lead.role}</small></div>
          </div>
          <p className="ob-wc-note">{note}</p>
          <button className="ob-loom" onClick={e => { e.preventDefault(); setVideoOpen(true) }}>
            <span className="ob-loom-play"><PlayFill size={13} /></span>
            <span className="ob-loom-t"><b>Watch a 60-second hello</b><small>How your studio works, from {lead.first}.</small></span>
            <span className="ob-loom-dur">1:02</span>
          </button>
        </div>
      )
    }
  } else if (stepId === 'plan') {
    wide = true
    title = 'Choose how we&apos;ll work together.'.replace('&apos;', "'")
    sub = 'Pick the pace that fits. Change or pause it any time.'
    body = (
      <>
        <div className="ob-plans" role="radiogroup" aria-label="Choose your plan">
          {PLANS.map(p => (
            <button key={p.id} role="radio" aria-checked={plan === p.id} className={cn('ob-plan', p.rec && 'rec', plan === p.id && 'sel')} onClick={() => setPlan(p.id)}>
              {p.rec && <span className="ob-plan-pill">Recommended</span>}
              <div className="ob-plan-out">{p.out}</div>
              <div className="ob-plan-price">{p.price}<span> /month</span></div>
              <div className="ob-plan-gst">+ tax where it applies</div>
              <ul>{p.feats.map((f, i) => <li key={i}><Check size={14} />{f}</li>)}</ul>
              <div className="ob-plan-sel"><Check size={13} /> Selected</div>
            </button>
          ))}
        </div>
        <button type="button" className={cn('ob-addon', addon && 'on')} role="checkbox" aria-checked={addon} onClick={() => setAddon(a => !a)}>
          <span className="ob-addon-check">{addon ? <Check size={14} /> : null}</span>
          <span className="ob-addon-t"><b>Add a parallel track <span className="ob-addon-tag">Priority Support</span></b><small>{planObj.id === 'scale' ? 'A third track of any size, with a priority queue and same-day responses.' : 'A second, smaller track so two things move at once, with a priority queue.'}</small></span>
          <span className="ob-addon-price">+{money(planObj.track)}<i> /mo</i></span>
        </button>
        <div className="ob-anchor">{ANCHOR}</div>
        <div className="ob-cycle">Billed monthly. Bigger scopes move to invoicing, we&apos;ll flag it.</div>
      </>
    )
  } else if (stepId === 'pay') {
    wide = true
    footer = false // OnboardingPayment renders its own pay/back footer
    title = 'Start your retainer.'
    sub = "Card today, then it's all handled in your studio. Change or pause any time."
    body = (
      <OnboardingPayment
        plan={planObj.id as 'maintain' | 'scale'}
        addon={addon}
        planName={planObj.name}
        baseLabel={money(planObj.base)}
        trackLabel={money(planObj.track)}
        totalLabel={amount}
        onPaid={next}
        onInvoiced={next}
        onBack={back}
      />
    )
  } else if (stepId === 'details') {
    const askCompany = engagement === 'retainer' && entry.entry === 'selfserve'
    title = 'A couple of details and you&apos;re set.'.replace('&apos;', "'")
    sub = `Signed in as ${contact.name}. ${askCompany ? 'Just your workspace, role and timezone.' : 'Just your role and timezone, ten seconds.'}`
    body = (
      <>
        <div className="ob-identity"><span className="ob-identity-av">{contact.initials}</span><span className="ob-identity-t"><b>{contact.name}</b><small>{contact.email}</small></span><span className="ob-identity-tag">On file</span></div>
        {askCompany && <div className="ob-field"><label className="ob-label">Company / workspace name</label><input className="ob-input" placeholder="What should we call your studio?" autoComplete="organization" /></div>}
        <div className="ob-field"><label className="ob-label">Your role</label><input className="ob-input" placeholder="e.g. Marketing Lead" autoComplete="organization-title" /></div>
        <TimezoneField />
      </>
    )
  } else if (stepId === 'invite') {
    title = 'Bring your team in.'
    sub = 'Optional, and easy later. Each person gets an email the moment you add them.'
    primary = invites.length ? 'Send invites and continue' : 'Continue'
    onPrimary = sendInvitesAndNext
    skip = "Skip, I'll do this later"
    const addInvite = () => {
      const v = inviteEmail.trim()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return
      setInvites([...invites, v]); setInviteEmail('')
    }
    body = (
      <>
        <div className="ob-invite-add"><input className="ob-input" type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addInvite() } }} placeholder="colleague@company.com" autoComplete="off" /><button onClick={addInvite}>Add</button></div>
        {invites.length === 0
          ? <div className="ob-invite-empty"><I size={18}><><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></></I><span>No one yet, it&apos;s just you. Add teammates by email, or do this later.</span></div>
          : <ul className="ob-invites">{invites.map((em, i) => (<li key={i}><span className="ob-inv-av">{em[0].toUpperCase()}</span><span className="em">{em}</span><span className="ob-pill info" style={{ marginLeft: 'auto' }}>Will be invited</span><button className="act" onClick={() => setInvites(invites.filter((_, j) => j !== i))}>Remove</button></li>))}</ul>}
        <p className="ob-invite-note">Everyone joins as a member. You can make someone an admin later in settings.</p>
      </>
    )
  } else if (stepId === 'kickoff') {
    title = 'Book your kickoff.'
    sub = `The proper hello. Grab a time with ${lead.first} to set direction together, this is where it really starts.`
    primary = slot ? 'Book and enter your studio' : 'Enter your studio'
    skip = 'I&apos;ll book from my studio'.replace('&apos;', "'")
    body = (
      <>
        <div className="ob-kickoff-lead">
          <span className="ob-kickoff-av">
            {lead.img
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={lead.img} alt="" />
              : lead.initials}
          </span>
          <span className="ob-kickoff-t"><b>30 min with {lead.first}</b><small>Video call, we&apos;ll align on direction, no prep needed.</small></span>
        </div>
        <SlotPicker calDays={calDays} slot={slot} setSlot={setSlot} />
        <div className="ob-trust"><Check size={13} /> Reschedule any time from your studio.</div>
      </>
    )
  }

  // last step finishes the flow. 'pay' advances itself; 'invite' needs to send
  // invites first (sendInvitesAndNext routes to onComplete when it is last).
  const isLast = idx >= steps.length - 1
  if (isLast && stepId !== 'pay' && stepId !== 'invite' && !inChooser) onPrimary = onComplete

  const sceneHeadline = clientType === 'existing' ? 'Good to have you back.' : 'You&apos;re known, expected, and in good hands.'.replace('&apos;', "'")

  return (
    <div className="ob-stage">
      <style>{ONBOARDING_CSS}</style>
      <style>{VIDEO_CSS}</style>
      <div className="ob-bg" />
      <div className="ob-frame">
        <div className="tahi-auth">
          {inChooser ? (
            <SceneShell>
              <ScenePill>Welcome to Tahi</ScenePill>
              <h2 className="ta-headline">Ongoing or one-off, shaped around you.</h2>
              <Ledger steps={[{ id: 'a', label: 'Retainers start in minutes' }, { id: 'b', label: 'Projects get a scoped proposal' }, { id: 'c', label: 'Then your studio opens' }]} idx={0} staticList />
              <LeadCard lead={lead} note="He'll look after you either way." />
            </SceneShell>
          ) : (
            <SceneShell>
              <ScenePill>{clientType === 'existing' ? 'Your studio' : 'Your studio'}</ScenePill>
              <h2 className="ta-headline">{sceneHeadline}</h2>
              <Ledger steps={ledgerSteps} idx={idx} />
              <LeadCard lead={lead} note="Reach him any time in the portal." />
            </SceneShell>
          )}

          <main className="tahi-auth-form">
            <section className={cn('tahi-auth-card', wide && 'ob-wide')}>
              {!inChooser && <Stepper steps={ledgerSteps} idx={idx} />}
              <div className="ob-grow" ref={growWrap}>
                <div className={cn('ob-body', dir > 0 ? 'ob-in-up' : 'ob-in-down')} key={inChooser ? 'self:' + selfView : stepId} ref={growInner}>
                  {title && <h1 className="ob-h1">{title}</h1>}
                  {sub && <p className="ob-sub">{sub}</p>}
                  {body}
                </div>
              </div>
              {footer && (
                <div className={cn('ob-footer', idx === 0 && 'end')}>
                  {idx > 0 && <button className="ob-back" onClick={back}>Back</button>}
                  {primary && <button className="ob-next" onClick={onPrimary}>{primary}</button>}
                </div>
              )}
              {skip && <div style={{ marginTop: '14px', textAlign: 'center' }}><button className="ob-skip" onClick={next}>{skip} &rarr;</button></div>}
            </section>
          </main>
        </div>
      </div>
      <VideoModal open={videoOpen} onClose={() => setVideoOpen(false)} lead={lead} />
    </div>
  )
}

// Video modal CSS (only the client flow uses it).
const VIDEO_CSS = `
.ob-vid-overlay{ position:fixed; inset:0; z-index:200; display:flex; align-items:center; justify-content:center; padding:24px; background:rgba(10,16,8,0.66); backdrop-filter:blur(6px); animation:ob-vfade .18s ease; }
@keyframes ob-vfade{ from{ opacity:0; } to{ opacity:1; } }
.ob-vid{ width:min(900px,94vw); max-height:92vh; background:#0c1607; border:1px solid rgba(122,171,107,0.22); border-radius:1rem; overflow:hidden; box-shadow:0 40px 120px -30px rgba(0,0,0,0.7); position:relative; animation:ob-vid-in .22s cubic-bezier(.2,.8,.2,1); }
@keyframes ob-vid-in{ from{ opacity:0; transform:translateY(10px) scale(.985); } to{ opacity:1; transform:none; } }
.ob-vid-x{ position:absolute; top:12px; right:12px; z-index:5; width:34px; height:34px; border-radius:50%; border:none; background:rgba(8,12,6,0.55); color:#fff; font-size:20px; line-height:1; cursor:pointer; display:flex; align-items:center; justify-content:center; }
.ob-vid-x:hover{ background:rgba(8,12,6,0.85); }
.ob-vid-stage{ position:relative; aspect-ratio:16/9; background:#000; overflow:hidden; cursor:pointer; }
.ob-vid-poster{ position:absolute; inset:0; width:100%; height:100%; object-fit:cover; object-position:50% 22%; transform:scale(1.02); }
.ob-vid-poster-fallback{ background:linear-gradient(150deg,#1F3719,#0E1C09); }
.ob-vid-poster.playing{ animation:ob-ken 24s ease-in-out infinite alternate; }
@keyframes ob-ken{ from{ transform:scale(1.02) translate(0,0); } to{ transform:scale(1.13) translate(-2%,-3%); } }
.ob-vid-scrim{ position:absolute; inset:0; background:linear-gradient(to top, rgba(6,10,4,0.78) 0%, rgba(6,10,4,0.12) 42%, rgba(6,10,4,0) 70%); }
.ob-vid-meta{ position:absolute; top:16px; left:16px; }
.ob-vid-badge{ display:inline-flex; align-items:center; gap:7px; padding:6px 11px; border-radius:999px; background:rgba(8,12,6,0.5); backdrop-filter:blur(4px); color:#EAF3E4; font:600 12.5px 'Manrope'; }
.ob-vid-live{ width:7px; height:7px; border-radius:50%; background:#7ce0a0; animation:ob-vpulse 2s ease-out infinite; }
@keyframes ob-vpulse{ 0%{ box-shadow:0 0 0 0 rgba(124,224,160,0.5); } 70%{ box-shadow:0 0 0 7px rgba(124,224,160,0); } 100%{ box-shadow:0 0 0 0 rgba(124,224,160,0); } }
.ob-vid-cap{ position:absolute; left:0; right:0; bottom:18px; padding:0 36px; display:flex; justify-content:center; pointer-events:none; }
.ob-vid-cap p{ margin:0; max-width:62ch; text-align:center; color:#fff; font:600 19px/1.4 'Manrope'; text-shadow:0 2px 14px rgba(0,0,0,0.55); animation:ob-vcap .4s ease; }
@keyframes ob-vcap{ from{ opacity:0; transform:translateY(6px); } to{ opacity:1; transform:none; } }
.ob-vid-bigplay{ position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:84px; height:84px; border-radius:50%; border:none; background:rgba(253,253,252,0.94); color:#16290f; display:flex; align-items:center; justify-content:center; padding-left:5px; cursor:pointer; box-shadow:0 12px 40px -8px rgba(0,0,0,0.5); transition:transform .14s, background .14s; }
.ob-vid-bigplay:hover{ transform:translate(-50%,-50%) scale(1.06); background:#fff; }
.ob-vid-controls{ display:flex; align-items:center; gap:13px; padding:13px 16px; background:#0a1206; }
.ob-vid-pp{ width:34px; height:34px; flex-shrink:0; border-radius:50%; border:none; background:rgba(122,171,107,0.16); color:#cdeccd; display:flex; align-items:center; justify-content:center; padding-left:1px; cursor:pointer; }
.ob-vid-pp:hover{ background:rgba(122,171,107,0.28); }
.ob-vid-time{ font:600 12.5px 'Manrope'; color:#cdeccd; flex-shrink:0; font-variant-numeric:tabular-nums; }
.ob-vid-time.muted{ color:rgba(205,236,205,0.5); }
.ob-vid-bar{ flex:1; height:5px; border-radius:999px; background:rgba(205,236,205,0.18); cursor:pointer; position:relative; }
.ob-vid-fill{ height:100%; border-radius:999px; background:linear-gradient(90deg,#5aa86b,#8fe0a3); position:relative; }
.ob-vid-knob{ position:absolute; right:-6px; top:50%; transform:translateY(-50%); width:12px; height:12px; border-radius:50%; background:#eafff0; box-shadow:0 1px 5px rgba(0,0,0,0.4); }
@media (max-width:560px){ .ob-vid-cap p{ font-size:15px; } .ob-vid-bigplay{ width:64px; height:64px; } }
@media (prefers-reduced-motion: reduce){ .ob-vid-poster.playing, .ob-vid-live, .ob-vid-cap p{ animation:none !important; } }
`
