import { describe, expect, it } from 'vitest'
import { filterRecorderUpcomingCalls, recorderMeetingPlatform } from '@/lib/recorder-upcoming-calls'

const NOW = Date.parse('2026-10-14T00:00:00Z')
function candidate(changes = {}) {
  return { id: 'call', title: 'Planning', scheduledAt: '2026-10-14T13:00:00+13:00', durationMinutes: 30,
    status: 'scheduled', attendees: '[{"email":"business@tahi.studio"}]', meetingUrl: 'https://meet.google.com/secret-room', ...changes }
}

describe('tray upcoming calls', () => {
  it('compares parsed instants across timezone offsets and omits raw URLs and attendee details', () => {
    const items = filterRecorderUpcomingCalls([candidate()], 'discovery', ' BUSINESS@TAHI.STUDIO ', NOW)
    expect(items).toEqual([{ id: 'call', kind: 'discovery', title: 'Planning', startMs: NOW,
      endMs: NOW + 1_800_000, platform: 'meet' }])
    expect(JSON.stringify(items)).not.toContain('secret-room')
    expect(JSON.stringify(items)).not.toContain('business@')
  })

  it('uses inclusive two-minutes-past and fifteen-minutes-ahead limits', () => {
    const rows = [-120_001, -120_000, 900_000, 900_001].map(offset => candidate({
      id: String(offset), scheduledAt: new Date(NOW + offset).toISOString(),
    }))
    expect(filterRecorderUpcomingCalls(rows, 'scheduled', 'business@tahi.studio', NOW).map(row => row.id)).toEqual(['-120000', '900000'])
  })

  it('filters cancelled calls, invalid times, non-positive duration and other attendees', () => {
    const rows = [candidate({ status: 'cancelled' }), candidate({ scheduledAt: 'bad' }), candidate({ durationMinutes: 0 }),
      candidate({ attendees: '[{"email":"staci@tahi.studio"}]' }), candidate({ attendees: 'broken' }),
      candidate({ attendees: '{"email":"business@tahi.studio"}' }), candidate({ attendees: '["business@tahi.studio"]' })]
    expect(filterRecorderUpcomingCalls(rows, 'discovery', 'business@tahi.studio', NOW)).toEqual([])
    expect(filterRecorderUpcomingCalls([candidate()], 'scheduled', '', NOW)).toEqual([])
  })

  it('derives platforms from exact hostnames rather than substrings', () => {
    expect(recorderMeetingPlatform('https://company.zoom.us/j/123')).toBe('zoom')
    expect(recorderMeetingPlatform('https://teams.microsoft.com/l/meetup-join/secret')).toBe('teams')
    expect(recorderMeetingPlatform('https://meet.google.com.evil.example')).toBe('unknown')
    expect(recorderMeetingPlatform('https://evil.example/zoom.us')).toBe('unknown')
    expect(recorderMeetingPlatform(null)).toBe('unknown')
  })
})
