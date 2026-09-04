/**
 * mergeUpcomingCalls: one entry per real meeting.
 *
 * POST /api/portal/calls writes the same booking into scheduled_calls and its
 * discovery_calls mirror, so GET has to collapse the pair. Before this, calls[0]
 * could be a stale twin and the client's "Next call" card showed the slot they
 * had already moved away from.
 */
import { describe, it, expect } from 'vitest'
import { mergeUpcomingCalls, type RawPortalCall } from '@/lib/portal-calls'

const T0 = Date.parse('2026-09-09T01:30:00.000Z')

function call(overrides: Partial<RawPortalCall> = {}): RawPortalCall {
  return {
    id: 'c1',
    title: 'Kickoff call',
    scheduledAt: new Date(T0).toISOString(),
    durationMinutes: 30,
    meetingUrl: null,
    attendees: null,
    ...overrides,
  }
}

const opts = { cutoffMs: T0 - 86_400_000, limit: 5 }

describe('mergeUpcomingCalls', () => {
  it('collapses a booking and its mirror into one item', () => {
    const out = mergeUpcomingCalls([call()], [call({ id: 'c1' })], opts)
    expect(out).toHaveLength(1)
    expect(out[0].source).toBe('scheduled')
  })

  it('collapses even when the mirror carries a different id', () => {
    const out = mergeUpcomingCalls([call({ id: 'sched' })], [call({ id: 'legacy' })], opts)
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('sched')
  })

  it('keeps the scheduled row but takes the join link off the mirror', () => {
    const out = mergeUpcomingCalls(
      [call({ meetingUrl: null })],
      [call({ meetingUrl: 'https://meet.example/abc' })],
      opts,
    )
    expect(out).toHaveLength(1)
    expect(out[0].source).toBe('scheduled')
    expect(out[0].meetingUrl).toBe('https://meet.example/abc')
  })

  it('does not let a stale mirror sort ahead of the row that moved', () => {
    const moved = new Date(T0 + 3 * 86_400_000).toISOString()
    const out = mergeUpcomingCalls(
      [call({ id: 'sched', scheduledAt: moved })],
      // A discovery row for the same meeting that was never updated.
      [call({ id: 'sched', scheduledAt: moved })],
      opts,
    )
    expect(out).toHaveLength(1)
    expect(out[0].scheduledAt).toBe(moved)
  })

  it('keeps two genuinely different meetings, soonest first', () => {
    const later = new Date(T0 + 3_600_000).toISOString()
    const out = mergeUpcomingCalls(
      [call({ id: 'a', scheduledAt: later, title: 'Check in' }), call({ id: 'b' })],
      [],
      opts,
    )
    expect(out.map(c => c.id)).toEqual(['b', 'a'])
  })

  it('treats the same title at a different instant as a different meeting', () => {
    const later = new Date(T0 + 3_600_000).toISOString()
    const out = mergeUpcomingCalls([call({ id: 'a' })], [call({ id: 'b', scheduledAt: later })], opts)
    expect(out).toHaveLength(2)
  })

  it('drops anything before the cutoff', () => {
    const out = mergeUpcomingCalls([call()], [], { cutoffMs: T0 + 1, limit: 5 })
    expect(out).toHaveLength(0)
  })

  it('drops an unparseable timestamp rather than sorting it arbitrarily', () => {
    const out = mergeUpcomingCalls([call({ scheduledAt: 'soonish' })], [], opts)
    expect(out).toHaveLength(0)
  })

  it('honours the limit after collapsing, not before', () => {
    const second = new Date(T0 + 3_600_000).toISOString()
    const out = mergeUpcomingCalls(
      [call({ id: 'a' }), call({ id: 'b', scheduledAt: second, title: 'Check in' })],
      [call({ id: 'a' }), call({ id: 'b', scheduledAt: second, title: 'Check in' })],
      { cutoffMs: opts.cutoffMs, limit: 2 },
    )
    expect(out.map(c => c.id)).toEqual(['a', 'b'])
  })

  it('ignores case and padding in the title when matching a pair', () => {
    const out = mergeUpcomingCalls([call({ title: 'Kickoff call' })], [call({ title: '  KICKOFF CALL ' })], opts)
    expect(out).toHaveLength(1)
  })
})
