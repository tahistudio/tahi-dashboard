import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  callReminderKey, claimCallReminder, dueRecordingReminders, isMyReminderCall,
  readRecordingPrefill, recordingReminderHref, reminderWithName,
  type CallReminderIdentity, type ReminderCall,
} from '@/lib/call-recording-reminders'

const identity: CallReminderIdentity = { teamMemberId: 'team-staci', userId: 'user-staci', email: 'staci@tahi.studio' }
const now = Date.parse('2026-10-14T21:00:00Z')
const call: ReminderCall = {
  kind: 'scheduled', id: 'b0f812f9-847e-4ed7-b0e3-47d64d9a5bcd', title: 'Acme check-in',
  scheduledAt: '2026-10-15T10:01:00+13:00', status: 'scheduled',
  attendees: JSON.stringify([
    { id: 'team-staci', type: 'team_member', name: 'Staci', email: 'staci@tahi.studio' },
    { id: 'contact-alex', type: 'contact', name: 'Alex', email: 'alex@acme.example' },
  ]),
}

function storageFixture() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
}

describe('recording call reminders', () => {
  it('uses actual team attendee identity, including case-insensitive calendar emails', () => {
    expect(isMyReminderCall(call, identity)).toBe(true)
    expect(isMyReminderCall({ ...call, attendees: [{ email: 'STACI@TAHI.STUDIO', role: 'host' }] }, identity)).toBe(true)
    expect(isMyReminderCall({ ...call, attendees: [{ id: identity.teamMemberId, type: 'contact', name: 'Staci' }] }, identity)).toBe(false)
    expect(isMyReminderCall({ ...call, attendees: [{ name: 'Staci' }] }, identity)).toBe(false)
    expect(isMyReminderCall({ ...call, attendees: 'invalid' }, identity)).toBe(false)
  })

  it('includes the creator without attendees but respects an explicit decline', () => {
    expect(isMyReminderCall({ ...call, attendees: [], createdById: identity.userId }, identity)).toBe(true)
    expect(isMyReminderCall({ ...call, attendees: [], createdById: identity.teamMemberId }, identity)).toBe(true)
    expect(isMyReminderCall({ ...call, attendees: [], createdById: 'user-liam' }, identity)).toBe(false)
    expect(isMyReminderCall({ ...call, createdById: identity.userId, attendees: [{ email: identity.email, responseStatus: 'declined' }] }, identity)).toBe(false)
  })

  it('prompts only for my scheduled calls between now and two minutes, using real instants', () => {
    const candidates = [
      call,
      { ...call, scheduledAt: '2026-10-14T21:00:00Z' },
      { ...call, scheduledAt: '2026-10-14T21:02:00Z' },
      { ...call, scheduledAt: '2026-10-14T20:59:59Z' },
      { ...call, scheduledAt: '2026-10-14T21:02:01Z' },
      { ...call, scheduledAt: 'invalid' },
      { ...call, status: 'cancelled' },
      { ...call, status: 'completed' },
      { ...call, attendees: [] },
      { ...call, id: '../bad' },
    ]
    expect(dueRecordingReminders(candidates, identity, now)).toEqual(candidates.slice(0, 3))
  })

  it('names a single guest and falls back to client/context for groups', () => {
    expect(reminderWithName(call, identity)).toBe('Alex')
    expect(reminderWithName({ ...call, attendees: [], orgName: 'Acme' }, identity)).toBe('Acme')
    expect(reminderWithName({ ...call, attendees: [{ name: 'Alex' }, { name: 'Sam' }], withName: 'Acme' }, identity)).toBe('Acme')
    expect(reminderWithName({ ...call, attendees: [], orgName: null, withName: null }, identity)).toBe('Acme check-in')
  })

  it('encodes the title and typed call link, rejecting unsafe or unsupported prefill ids', () => {
    const named = { ...call, title: 'Acme & Co / check-in?' }
    const href = recordingReminderHref(named)
    expect(href.startsWith('/calls/record?')).toBe(true)
    expect(readRecordingPrefill(new URL(href, 'https://portal.tahi.studio').searchParams))
      .toEqual({ title: named.title, callKey: `scheduled:${call.id}` })
    expect(readRecordingPrefill(new URLSearchParams('callKind=scheduled&callId=../bad'))).toBeNull()
    expect(readRecordingPrefill(new URLSearchParams(`callKind=unknown&callId=${call.id}`))).toBeNull()
    expect(readRecordingPrefill(new URLSearchParams(`callKind=discovery&callId=${call.id}&title=${'x'.repeat(250)}`))?.title).toHaveLength(200)
  })

  it('deduplicates mirrored tables and equivalent timezones, and allows a reschedule', () => {
    const mirror: ReminderCall = {
      ...call, kind: 'discovery', id: '97995c75-0f09-48bc-b77e-209498011e5d', scheduledAt: '2026-10-14T21:01:00Z',
      attendees: [{ role: 'host', email: identity.email }, { name: 'Alex', email: 'ALEX@ACME.EXAMPLE', role: 'contact' }],
    }
    expect(callReminderKey(mirror, identity)).toBe(callReminderKey(call, identity))
    expect(callReminderKey({ ...call, scheduledAt: '2026-10-14T22:01:00Z' }, identity)).not.toBe(callReminderKey(call, identity))
  })

  it('claims once across sessions, isolates users, repairs malformed state and expires old claims', () => {
    const storage = storageFixture()
    const key = callReminderKey(call, identity)
    expect(claimCallReminder(storage, identity.userId, key, now)).toBe(true)
    expect(claimCallReminder(storage, identity.userId, key, now + 30_000)).toBe(false)
    expect(claimCallReminder(storage, 'user-liam', key, now)).toBe(true)
    expect(claimCallReminder(storage, identity.userId, key, now + 8 * 86_400_000)).toBe(true)
    storage.setItem(`tahi:call-recording-reminders:${identity.userId}`, '{broken')
    expect(claimCallReminder(storage, identity.userId, key, now)).toBe(true)
  })
})

describe('Windows Chromium PWA manifest', () => {
  it('supplies an app identity, standalone scope, recorder shortcut and real 192/512 PNG icons', () => {
    const manifest = JSON.parse(readFileSync(resolve('public/manifest.json'), 'utf8')) as {
      id: string; name: string; short_name: string; start_url: string; scope: string; display: string
      icons: { src: string; sizes: string; type: string }[]
      shortcuts: { name: string; url: string }[]
    }
    expect(manifest).toMatchObject({ id: '/', name: 'Tahi Dashboard', short_name: 'Tahi', start_url: '/overview', scope: '/', display: 'standalone' })
    expect(manifest.shortcuts).toContainEqual(expect.objectContaining({ name: 'Record call', url: '/calls/record' }))
    for (const size of [192, 512]) {
      const icon = manifest.icons.find(candidate => candidate.sizes === `${size}x${size}`)
      expect(icon?.type).toBe('image/png')
      const bytes = readFileSync(resolve('public', icon!.src.slice(1)))
      expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([size, size])
    }
  })
})
