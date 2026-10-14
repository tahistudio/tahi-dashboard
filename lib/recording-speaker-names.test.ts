import { describe, expect, it } from 'vitest'
import { recordingSpeakerNames } from './recording-speaker-names'

const team = [
  { id: 'liam', clerkUserId: 'clerk-liam', name: 'Liam Miller', email: 'business@tahi.studio' },
  { id: 'staci', clerkUserId: 'clerk-staci', name: 'Staci Miller', email: 'staci@tahi.studio' },
]

describe('recording speaker names', () => {
  it('resolves the recording creator through Clerk or team identity and defaults to Me', () => {
    expect(recordingSpeakerNames('clerk-staci', team, []).mic).toBe('Staci Miller')
    expect(recordingSpeakerNames('liam', team, []).mic).toBe('Liam Miller')
    expect(recordingSpeakerNames('unknown', team, []).mic).toBe('Me')
  })

  it('uses the sole non-team attendee across discovery and scheduled attendee formats', () => {
    expect(recordingSpeakerNames('clerk-liam', team, JSON.stringify([
      { name: 'Liam Miller', email: ' BUSINESS@TAHI.STUDIO ', role: 'host' },
      { name: ' Michael Day ', email: 'michael@giant.example', role: 'guest' },
    ]), 'Giant Group')).toEqual({ mic: 'Liam Miller', system: 'Michael Day' })
    expect(recordingSpeakerNames('staci', team, [
      { id: 'staci', type: 'team_member', name: 'Staci Miller' },
      { id: 'contact-1', type: 'contact', name: 'Michael Day' },
    ]).system).toBe('Michael Day')
  })

  it('excludes name-only team attendees and deduplicates one attendee email', () => {
    expect(recordingSpeakerNames('liam', team, [
      { name: 'Liam Miller' }, { name: 'Michael Day', email: 'michael@giant.example' },
      { name: 'Michael Day', email: 'MICHAEL@giant.example' },
    ]).system).toBe('Michael Day')
  })

  it('excludes every Tahi email even when the attendee has no team record', () => {
    expect(recordingSpeakerNames('liam', team, [
      { name: 'New teammate', email: ' NEW@TAHI.STUDIO ', type: 'contact' },
      { name: 'Michael Day', email: 'michael@giant.example' },
    ]).system).toBe('Michael Day')
    expect(recordingSpeakerNames('liam', team, [
      { name: 'New teammate', email: 'new@tahi.studio' },
    ], 'Acme').system).toBe('Them (Acme)')
  })

  it('falls back to the explicit client when remote identity is absent or ambiguous', () => {
    const guests = [{ name: 'Michael Day' }, { name: 'Mark Ramsey' }]
    expect(recordingSpeakerNames('liam', team, guests, 'Acme').system).toBe('Them (Acme)')
    expect(recordingSpeakerNames('liam', team, [{ email: 'guest@example.com' }], 'Acme').system).toBe('Them (Acme)')
    expect(recordingSpeakerNames('liam', team, [], 'Acme').system).toBe('Them (Acme)')
    expect(recordingSpeakerNames('liam', team, guests).system).toBe('Them')
  })

  it('ignores malformed attendees safely without inventing a name', () => {
    expect(recordingSpeakerNames('liam', team, '{bad}', 'Acme').system).toBe('Them (Acme)')
    expect(recordingSpeakerNames('liam', team, { name: 'Michael Day' }).system).toBe('Them')
    expect(recordingSpeakerNames('liam', team, [null, 1, {}, { type: 'team_member', name: 'A teammate' }]).system).toBe('Them')
  })
})
