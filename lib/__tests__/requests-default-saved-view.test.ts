/**
 * Founder rule (7 Sep 2026): everyone who has not saved their own default
 * lands on All active, not on all 332 requests. Clients keep All requests.
 */
import { describe, it, expect } from 'vitest'
import { defaultSavedViewFor, savedViewsFor } from '@/lib/requests-views'

describe('defaultSavedViewFor', () => {
  it('starts the team on All active', () => {
    expect(defaultSavedViewFor('admin')).toBe('active')
    expect(defaultSavedViewFor('team_member')).toBe('active')
  })

  it('starts a client on All requests, because In progress would hide Waiting on you', () => {
    expect(defaultSavedViewFor('client')).toBeNull()
  })

  it('names a view every team audience actually has', () => {
    for (const audience of ['admin', 'team_member'] as const) {
      const key = defaultSavedViewFor(audience)
      expect(savedViewsFor(audience).some((view) => view.key === key)).toBe(true)
    }
  })
})
