import { describe, it, expect } from 'vitest'
import { isActiveTeamMember } from '@/lib/capacity-active-members'

describe('isActiveTeamMember', () => {
  it('includes a member with capacity who is not blocked', () => {
    expect(isActiveTeamMember({ email: 'liam@tahi.studio', weeklyCapacityHours: 40 }, ['nathan@tahi.studio'])).toBe(true)
  })

  it('excludes a member on the blocked addresses list', () => {
    // Beta audit, 2026-09-19: Nathan Day is blocked on the email gate and
    // still counted as a third of studio capacity.
    expect(isActiveTeamMember({ email: 'nathan@tahi.studio', weeklyCapacityHours: 40 }, ['nathan@tahi.studio'])).toBe(false)
  })

  it('compares blocked addresses case-insensitively', () => {
    expect(isActiveTeamMember({ email: 'Nathan@Tahi.Studio', weeklyCapacityHours: 40 }, ['nathan@tahi.studio'])).toBe(false)
  })

  it('compares blocked addresses alias-stripped, matching the email gate', () => {
    expect(isActiveTeamMember({ email: 'nathan+test@tahi.studio', weeklyCapacityHours: 40 }, ['nathan@tahi.studio'])).toBe(false)
  })

  it('excludes a member with weeklyCapacityHours 0', () => {
    expect(isActiveTeamMember({ email: 'liam@tahi.studio', weeklyCapacityHours: 0 }, [])).toBe(false)
  })

  it('excludes a member with weeklyCapacityHours null', () => {
    expect(isActiveTeamMember({ email: 'liam@tahi.studio', weeklyCapacityHours: null }, [])).toBe(false)
  })

  it('excludes a member with a negative weeklyCapacityHours', () => {
    expect(isActiveTeamMember({ email: 'liam@tahi.studio', weeklyCapacityHours: -5 }, [])).toBe(false)
  })

  it('includes every member when the blocked list is empty', () => {
    expect(isActiveTeamMember({ email: 'staci@tahi.studio', weeklyCapacityHours: 40 }, [])).toBe(true)
  })
})

import { resolveInactiveMemberEmails } from '@/lib/capacity-active-members'

describe('resolveInactiveMemberEmails', () => {
  it('reads a JSON array of addresses and drops blanks', () => {
    expect(resolveInactiveMemberEmails('["nathan@tahi.studio", "", 3]')).toEqual(['nathan@tahi.studio'])
  })

  it('is empty for a missing, blank or corrupt row, never a coded default', () => {
    expect(resolveInactiveMemberEmails(null)).toEqual([])
    expect(resolveInactiveMemberEmails('')).toEqual([])
    expect(resolveInactiveMemberEmails('not json')).toEqual([])
    expect(resolveInactiveMemberEmails('{"a":1}')).toEqual([])
  })
})
