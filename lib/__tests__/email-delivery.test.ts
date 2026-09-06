/**
 * lib/email-delivery.ts: who this platform is allowed to email.
 *
 * Liam's rule, 2026-09-06: no real client and no teammate receives anything
 * from this system until he has verified it, staci@ and nathan@ included. This
 * spec is that rule, written down. Every case here is one someone could
 * otherwise talk themselves into: "the row is missing so nothing is
 * restricted", "the setting says ALL so that must count", "a plus alias is a
 * different address", "the cc line is not really a recipient".
 *
 * The suppression writer is asserted too, because a gate whose log is silently
 * broken is a gate nobody can prove.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type Row = Record<string, unknown>

const send = vi.hoisted(() => vi.fn())
const inserted = vi.hoisted(() => ({ rows: [] as Row[], fail: false }))
const settingsRows = vi.hoisted(() => ({ rows: [] as Row[], throwOnRead: false }))

vi.mock('resend', () => ({
  Resend: class {
    emails = { send }
  },
}))

vi.mock('@/db/d1', () => ({
  schema: {
    settings: { key: 'settings.key', value: 'settings.value' },
    emailSuppressions: { createdAt: 'email_suppressions.created_at' },
  },
}))

vi.mock('drizzle-orm', () => ({
  desc: (col: unknown) => ({ __op: 'desc', col }),
}))

vi.mock('@/lib/db', () => ({
  db: vi.fn(async () => ({
    select: () => ({
      from: () => {
        if (settingsRows.throwOnRead) throw new Error('D1 unavailable')
        return Promise.resolve(settingsRows.rows)
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
  ALLOWED_DOMAINS_SETTING_KEY,
  ALLOWED_ORG_IDS_SETTING_KEY,
  DELIVERY_MODE_SETTING_KEY,
  deliverEmail,
  isRecipientAllowed,
  partitionRecipients,
  recipientDomain,
  resolveAllowedDomains,
  resolveAllowedOrgIds,
  resolveDeliveryMode,
  resolveDeliveryPolicy,
  type DeliveryPolicy,
} from '@/lib/email-delivery'

function setSettings(map: Record<string, string | null>): void {
  settingsRows.rows = Object.entries(map).map(([key, value]) => ({ key, value }))
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

  it('still delivers to tahi.studio with no settings rows at all', async () => {
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
    setSettings({ [ALLOWED_DOMAINS_SETTING_KEY]: '{not json' })
    expect(await deliverEmail(req())).toMatchObject({ blocked: true })
    expect(await deliverEmail(req({ to: 'business@tahi.studio' }))).toMatchObject({ success: true })
  })

  it('reads an empty domains array as tahi.studio, not as a gate that blocks everything', async () => {
    setSettings({ [ALLOWED_DOMAINS_SETTING_KEY]: '[]' })
    expect(await deliverEmail(req({ to: 'business@tahi.studio' }))).toMatchObject({ success: true })
  })

  it('falls back to the closed policy when the settings read itself throws', async () => {
    settingsRows.throwOnRead = true
    const policy = await resolveDeliveryPolicy()
    expect(policy).toEqual({ mode: 'allowlist', allowedDomains: ['tahi.studio'], allowedOrgIds: [] })
    expect(await deliverEmail(req())).toMatchObject({ blocked: true })
  })
})

// ---------------------------------------------------------------------------
// The domain rule
// ---------------------------------------------------------------------------

describe('the domain rule', () => {
  it('matches case-insensitively on both sides', async () => {
    setSettings({ [ALLOWED_DOMAINS_SETTING_KEY]: '["Tahi.Studio"]' })
    const res = await deliverEmail(req({ to: 'Liam@TAHI.studio' }))
    expect(res.success).toBe(true)
    // The address goes out exactly as the caller spelled it.
    expect(lastPayload().to).toEqual(['Liam@TAHI.studio'])
  })

  it('passes a plus alias, because the alias is in the local part', async () => {
    const res = await deliverEmail(req({ to: 'business+dummyclient@tahi.studio' }))
    expect(res.success).toBe(true)
    expect(res.suppressed).toEqual([])
  })

  it('reads the domain after the LAST @, so a local part cannot smuggle one in', () => {
    expect(recipientDomain('"jo@tahi.studio"@acme.com')).toBe('acme.com')
    expect(recipientDomain('Jo <jo@tahi.studio>')).toBe('tahi.studio')
    expect(recipientDomain('not-an-address')).toBeNull()
    expect(recipientDomain('@tahi.studio')).toBeNull()
    expect(recipientDomain('jo@')).toBeNull()
  })

  it('withholds an address it cannot parse rather than guessing', async () => {
    const res = await deliverEmail(req({ to: 'not-an-address' }))
    expect(res.blocked).toBe(true)
    expect(res.suppressed).toEqual(['not-an-address'])
  })

  it('does not treat a subdomain as the allowed domain', () => {
    const policy: DeliveryPolicy = {
      mode: 'allowlist',
      allowedDomains: ['tahi.studio'],
      allowedOrgIds: [],
    }
    expect(isRecipientAllowed('jo@mail.tahi.studio', policy)).toBe(false)
    expect(isRecipientAllowed('jo@tahi.studio.evil.com', policy)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The org exemption
// ---------------------------------------------------------------------------

describe('the org exemption', () => {
  it('delivers to an outside domain when the send carries an allowed org id', async () => {
    setSettings({ [ALLOWED_ORG_IDS_SETTING_KEY]: '["org-acme"]' })
    const res = await deliverEmail(req({ orgId: 'org-acme' }))
    expect(res.success).toBe(true)
    expect(res.suppressed).toEqual([])
  })

  it('withholds the same address when the send carries a different org', async () => {
    setSettings({ [ALLOWED_ORG_IDS_SETTING_KEY]: '["org-acme"]' })
    expect(await deliverEmail(req({ orgId: 'org-other' }))).toMatchObject({ blocked: true })
  })

  it('withholds the same address when the send carries no org at all', async () => {
    setSettings({ [ALLOWED_ORG_IDS_SETTING_KEY]: '["org-acme"]' })
    expect(await deliverEmail(req())).toMatchObject({ blocked: true })
  })

  it('matches an org id case-insensitively', async () => {
    setSettings({ [ALLOWED_ORG_IDS_SETTING_KEY]: '["ORG-Acme"]' })
    expect(await deliverEmail(req({ orgId: 'org-acme' }))).toMatchObject({ success: true })
  })
})

// ---------------------------------------------------------------------------
// Mixed lists
// ---------------------------------------------------------------------------

describe('a mixed recipient list', () => {
  it('delivers to the addresses that pass and withholds the rest', async () => {
    const res = await deliverEmail(req({
      to: ['business@tahi.studio', 'jo@acme.com', 'liam@tahi.studio'],
    }))
    expect(res.success).toBe(true)
    expect(lastPayload().to).toEqual(['business@tahi.studio', 'liam@tahi.studio'])
    expect(res.suppressed).toEqual(['jo@acme.com'])
    expect(res.suppressedCount).toBe(1)
  })

  it('filters cc and bcc by the same rule', async () => {
    const res = await deliverEmail(req({
      to: 'business@tahi.studio',
      cc: ['staci@tahi.studio', 'outside@acme.com'],
      bcc: ['someone@elsewhere.test'],
    }))
    expect(res.success).toBe(true)
    expect(lastPayload().cc).toEqual(['staci@tahi.studio'])
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

  it('partitions without mutating how the caller spelled the address', () => {
    const policy: DeliveryPolicy = {
      mode: 'allowlist',
      allowedDomains: ['tahi.studio'],
      allowedOrgIds: [],
    }
    expect(partitionRecipients([' Liam@Tahi.Studio ', 'jo@acme.com'], policy)).toEqual({
      allowed: ['Liam@Tahi.Studio'],
      suppressed: ['jo@acme.com'],
    })
  })
})
