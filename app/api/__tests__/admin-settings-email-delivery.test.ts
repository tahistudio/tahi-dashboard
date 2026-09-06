/**
 * The five email delivery keys, GET and PATCH on /api/admin/settings.
 *
 * Contract:
 *   GET   answers all five, always, in their RESOLVED form. An absent
 *         `email.deliveryMode` row means the allowlist is ON, and a UI that
 *         showed an empty box there would read as "no restriction" when the
 *         truth is the exact opposite. The lists come back re-serialised, so a
 *         reader sees the list the SENDER will apply and not the one somebody
 *         typed.
 *   PATCH refuses a value the sender could not act on, and accepts the empty
 *         value as the clear, which is safe precisely because clearing the
 *         mode turns the gate ON rather than off.
 *
 * AND WHO MAY WRITE THEM. Widening the gate is the most consequential write in
 * this system and it was the least protected: isTahiAdmin alone, which every
 * member of the Tahi Clerk org passes and so does the MCP service token, while
 * DELETE /api/admin/email-suppressions (which only destroys evidence) was
 * already super admin. The two were the wrong way round. Closing the gate
 * stays open to any admin: nobody needs a second signature to make this system
 * send less mail.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

const state: { rows: Row[]; updates: Row[]; inserts: Row[]; isSuperAdmin: boolean } = {
  rows: [],
  updates: [],
  inserts: [],
  isSuperAdmin: true,
}

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({
    userId: 'user_admin',
    orgId: 'org_tahi',
    sessionId: 'sess_1',
  }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/db/d1', () => ({
  schema: { settings: { key: 'settings.key', value: 'settings.value' } },
}))

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ __op: 'eq', col, val }),
}))

vi.mock('@/lib/permissions', () => ({
  resolvePermissions: vi.fn(async () => ({ isSuperAdmin: state.isSuperAdmin })),
}))

const auditRows: Row[] = []
vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn(async (_db: unknown, entry: Row) => { auditRows.push(entry) }),
}))

function chain(result: Row[]) {
  const node = {
    where: () => chain(result),
    limit: () => chain(result),
    then: <T>(onOk: (r: Row[]) => T, onErr?: (e: unknown) => T) =>
      Promise.resolve(result).then(onOk, onErr),
  }
  return node
}

vi.mock('@/lib/db', () => ({
  db: vi.fn().mockResolvedValue({
    select: () => ({ from: () => chain(state.rows) }),
    update: () => ({
      set: (patch: Row) => {
        state.updates.push(patch)
        return { where: () => Promise.resolve(undefined) }
      },
    }),
    insert: () => ({
      values: (row: Row) => {
        state.inserts.push(row)
        return Promise.resolve(undefined)
      },
    }),
  }),
}))

import { GET, PATCH } from '@/app/api/admin/settings/route'
import { NextRequest } from 'next/server'
import {
  ALLOWED_ADDRESSES_SETTING_KEY,
  ALLOWED_DOMAINS_SETTING_KEY,
  ALLOWED_ORG_IDS_SETTING_KEY,
  BLOCKED_ADDRESSES_SETTING_KEY,
  DELIVERY_MODE_SETTING_KEY,
} from '@/lib/email-allowlist'

const getReq = () => new NextRequest('http://localhost:3000/api/admin/settings')

function patchReq(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function settings(): Promise<Record<string, string | null>> {
  const body = await (await GET(getReq())).json() as { settings: Record<string, string | null> }
  return body.settings
}

async function patchStatus(body: Record<string, unknown>): Promise<number> {
  return (await PATCH(patchReq(body))).status
}

beforeEach(() => {
  state.rows = []
  state.updates = []
  state.inserts = []
  state.isSuperAdmin = true
  auditRows.length = 0
})

describe('GET fills the delivery keys in with the closed default', () => {
  it('answers allowlist and tahi.studio when there is no row at all', async () => {
    const s = await settings()
    expect(s[DELIVERY_MODE_SETTING_KEY]).toBe('allowlist')
    expect(s[ALLOWED_DOMAINS_SETTING_KEY]).toBe('["tahi.studio"]')
    expect(s[ALLOWED_ORG_IDS_SETTING_KEY]).toBe('[]')
  })

  it('answers the address layers too, with Liam alone allowed and the two names blocked', async () => {
    const s = await settings()
    expect(s[ALLOWED_ADDRESSES_SETTING_KEY]).toBe('["business@tahi.studio"]')
    expect(s[BLOCKED_ADDRESSES_SETTING_KEY])
      .toBe('["staci@tahi.studio","nathan@tahi.studio"]')
  })

  it('reads a cleared never list as the two named people, not as an empty one', async () => {
    state.rows = [{ key: BLOCKED_ADDRESSES_SETTING_KEY, value: null }]
    expect((await settings())[BLOCKED_ADDRESSES_SETTING_KEY])
      .toBe('["staci@tahi.studio","nathan@tahi.studio"]')
  })

  it('reads a cleared mode row as allowlist, not as an empty value', async () => {
    state.rows = [{ key: DELIVERY_MODE_SETTING_KEY, value: null }]
    expect((await settings())[DELIVERY_MODE_SETTING_KEY]).toBe('allowlist')
  })

  it('reads a garbage mode row as allowlist', async () => {
    state.rows = [{ key: DELIVERY_MODE_SETTING_KEY, value: 'EVERYONE' }]
    expect((await settings())[DELIVERY_MODE_SETTING_KEY]).toBe('allowlist')
  })

  it('returns the stored mode when it is one this platform understands', async () => {
    state.rows = [{ key: DELIVERY_MODE_SETTING_KEY, value: 'all' }]
    expect((await settings())[DELIVERY_MODE_SETTING_KEY]).toBe('all')
  })

  it('normalises the stored lists rather than echoing them', async () => {
    state.rows = [
      { key: ALLOWED_DOMAINS_SETTING_KEY, value: '[" Tahi.Studio "]' },
      { key: ALLOWED_ORG_IDS_SETTING_KEY, value: '["ORG-A"]' },
    ]
    const s = await settings()
    expect(s[ALLOWED_DOMAINS_SETTING_KEY]).toBe('["tahi.studio"]')
    expect(s[ALLOWED_ORG_IDS_SETTING_KEY]).toBe('["org-a"]')
  })

  it('reads a malformed domains row as tahi.studio, never as "no restriction"', async () => {
    state.rows = [{ key: ALLOWED_DOMAINS_SETTING_KEY, value: '{not json' }]
    expect((await settings())[ALLOWED_DOMAINS_SETTING_KEY]).toBe('["tahi.studio"]')
  })
})

describe('PATCH validates the delivery keys', () => {
  it('stores a mode from the vocabulary', async () => {
    expect(await patchStatus({ key: DELIVERY_MODE_SETTING_KEY, value: 'all' })).toBe(200)
    expect(state.inserts[0]).toMatchObject({ key: DELIVERY_MODE_SETTING_KEY, value: 'all' })
  })

  it('refuses a mode outside the vocabulary', async () => {
    expect(await patchStatus({ key: DELIVERY_MODE_SETTING_KEY, value: 'everyone' })).toBe(400)
    expect(state.inserts).toHaveLength(0)
    expect(state.updates).toHaveLength(0)
  })

  it('says what "all" would mean, in the 400 body', async () => {
    const res = await PATCH(patchReq({ key: DELIVERY_MODE_SETTING_KEY, value: 'nope' }))
    const body = await res.json() as { error: string }
    expect(body.error).toContain('real clients')
  })

  it('accepts the clear, because clearing turns the allowlist on', async () => {
    expect(await patchStatus({ key: DELIVERY_MODE_SETTING_KEY, value: '' })).toBe(200)
  })

  it('refuses an address where a domain belongs', async () => {
    expect(await patchStatus({
      key: ALLOWED_DOMAINS_SETTING_KEY,
      value: '["business@tahi.studio"]',
    })).toBe(400)
    expect(state.inserts).toHaveLength(0)
  })

  it('refuses a domains value that is not a JSON array', async () => {
    expect(await patchStatus({ key: ALLOWED_DOMAINS_SETTING_KEY, value: 'tahi.studio' })).toBe(400)
  })

  it('stores a valid domains list', async () => {
    expect(await patchStatus({
      key: ALLOWED_DOMAINS_SETTING_KEY,
      value: '["tahi.studio","example.co.nz"]',
    })).toBe(200)
    expect(state.inserts[0]).toMatchObject({ key: ALLOWED_DOMAINS_SETTING_KEY })
  })

  it('refuses an org id with a space in it', async () => {
    expect(await patchStatus({
      key: ALLOWED_ORG_IDS_SETTING_KEY,
      value: '["Acme Orchard"]',
    })).toBe(400)
  })

  it('stores a valid org id list', async () => {
    expect(await patchStatus({ key: ALLOWED_ORG_IDS_SETTING_KEY, value: '["org-a"]' })).toBe(200)
  })

  it('refuses two addresses typed into one entry of an address list', async () => {
    expect(await patchStatus({
      key: ALLOWED_ADDRESSES_SETTING_KEY,
      value: '["jo@acme.com, business@tahi.studio"]',
    })).toBe(400)
    expect(state.inserts).toHaveLength(0)
  })

  it('stores a valid address list', async () => {
    expect(await patchStatus({
      key: ALLOWED_ADDRESSES_SETTING_KEY,
      value: '["business@tahi.studio"]',
    })).toBe(200)
  })

  it('leaves unrelated keys alone', async () => {
    expect(await patchStatus({ key: 'studio_legal_name', value: 'Tahi Studio Ltd' })).toBe(200)
  })
})

describe('who may widen the gate', () => {
  it('lets a super admin open it', async () => {
    expect(await patchStatus({ key: DELIVERY_MODE_SETTING_KEY, value: 'all' })).toBe(200)
    expect(state.inserts[0]).toMatchObject({ key: DELIVERY_MODE_SETTING_KEY, value: 'all' })
  })

  it('refuses a plain admin, and the MCP service token with it', async () => {
    state.isSuperAdmin = false
    expect(await patchStatus({ key: DELIVERY_MODE_SETTING_KEY, value: 'all' })).toBe(403)
    expect(state.inserts).toHaveLength(0)
    expect(state.updates).toHaveLength(0)
  })

  it('still lets a plain admin CLOSE it, and clear it', async () => {
    state.isSuperAdmin = false
    expect(await patchStatus({ key: DELIVERY_MODE_SETTING_KEY, value: 'allowlist' })).toBe(200)
    expect(await patchStatus({ key: DELIVERY_MODE_SETTING_KEY, value: '' })).toBe(200)
  })

  it('refuses a plain admin widening a domain, an address list or an exemption', async () => {
    state.isSuperAdmin = false
    for (const key of [
      ALLOWED_DOMAINS_SETTING_KEY,
      ALLOWED_ORG_IDS_SETTING_KEY,
      ALLOWED_ADDRESSES_SETTING_KEY,
      BLOCKED_ADDRESSES_SETTING_KEY,
    ]) {
      expect(await patchStatus({ key, value: '[]' })).toBe(403)
    }
    expect(state.inserts).toHaveLength(0)
  })

  it('leaves every other setting admin-writable', async () => {
    state.isSuperAdmin = false
    expect(await patchStatus({ key: 'studio_legal_name', value: 'Tahi Studio Ltd' })).toBe(200)
  })
})

describe('the audit trail', () => {
  it('records every email.* change with its old value, its new value and the actor', async () => {
    state.rows = [{ key: DELIVERY_MODE_SETTING_KEY, value: 'allowlist' }]
    await patchStatus({ key: DELIVERY_MODE_SETTING_KEY, value: 'all' })

    expect(auditRows).toHaveLength(1)
    expect(auditRows[0]).toMatchObject({
      action: 'settings.email_delivery_changed',
      userId: 'user_admin',
      entityType: 'setting',
      entityId: DELIVERY_MODE_SETTING_KEY,
      metadata: { key: DELIVERY_MODE_SETTING_KEY, from: 'allowlist', to: 'all' },
    })
  })

  it('records nothing for a setting that is not the gate', async () => {
    await patchStatus({ key: 'studio_legal_name', value: 'Tahi Studio Ltd' })
    expect(auditRows).toHaveLength(0)
  })

  it('records nothing for a write it refused', async () => {
    state.isSuperAdmin = false
    await patchStatus({ key: DELIVERY_MODE_SETTING_KEY, value: 'all' })
    expect(auditRows).toHaveLength(0)
  })
})
