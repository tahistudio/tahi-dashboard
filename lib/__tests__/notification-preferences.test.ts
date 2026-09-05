/**
 * One preference resolver, two channels.
 *
 * The exact row / per-user '*' / channel policy order used to exist twice: once
 * here for the bell and once, copied, inside lib/notification-email for the
 * inbox. These tests drive both entry points over the same fake read so the two
 * can never answer differently again.
 */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_ENABLED,
  PREF_EVENT_TYPES,
  filterRecipientsByChannelPref,
  filterRecipientsByInAppPref,
  filterSubjectsByChannelPref,
} from '@/lib/notification-preferences'

type Row = Record<string, unknown>
type Chain = Promise<Row[]> & { where: () => Chain }

/** A database that answers the one batched preference read. */
function prefDb(rows: Row[], onSelect?: () => void) {
  const chain = Promise.resolve(rows) as Chain
  chain.where = () => chain
  return {
    select: () => {
      onSelect?.()
      return { from: () => chain }
    },
  } as never
}

function row(
  userId: string,
  eventType: string,
  channel: string,
  enabled: boolean,
  userType = 'team_member',
): Row {
  return { userId, userType, eventType, channel, enabled }
}

const liam = { userId: 'user_liam', userType: 'team_member' as const }
const staci = { userId: 'user_staci', userType: 'team_member' as const }

describe('filterRecipientsByChannelPref', () => {
  it('asks the database once for the whole audience', async () => {
    let selects = 0
    const db = prefDb([], () => { selects += 1 })
    await filterRecipientsByChannelPref(db, [liam, staci], 'new_message', 'in_app')
    expect(selects).toBe(1)
  })

  it('drops the person who muted this event', async () => {
    const db = prefDb([row('user_liam', 'new_message', 'in_app', false)])
    const kept = await filterRecipientsByChannelPref(db, [liam, staci], 'new_message', 'in_app')
    expect(kept.map((r) => r.userId)).toEqual(['user_staci'])
  })

  it('honours a per-user default, and lets an exact row beat it', async () => {
    const db = prefDb([
      row('user_liam', '*', 'in_app', false),
      row('user_staci', '*', 'in_app', false),
      row('user_staci', 'new_message', 'in_app', true),
    ])
    const kept = await filterRecipientsByChannelPref(db, [liam, staci], 'new_message', 'in_app')
    expect(kept.map((r) => r.userId)).toEqual(['user_staci'])
  })

  it('applies the channel policy when nobody stored anything', async () => {
    const db = prefDb([])
    expect(await filterRecipientsByChannelPref(db, [liam], 'new_message', 'in_app')).toHaveLength(1)
    // Slack is off unless somebody says otherwise, so an empty store is a no.
    expect(DEFAULT_ENABLED.slack).toBe(false)
    expect(await filterRecipientsByChannelPref(db, [liam], 'new_message', 'slack')).toHaveLength(0)
  })

  it('fails open when the read throws', async () => {
    const broken = { select: () => { throw new Error('D1 unavailable') } } as never
    const kept = await filterRecipientsByChannelPref(broken, [liam, staci], 'new_message', 'in_app')
    expect(kept).toHaveLength(2)
  })

  it('is what the bell wrapper calls', async () => {
    // The in_app wrapper must read the in_app rows, not another channel's.
    const db = prefDb([
      row('user_liam', 'new_message', 'email', false),
      row('user_liam', 'new_message', 'in_app', true),
    ])
    const kept = await filterRecipientsByInAppPref(db, [liam], 'new_message')
    expect(kept).toHaveLength(1)
  })
})

describe('filterSubjectsByChannelPref', () => {
  const jo = { clerkUserId: 'user_jo', userType: 'contact' as const }
  const sam = { clerkUserId: 'user_sam', userType: 'contact' as const }
  const invited = { clerkUserId: null, userType: 'contact' as const }

  it('never queries for people who cannot have a preference row', async () => {
    let selects = 0
    const db = prefDb([], () => { selects += 1 })
    const { allowed, muted } = await filterSubjectsByChannelPref(db, [invited], 'new_message', 'email')
    expect(selects).toBe(0)
    expect(allowed).toEqual([invited])
    expect(muted).toBe(0)
  })

  it('still applies the channel policy to an audience with no logins', async () => {
    let selects = 0
    const db = prefDb([], () => { selects += 1 })
    // Slack defaults off, so an audience nobody could have opted in for is not
    // an audience to send to. The same shortcut in the recipient filter was the
    // bug this pins.
    const { allowed, muted } = await filterSubjectsByChannelPref(db, [invited], 'new_message', 'slack')
    expect(selects).toBe(0)
    expect(allowed).toEqual([])
    expect(muted).toBe(1)
  })

  it('keeps an invited contact who has never signed in, alongside a muted one', async () => {
    const db = prefDb([row('user_jo', 'new_message', 'email', false, 'contact')])
    const { allowed, muted } = await filterSubjectsByChannelPref(
      db, [jo, sam, invited], 'new_message', 'email',
    )
    expect(allowed).toEqual([sam, invited])
    expect(muted).toBe(1)
  })

  it('respects the user type, so two people sharing an id do not collide', async () => {
    const db = prefDb([row('user_jo', 'new_message', 'email', false, 'team_member')])
    const { allowed } = await filterSubjectsByChannelPref(db, [jo], 'new_message', 'email')
    // The stored row belongs to a team member; jo is a contact.
    expect(allowed).toEqual([jo])
  })

  it('fails open when the read throws', async () => {
    const broken = { select: () => { throw new Error('D1 unavailable') } } as never
    const { allowed, muted } = await filterSubjectsByChannelPref(broken, [jo, sam], 'new_message', 'email')
    expect(allowed).toHaveLength(2)
    expect(muted).toBe(0)
  })
})

describe('PREF_EVENT_TYPES', () => {
  it('holds every event the settings endpoints are allowed to store', () => {
    expect(PREF_EVENT_TYPES).toContain('request_status_changed')
    expect(PREF_EVENT_TYPES).toContain('request_assigned')
    expect(PREF_EVENT_TYPES).toContain('new_message')
    // No duplicates: the endpoints validate membership, the UI renders order.
    expect(new Set(PREF_EVENT_TYPES).size).toBe(PREF_EVENT_TYPES.length)
  })
})
