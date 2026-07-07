'use client'

/**
 * Plan & billing (client portal). The client's retainer with Tahi: current
 * plan, extra-track add-ons, a live breakdown, and a change-plan grid. Shown
 * under the client Plan & billing group.
 *
 * The catalogue mirrors lib/stripe-plans.ts (the plans we sell); the feature
 * lines and taglines are presentational. Current plan + change requests are
 * scaffolded locally: wiring needs a portal subscription endpoint (read the
 * org's plan) and a change-request path. Flagged, not wired.
 */

import { useState } from 'react'
import { Check, Minus, Plus } from 'lucide-react'
import { SectionShell, Chip } from '@/components/tahi/settings/primitives'

interface PlanOption {
  id: string
  name: string
  base: number
  track: number
  rec: boolean
  tag: string
  feats: string[]
}

// Mirrors lib/stripe-plans.ts amounts (base + parallel-track add-on, in NZD).
const CATALOG: PlanOption[] = [
  { id: 'maintain', name: 'Maintain', base: 1500, track: 1000, rec: false, tag: 'Steady upkeep, handled.', feats: ['One active track of work', 'Design and build, ongoing', '48-hour response', 'Monthly check-in'] },
  { id: 'scale', name: 'Scale', base: 4000, track: 1500, rec: true, tag: 'Ongoing design and build, handled.', feats: ['Multiple tracks in parallel', 'Priority design and build', '24-hour response', 'Weekly check-in', 'Quarterly strategy'] },
]

function money(n: number): string {
  return '$' + Number(n || 0).toLocaleString('en-NZ')
}

export function PlanBillingSection() {
  const [currentId, setCurrentId] = useState('scale')
  const [tracks, setTracks] = useState(1)
  const [note, setNote] = useState('')

  const current = CATALOG.find((p) => p.id === currentId) ?? CATALOG[0]
  const total = current.base + tracks * current.track

  function flash(msg: string) {
    setNote(msg)
    window.setTimeout(() => setNote(''), 4200)
  }
  function switchTo(id: string) {
    const p = CATALOG.find((x) => x.id === id)
    if (!p) return
    setCurrentId(id)
    flash(`Change to ${p.name} requested. Your studio contact will confirm before it takes effect.`)
  }
  function setTrackCount(n: number) {
    const v = Math.max(0, n)
    flash(v > tracks ? 'Extra track requested. We will confirm scheduling.' : 'Track reduction requested. We will confirm before it changes.')
    setTracks(v)
  }

  return (
    <SectionShell title="Plan & billing" lede="Your retainer with Tahi Studio. Change anytime and we will confirm before it takes effect.">
      <div className="set-card plan-current">
        <div className="pc-l">
          <span className="led">Current plan</span>
          <div className="pc-name"><b>{current.name}</b><Chip tone="brand">Active</Chip></div>
          <div className="pc-sub">{money(total)}<span>/mo</span> · next charge 1 Aug 2026</div>
        </div>
        <button className="btn2" type="button">Manage payment method</button>
      </div>

      <div className="set-card plan-addon">
        <div className="sr-t"><b>Extra tracks</b><small>Run more work in parallel. {money(current.track)}/mo each, on top of your base plan.</small></div>
        <div className="track-stepper">
          <button type="button" onClick={() => setTrackCount(tracks - 1)} disabled={tracks <= 0} aria-label="Remove a track"><Minus size={16} aria-hidden="true" /></button>
          <span>{tracks}</span>
          <button type="button" onClick={() => setTrackCount(tracks + 1)} aria-label="Add a track"><Plus size={16} aria-hidden="true" /></button>
        </div>
      </div>

      <div className="set-card plan-breakdown">
        <div className="pb-row"><span>{current.name} base</span><b>{money(current.base)}/mo</b></div>
        {tracks > 0 && <div className="pb-row"><span>{tracks} extra track{tracks > 1 ? 's' : ''} x {money(current.track)}</span><b>{money(tracks * current.track)}/mo</b></div>}
        <div className="pb-row total"><span>Total</span><b>{money(total)}/mo</b></div>
      </div>

      {note && <div className="plan-note">{note}</div>}

      <div className="set-sub-label">Change plan</div>
      <div className="plan-grid">
        {CATALOG.map((p) => {
          const isCurrent = p.id === currentId
          return (
            <div key={p.id} className={'plan-card' + (isCurrent ? ' current' : '')}>
              {p.rec && <span className="plan-rec">Most popular</span>}
              <div className="plan-h"><b>{p.name}</b>{isCurrent && <Chip tone="brand">Current</Chip>}</div>
              <div className="plan-price">{money(p.base)}<span>/mo</span></div>
              <p className="plan-tag">{p.tag}</p>
              <ul className="plan-feats">
                {p.feats.map((f) => (<li key={f}><Check size={15} aria-hidden="true" />{f}</li>))}
              </ul>
              {isCurrent
                ? <button className="btn2" type="button" disabled>Current plan</button>
                : <button className="btn1" type="button" onClick={() => switchTo(p.id)}>Switch to {p.name}</button>}
            </div>
          )
        })}
      </div>
    </SectionShell>
  )
}
