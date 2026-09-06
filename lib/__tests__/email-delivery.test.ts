/**
 * lib/email-delivery.ts: who this platform is allowed to email.
 *
 * Liam's rule, 2026-09-06: no real client and no teammate receives anything
 * from this system until he has verified it, staci@ and nathan@ included. This
 * spec is that rule, written down. Every case here is one someone could
 * otherwise talk themselves into: "the row is missing so nothing is
 * restricted", "the setting says ALL so that must count", "a plus alias is a
 * different address", "the cc line is not really a recipient", "tahi.studio is
 * the studio so everyone there is fine", "the client is exempted so the whole
 * send is".
 *
 * The suppression writer is asserted too, because a gate whose log is silently
 * broken is a gate nobody can prove.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type Row = Record<string, unknown>

const send = vi.hoisted(() => vi.fn())
const inserted = vi.hoisted(() => ({ rows: [] as Row[], fail: false }))
const settingsRows = vi.hoisted(() => ({ rows: [] as Row[], throwOnRead: false }))
/** The contacts resolveOrgRecipientScope finds for an exempted org. */
const orgContacts = vi.hoisted(() => ({ rows: [] as Row[] }))

vi.mock('resend', () => ({
  Resend: class {
    emails = { send }
  },
}))

vi.mock('@/db/d1', () => ({
  schema: {
    settings: { __table: 'settings', key: 'settings.key', value: 'settings.value' },
    contacts: { __table: 'contacts', orgId: 'contacts.org_id', email: 'contacts.email' },
    emailSuppressions: { __table: 'email_suppressions', createdAt: 'email_suppressions.created_at' },
  },
}))

vi.mock('drizzle-orm', () => ({
  desc: (col: unknown) => ({ __op: 'desc', col }),
  eq: (col: unknown, value: unknown) => ({ __op: 'eq', col, value }),
  inArray: (col: unknown, values: unknown) => ({ __op: 'inArray', col, values }),
}))

vi.mock('@/lib/db', () => ({
  db: vi.fn(async () => ({
    select: () => ({
      from: (table: { __table?: string }) => {
        if (table?.__table === 'contacts') {
          return { where: () => Promise.resolve(orgContacts.rows) }
        }
        if (settingsRows.throwOnRead) throw new Error('D1 unavailable')
        return { where: () => Promise.resolve(settingsRows.rows) }
      },
    }),
    insert: () => ({
      values: (rows: Row[]) => {
        if (inserted.fail) return Promise.reject(new Error('no such table: email_suppressions'))
        inserted.rows.push(...rows)
        return Promise.resolve(undefined)
      },
    }),
  })),
}))

import {
  ALLOWED_ADDRESSES_SETTING_KEY,
  ALLOWED_DOMAINS_SETTING_KEY,
  ALLOWED_ORG_IDS_SETTING_KEY,
  DELIVERY_MODE_SETTING_KEY,
  addressKey,
  deliverEmail,
  isRecipientAllowed,
  normaliseAddress,
  partitionRecipients,
  recipientDomain,
  resolveAllowedAddresses,
  resolveAllowedDomains,
  resolveAllowedOrgIds,
  resolveBlockedAddresses,
  resolveDeliveryMode,
  resolveDeliveryPolicy,
  type DeliveryPolicy,
} from '@/lib/email-delivery'

function setSettings(map: Record<string, string | null>): void {
  settingsRows.rows = Object.entries(map).map(([key, value]) => ({ key, value }))
}

/**
 * The domain rule on its own, with the address narrowing lifted.
 *
 * Most of this file predates `email.allowedAddresses`, whose default is Liam's
 * single mailbox. Cases that are about the DOMAIN layer say so by storing an
 * explicit empty address list, which is the deliberate "do not narrow by
 * address" state, rather than by quietly relying on a default.
 */
function domainRuleOnly(over: Record<string, string | null> = {}): void {
  setSettings({ [ALLOWED_ADDRESSES_SETTING_KEY]: '[]', ...over })
}

/** A policy built by hand, for the pure-function cases. */
function policyOf(over: Partial<DeliveryPolicy> = {}): DeliveryPolicy {
  return {
    mode: 'allowlist',
    allowedDomains: ['tahi.studio'],
    allowedOrgIds: [],
    allowedAddresses: [],
    blockedAddresses: [],
    ...over,
  }
}

