import { describe, it, expect } from 'vitest'
import {
  portalStatusMeta,
  portalStatusLabel,
  portalStatusGloss,
  portalStatusTitle,
  portalStageFraction,
  PORTAL_PIPELINE,
  PORTAL_OPEN_STATUSES,
} from '@/lib/portal-status'
import { CLIENT_OPEN_STATUSES } from '@/lib/client-home-signals'
import { REQUEST_STATUS_CONFIG, REQUEST_STATUSES } from '@/lib/status-config'

describe('portal-status: one client vocabulary', () => {
  it('has a word and a gloss for every status the studio can store', () => {
    for (const s of REQUEST_STATUSES) {
      const meta = portalStatusMeta(s.value)
      expect(meta.label.length).toBeGreaterThan(0)
      expect(meta.gloss.length).toBeGreaterThan(0)
    }
  })

  it('speaks the house words, not a private client dictionary', () => {
    // The bug this module exists to kill: the home said "Queued / In build /
    // Review" while the list and the detail said "Submitted / In Progress /
    // Client Review" one click away.
    expect(portalStatusLabel('submitted')).toBe('Submitted')
    expect(portalStatusLabel('in_progress')).toBe('In progress')
    expect(portalStatusLabel('client_review')).toBe('Client review')
    expect(portalStatusLabel('delivered')).toBe('Delivered')
  })

  it('glosses client_review as the thing the client has to do', () => {
    expect(portalStatusGloss('client_review')).toBe('With you to approve')
    expect(portalStatusTitle('client_review')).toBe('Client review. With you to approve.')
  })

  it('takes its colours from the shared token config, so dark mode matches', () => {
    for (const s of REQUEST_STATUSES) {
      const meta = portalStatusMeta(s.value)
      const shared = REQUEST_STATUS_CONFIG[s.value]
      expect(meta.bg).toBe(shared.bg)
      expect(meta.text).toBe(shared.text)
      expect(meta.border).toBe(shared.border)
      expect(meta.dot).toBe(shared.dot)
    }
  })

  it('never returns a hardcoded hex: every colour is a token reference', () => {
    for (const s of REQUEST_STATUSES) {
      const meta = portalStatusMeta(s.value)
      for (const value of [meta.bg, meta.text, meta.border, meta.dot]) {
        expect(value.startsWith('var(--')).toBe(true)
      }
    }
  })

  it('degrades an unknown status instead of throwing or rendering nothing', () => {
    const meta = portalStatusMeta('some_new_status')
    expect(meta.label).toBe('some new status')
    expect(meta.gloss).toBe('')
    expect(meta.chip).toBe('muted')
    expect(portalStatusLabel(null)).toBe('Unknown')
    expect(portalStatusLabel(undefined)).toBe('Unknown')
  })

  it('orders the pipeline the way a request actually walks it', () => {
    expect([...PORTAL_PIPELINE]).toEqual([
      'submitted',
      'in_review',
      'in_progress',
      'client_review',
      'delivered',
    ])
  })

  it('is the same list the client home vital counts, not a second one', () => {
    // Identity, not equality: the module re-exports CLIENT_OPEN_STATUSES rather
    // than keeping its own copy, so the two cannot drift.
    expect(PORTAL_OPEN_STATUSES).toBe(CLIENT_OPEN_STATUSES)
    expect(PORTAL_OPEN_STATUSES).toContain('on_hold')
    // client_review is waiting on the CLIENT, and the home counts it in its own
    // "To approve" vital. Counting it here too would double-count it.
    expect(PORTAL_OPEN_STATUSES).not.toContain('client_review')
    expect(PORTAL_OPEN_STATUSES).not.toContain('delivered')
    expect(PORTAL_OPEN_STATUSES).not.toContain('cancelled')
  })

  it('moves the stage meter forward along the pipeline and never past 1', () => {
    let previous = -1
    for (const status of PORTAL_PIPELINE) {
      const value = portalStageFraction(status)
      expect(value).toBeGreaterThan(previous)
      expect(value).toBeLessThanOrEqual(1)
      previous = value
    }
    expect(portalStageFraction('delivered')).toBe(1)
    // An unrecognised status still draws something, not NaN.
    expect(Number.isFinite(portalStageFraction('mystery'))).toBe(true)
  })
})