/** The payload Resend was handed on the last accepted send. */
function lastPayload(): { to: string[]; cc?: string[]; bcc?: string[]; subject: string } {
  return send.mock.calls[send.mock.calls.length - 1][0]
}

const HTML = '<p>Your request is ready for your review.</p>'

function req(over: Partial<Parameters<typeof deliverEmail>[0]> = {}) {
  return {
    to: 'jo@acme.com',
    subject: 'Delivered',
    html: HTML,
    template: 'test',
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  send.mockResolvedValue({ data: { id: 'msg_1' }, error: null })
  inserted.rows = []
  inserted.fail = false
  settingsRows.rows = []
  settingsRows.throwOnRead = false
  orgContacts.rows = []
  vi.stubEnv('RESEND_API_KEY', 'test_key')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// ---------------------------------------------------------------------------
// Fail closed
// ---------------------------------------------------------------------------

describe('the default, when nobody has configured anything', () => {
  it('withholds an outside address with no settings rows at all', async () => {
    const res = await deliverEmail(req())
    expect(send).not.toHaveBeenCalled()
    expect(res.success).toBe(false)
    expect(res.blocked).toBe(true)
    expect(res.suppressed).toEqual(['jo@acme.com'])
    expect(res.suppressedCount).toBe(1)
  })

  it('still delivers to business@tahi.studio with no settings rows at all', async () => {
    const res = await deliverEmail(req({ to: 'business@tahi.studio' }))
    expect(res.success).toBe(true)
    expect(lastPayload().to).toEqual(['business@tahi.studio'])
  })

  it('reads a misspelled mode as the closed one rather than as "not allowlist"', async () => {
    setSettings({ [DELIVERY_MODE_SETTING_KEY]: 'ALL' })
    const res = await deliverEmail(req())
    expect(res.blocked).toBe(true)
    expect(send).not.toHaveBeenCalled()
  })

  it('reads a malformed domains list as tahi.studio rather than as "no restriction"', async () => {
    domainRuleOnly({ [ALLOWED_DOMAINS_SETTING_KEY]: '{not json' })
    expect(await deliverEmail(req())).toMatchObject({ blocked: true })
    expect(await deliverEmail(req({ to: 'liam@tahi.studio' }))).toMatchObject({ success: true })
  })

  it('reads an empty domains array as tahi.studio, not as a gate that blocks everything', async () => {
    domainRuleOnly({ [ALLOWED_DOMAINS_SETTING_KEY]: '[]' })
    expect(await deliverEmail(req({ to: 'liam@tahi.studio' }))).toMatchObject({ success: true })
  })

  it('falls back to the closed policy when the settings read itself throws', async () => {
    settingsRows.throwOnRead = true
    const policy = await resolveDeliveryPolicy()
    expect(policy).toEqual({
      mode: 'allowlist',
      allowedDomains: ['tahi.studio'],
      allowedOrgIds: [],
      allowedAddresses: ['business@tahi.studio'],
      blockedAddresses: ['staci@tahi.studio', 'nathan@tahi.studio'],
    })
    expect(await deliverEmail(req())).toMatchObject({ blocked: true })
  })
})

// ---------------------------------------------------------------------------
// The named people. The reason a domain rule was not enough.
// ---------------------------------------------------------------------------

describe('the never list', () => {
  it('withholds staci@ and nathan@ under the default policy, on their own domain', async () => {
    const res = await deliverEmail(req({ to: ['staci@tahi.studio', 'nathan@tahi.studio'] }))
    expect(send).not.toHaveBeenCalled()
    expect(res.blocked).toBe(true)
    expect(res.suppressed).toEqual(['staci@tahi.studio', 'nathan@tahi.studio'])
  })

  it('logs them under their own reason, not as a near miss on the allowlist', async () => {
    await deliverEmail(req({ to: 'staci@tahi.studio' }))
    expect(inserted.rows[0]).toMatchObject({
      to: 'staci@tahi.studio',
      reason: 'address_blocked',
    })
  })

  it('still withholds them once somebody widens the domain AND the address list', async () => {
    setSettings({
      [ALLOWED_ADDRESSES_SETTING_KEY]: '["staci@tahi.studio"]',
      [ALLOWED_DOMAINS_SETTING_KEY]: '["tahi.studio"]',
    })
    expect(await deliverEmail(req({ to: 'staci@tahi.studio' }))).toMatchObject({ blocked: true })
  })

  it('still withholds them in mode "all", because the never list is checked first', async () => {
    setSettings({ [DELIVERY_MODE_SETTING_KEY]: 'all' })
    const res = await deliverEmail(req({ to: ['jo@acme.com', 'staci@tahi.studio'] }))
    expect(res.success).toBe(true)
    expect(lastPayload().to).toEqual(['jo@acme.com'])
    expect(res.suppressed).toEqual(['staci@tahi.studio'])
  })

  it('is not sidestepped by a plus alias', async () => {
    expect(await deliverEmail(req({ to: 'staci+test@tahi.studio' }))).toMatchObject({ blocked: true })
  })

  it('is emptied only by storing an explicit empty array, never by clearing the row', () => {
    expect(resolveBlockedAddresses(undefined)).toEqual(['staci@tahi.studio', 'nathan@tahi.studio'])
    expect(resolveBlockedAddresses('')).toEqual(['staci@tahi.studio', 'nathan@tahi.studio'])
    expect(resolveBlockedAddresses('[]')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The address rule
// ---------------------------------------------------------------------------

describe('the address allowlist', () => {
  it('narrows the domain to one mailbox by default', async () => {
    expect(await deliverEmail(req({ to: 'business@tahi.studio' }))).toMatchObject({ success: true })
    const res = await deliverEmail(req({ to: 'someone-else@tahi.studio' }))
    expect(res.blocked).toBe(true)
    expect(res.suppressed).toEqual(['someone-else@tahi.studio'])
  })

  it('covers the plus aliases of a listed mailbox', async () => {
    const res = await deliverEmail(req({ to: 'business+dummyclient@tahi.studio' }))
    expect(res.success).toBe(true)
    expect(res.suppressed).toEqual([])
  })

  it('still requires the domain: being on the address list is not enough on its own', async () => {
    setSettings({ [ALLOWED_ADDRESSES_SETTING_KEY]: '["jo@acme.com"]' })
    expect(await deliverEmail(req({ to: 'jo@acme.com' }))).toMatchObject({ blocked: true })
  })

  it('falls back to the domain list when stored as an explicit empty array', async () => {
    domainRuleOnly()
    expect(await deliverEmail(req({ to: 'someone-else@tahi.studio' }))).toMatchObject({ success: true })
  })

  it('reads an absent row as the closed default, not as "no narrowing"', () => {
    expect(resolveAllowedAddresses(undefined)).toEqual(['business@tahi.studio'])
    expect(resolveAllowedAddresses('')).toEqual(['business@tahi.studio'])
    expect(resolveAllowedAddresses('[]')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The domain rule
// ---------------------------------------------------------------------------

describe('the domain rule', () => {
  it('matches case-insensitively on both sides', async () => {
    domainRuleOnly({ [ALLOWED_DOMAINS_SETTING_KEY]: '["Tahi.Studio"]' })
    const res = await deliverEmail(req({ to: 'Liam@TAHI.studio' }))
    expect(res.success).toBe(true)
    // The address goes out exactly as the caller spelled it.
    expect(lastPayload().to).toEqual(['Liam@TAHI.studio'])
  })

  it('reads the domain of a display-name address, and only of one address', () => {
    expect(recipientDomain('Jo <jo@tahi.studio>')).toBe('tahi.studio')
    expect(recipientDomain('jo@acme.com')).toBe('acme.com')
    expect(recipientDomain('not-an-address')).toBeNull()
    expect(recipientDomain('@tahi.studio')).toBeNull()
    expect(recipientDomain('jo@')).toBeNull()
    // A quoted local part holding an '@' is two '@' in the string, and two is
    // not one address. Withheld rather than parsed.
    expect(recipientDomain('"jo@tahi.studio"@acme.com')).toBeNull()
  })

  it('withholds an address it cannot parse rather than guessing', async () => {
    const res = await deliverEmail(req({ to: 'not-an-address' }))
    expect(res.blocked).toBe(true)
    expect(res.suppressed).toEqual(['not-an-address'])
  })

  it('does not treat a subdomain as the allowed domain', () => {
    const policy = policyOf()
    expect(isRecipientAllowed('jo@mail.tahi.studio', policy)).toBe(false)
    expect(isRecipientAllowed('jo@tahi.studio.evil.com', policy)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// One string, one address
// ---------------------------------------------------------------------------

describe('an entry holding more than one address', () => {
  it('never reaches Resend, even though it ends with an allowed domain', async () => {
    domainRuleOnly()
    const res = await deliverEmail(req({ to: 'jo@acme.com, business@tahi.studio' }))
    expect(send).not.toHaveBeenCalled()
    expect(res.blocked).toBe(true)
    expect(res.suppressed).toEqual(['jo@acme.com, business@tahi.studio'])
  })

  it('is logged as "not an address", so the log says what actually happened', async () => {
    await deliverEmail(req({ to: 'jo@acme.com, business@tahi.studio' }))
    expect(inserted.rows[0]).toMatchObject({ reason: 'not_an_address' })
  })

  it('refuses a semicolon list and a display name hiding a second address', () => {
    expect(normaliseAddress('a@x.com; b@tahi.studio')).toBeNull()
    expect(normaliseAddress('a@x.com, Jo <jo@tahi.studio>')).toBeNull()
    expect(normaliseAddress('<a@x.com><b@tahi.studio>')).toBeNull()
    expect(normaliseAddress('Jo Bloggs <jo@tahi.studio>')).toBe('jo@tahi.studio')
  })

  it('refuses the same shape on the cc line', async () => {
    domainRuleOnly()
    const res = await deliverEmail(req({
      to: 'liam@tahi.studio',
      cc: ['sam@tahi.studio, spy@acme.com'],
    }))
    expect(res.success).toBe(true)
    expect(lastPayload().cc).toBeUndefined()
    expect(res.suppressed).toEqual(['sam@tahi.studio, spy@acme.com'])
  })
})

// ---------------------------------------------------------------------------
// The org exemption
// ---------------------------------------------------------------------------

describe('the org exemption', () => {
  it('delivers to a contact of the exempted client, on their own outside domain', async () => {
    setSettings({ [ALLOWED_ORG_IDS_SETTING_KEY]: '["org-acme"]' })
    orgContacts.rows = [{ email: 'jo@acme.com' }]
    const res = await deliverEmail(req({ orgId: 'org-acme' }))
    expect(res.success).toBe(true)
    expect(res.suppressed).toEqual([])
  })

  it('DOES NOT open the whole send: a cc to a stranger is still withheld', async () => {
    setSettings({ [ALLOWED_ORG_IDS_SETTING_KEY]: '["org-acme"]' })
    orgContacts.rows = [{ email: 'jo@acme.com' }]
    const res = await deliverEmail(req({
      orgId: 'org-acme',
      cc: ['prospect@competitor.test'],
      bcc: ['someone@gmail.test'],
    }))
    expect(res.success).toBe(true)
    expect(lastPayload().cc).toBeUndefined()
    expect(lastPayload().bcc).toBeUndefined()
    expect(res.suppressed).toEqual(['prospect@competitor.test', 'someone@gmail.test'])
  })

  it('withholds an address at the exempted client that is not one of their contacts', async () => {
    setSettings({ [ALLOWED_ORG_IDS_SETTING_KEY]: '["org-acme"]' })
    orgContacts.rows = [{ email: 'jo@acme.com' }]
    expect(await deliverEmail(req({ to: 'stranger@acme.com', orgId: 'org-acme' })))
      .toMatchObject({ blocked: true })
  })

  it('matches a contact through a plus alias', async () => {
    setSettings({ [ALLOWED_ORG_IDS_SETTING_KEY]: '["org-acme"]' })
    orgContacts.rows = [{ email: 'Jo@Acme.com' }]
    expect(await deliverEmail(req({ to: 'jo+portal@acme.com', orgId: 'org-acme' })))
      .toMatchObject({ success: true })
  })

  it('withholds the same address when the send carries a different org', async () => {
    setSettings({ [ALLOWED_ORG_IDS_SETTING_KEY]: '["org-acme"]' })
    orgContacts.rows = [{ email: 'jo@acme.com' }]
    expect(await deliverEmail(req({ orgId: 'org-other' }))).toMatchObject({ blocked: true })
  })

  it('withholds the same address when the send carries no org at all', async () => {
    setSettings({ [ALLOWED_ORG_IDS_SETTING_KEY]: '["org-acme"]' })
    expect(await deliverEmail(req())).toMatchObject({ blocked: true })
  })

  it('matches an org id case-insensitively', async () => {
    setSettings({ [ALLOWED_ORG_IDS_SETTING_KEY]: '["ORG-Acme"]' })
    orgContacts.rows = [{ email: 'jo@acme.com' }]
    expect(await deliverEmail(req({ orgId: 'org-acme' }))).toMatchObject({ success: true })
  })

  it('never reaches the never list: an exempted client cannot mail a blocked address', () => {
    const policy = policyOf({
      allowedOrgIds: ['org-acme'],
      blockedAddresses: ['staci@tahi.studio'],
    })
    const scope = { orgId: 'org-acme', orgAddresses: ['staci@tahi.studio'] }
    expect(isRecipientAllowed('staci@tahi.studio', policy, scope)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Mixed lists
// ---------------------------------------------------------------------------

describe('a mixed recipient list', () => {
  it('delivers to the addresses that pass and withholds the rest', async () => {
    domainRuleOnly()
    const res = await deliverEmail(req({
      to: ['business@tahi.studio', 'jo@acme.com', 'liam@tahi.studio'],
    }))
    expect(res.success).toBe(true)
    expect(lastPayload().to).toEqual(['business@tahi.studio', 'liam@tahi.studio'])
    expect(res.suppressed).toEqual(['jo@acme.com'])
    expect(res.suppressedCount).toBe(1)
  })

  it('filters cc and bcc by the same rule', async () => {
    domainRuleOnly()
    const res = await deliverEmail(req({
      to: 'business@tahi.studio',
      cc: ['sam@tahi.studio', 'outside@acme.com'],
      bcc: ['someone@elsewhere.test'],
    }))
    expect(res.success).toBe(true)
    expect(lastPayload().cc).toEqual(['sam@tahi.studio'])
    expect(lastPayload().bcc).toBeUndefined()
    expect(res.suppressed).toEqual(['outside@acme.com', 'someone@elsewhere.test'])
  })

  it('sends nothing when every to address is withheld, even if a cc survives', async () => {
    const res = await deliverEmail(req({
      to: 'jo@acme.com',
      cc: ['business@tahi.studio'],
    }))
    expect(send).not.toHaveBeenCalled()
    expect(res.blocked).toBe(true)
    expect(res.error).toContain('allowlist')
  })

  it('ignores blank entries instead of logging them as withheld', async () => {
    const res = await deliverEmail(req({ to: ['business@tahi.studio', '  ', ''] }))
    expect(res.success).toBe(true)
    expect(res.suppressed).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// "Held back" has to mean held back
// ---------------------------------------------------------------------------

describe('a send with no usable recipient at all', () => {
  it('is not reported as blocked, because the allowlist withheld nobody', async () => {
    const res = await deliverEmail(req({ to: ['   ', ''] }))
    expect(send).not.toHaveBeenCalled()
    expect(res.success).toBe(false)
    expect(res.error).toBe('No recipients.')
    // Callers turn `blocked` into a 409 titled "Held back by the email
    // allowlist" and point the operator at a settings page. Nothing here was
    // held back: nothing was supplied.
    expect(res.blocked).toBe(false)
    expect(res.suppressed).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Mode: all
// ---------------------------------------------------------------------------

describe('mode "all"', () => {
  it('delivers to any address once someone stores exactly "all"', async () => {
    setSettings({ [DELIVERY_MODE_SETTING_KEY]: 'all' })
    const res = await deliverEmail(req({ to: ['jo@acme.com', 'someone@elsewhere.test'] }))
    expect(res.success).toBe(true)
    expect(lastPayload().to).toEqual(['jo@acme.com', 'someone@elsewhere.test'])
    expect(res.suppressed).toEqual([])
    expect(inserted.rows).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// The log
// ---------------------------------------------------------------------------

describe('the suppression log', () => {
  it('writes one row per withheld recipient, with the template and the subject', async () => {
    await deliverEmail(req({
      to: ['jo@acme.com', 'sam@acme.com'],
      subject: 'Invoice INV-1 from Tahi Studio',
      template: 'invoice-sent',
      orgId: 'org-acme',
    }))
    expect(inserted.rows).toHaveLength(2)
    expect(inserted.rows[0]).toMatchObject({
      to: 'jo@acme.com',
      orgId: 'org-acme',
      template: 'invoice-sent',
      subject: 'Invoice INV-1 from Tahi Studio',
      reason: 'not_in_allowlist',
    })
    expect(inserted.rows[1]).toMatchObject({ to: 'sam@acme.com' })
  })

  it('records the suppression even with no Resend key, so the gate is provable offline', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    const res = await deliverEmail(req())
    expect(inserted.rows).toHaveLength(1)
    expect(res.blocked).toBe(true)
  })

  it('still withholds when the log write fails', async () => {
    inserted.fail = true
    const res = await deliverEmail(req())
    expect(send).not.toHaveBeenCalled()
    expect(res.blocked).toBe(true)
  })

  it('writes nothing when every recipient passes', async () => {
    await deliverEmail(req({ to: 'business@tahi.studio' }))
    expect(inserted.rows).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Everything downstream of the gate
// ---------------------------------------------------------------------------

describe('the send itself', () => {
  it('reports a missing API key without pretending the mail went', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    const res = await deliverEmail(req({ to: 'business@tahi.studio' }))
    expect(res).toMatchObject({ success: false, error: 'RESEND_API_KEY not configured', blocked: false })
  })

  it('refuses a request that carries neither react nor html', async () => {
    const res = await deliverEmail({
      to: 'business@tahi.studio',
      subject: 'Empty',
      template: 'test',
    })
    expect(res.success).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })

  it('returns the Resend message id so a bounce can be traced to a row', async () => {
    const res = await deliverEmail(req({ to: 'business@tahi.studio' }))
    expect(res.messageId).toBe('msg_1')
  })

  it('surfaces a Resend error rather than reporting a send', async () => {
    send.mockResolvedValue({ data: null, error: { message: 'Too many requests' } })
    const res = await deliverEmail(req({ to: 'business@tahi.studio' }))
    expect(res).toMatchObject({ success: false, error: 'Too many requests' })
  })

  it('survives a thrown Resend client', async () => {
    send.mockRejectedValue(new Error('socket hang up'))
    const res = await deliverEmail(req({ to: 'business@tahi.studio' }))
    expect(res).toMatchObject({ success: false, error: 'socket hang up' })
  })

  it('honours a pre-resolved policy without reading the settings table again', async () => {
    // A fan-out reads the policy once and hands it down. Proved by making the
    // settings read throw: if the passed policy were ignored, the closed
    // fallback would withhold this address.
    settingsRows.throwOnRead = true
    const res = await deliverEmail(req({
      to: 'jo@acme.com',
      policy: policyOf({ mode: 'all' }),
    }))
    expect(res.success).toBe(true)
    expect(lastPayload().to).toEqual(['jo@acme.com'])
  })
})

// ---------------------------------------------------------------------------
// The resolvers, on their own
// ---------------------------------------------------------------------------

describe('the resolvers', () => {
  it('reads every non-"all" mode as allowlist', () => {
    for (const stored of [undefined, null, '', 'ALL', 'everyone', 'true', 42]) {
      expect(resolveDeliveryMode(stored)).toBe('allowlist')
    }
    expect(resolveDeliveryMode('all')).toBe('all')
  })

  it('lower-cases and trims both lists, and drops non-strings', () => {
    expect(resolveAllowedDomains('[" Tahi.Studio ", 7, ""]')).toEqual(['tahi.studio'])
    expect(resolveAllowedOrgIds('["ORG-1"," org-2 "]')).toEqual(['org-1', 'org-2'])
  })

  it('honours an empty org list rather than substituting a default', () => {
    expect(resolveAllowedOrgIds('[]')).toEqual([])
    expect(resolveAllowedOrgIds(undefined)).toEqual([])
  })

  it('stores an address list alias-stripped, so a listed mailbox covers its aliases', () => {
    expect(resolveAllowedAddresses('["Business+Dummy@Tahi.Studio"]')).toEqual(['business@tahi.studio'])
    expect(addressKey('Business+Anything@Tahi.Studio')).toBe('business@tahi.studio')
  })

  it('partitions without mutating how the caller spelled the address', () => {
    expect(partitionRecipients([' Liam@Tahi.Studio ', 'jo@acme.com'], policyOf())).toEqual({
      allowed: ['Liam@Tahi.Studio'],
      suppressed: ['jo@acme.com'],
    })
  })
})
