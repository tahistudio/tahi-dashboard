import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { drizzle, type AnyD1Database } from 'drizzle-orm/d1'
import { NextRequest } from 'next/server'
import { schema, type DB } from '@/db/d1'
import type { RequestAuthResult } from '@/lib/server-auth'

const h = vi.hoisted(() => ({
  database: null as unknown,
  auth: { userId: 'liam', orgId: 'tahi', sessionId: 'sess_liam' } as RequestAuthResult,
  isAdmin: true,
  membership: vi.fn(),
  permissions: vi.fn(),
}))
vi.mock('@/lib/db', () => ({ db: async () => h.database }))
vi.mock('@/lib/server-auth', () => ({ getRequestAuth: async () => h.auth, isTahiAdmin: (id: string | null) => id === 'tahi' }))
vi.mock('@/lib/permissions', () => ({ resolvePermissions: (...args: unknown[]) => h.permissions(...args) }))
vi.mock('@/lib/mcp-profile-server', () => ({ isClerkUserInTahiOrg: (...args: unknown[]) => h.membership(...args) }))

import { RECORDER_DEVICES_MIGRATION } from '@/lib/recorder-devices-migration'
import { getRecorderDeviceAuth, hashRecorderSecret, isRecorderDeviceRequest, RecorderDeviceAuthError } from '@/lib/recorder-device-auth'
import { GET as listDevices } from '@/app/api/admin/recorder-devices/route'
import { POST as createCode } from '@/app/api/admin/recorder-devices/pairing-code/route'
import { POST as revokeDevice } from '@/app/api/admin/recorder-devices/[id]/revoke/route'
import { POST as pair } from '@/app/api/public/recorder/pair/route'
import { hashRecorderPairingIp, recorderPairingIpPrefix } from '@/lib/recorder-pairing-security'

interface SqlResult { results: Array<Record<string, unknown>>; success: boolean; meta: { changes: number } }
interface SqlStatement {
  bind(...params: SQLInputValue[]): SqlStatement
  execute(): SqlResult
  all(): Promise<SqlResult>
  run(): Promise<SqlResult>
  raw(): Promise<unknown[][]>
}

let sqlite: DatabaseSync
let database: DB
let failDeviceInsert: boolean
const now = '2026-10-14T00:00:00.000Z'
const token = 'tahi_rec_' + 'a'.repeat(43)

function adapter(source: DatabaseSync) {
  const prepare = (query: string): SqlStatement => {
    const bind = (...params: SQLInputValue[]): SqlStatement => {
      const execute = (): SqlResult => {
        if (failDeviceInsert && /^\s*INSERT INTO recorder_devices/i.test(query)) throw new Error('Injected device insert failure')
        const statement = source.prepare(query)
        if (/^\s*select\b|\breturning\b/i.test(query)) {
          const results = statement.all(...params) as Array<Record<string, unknown>>
          return { results, success: true, meta: { changes: /^\s*select/i.test(query) ? 0 : results.length } }
        }
        return { results: [], success: true, meta: { changes: Number(statement.run(...params).changes) } }
      }
      return { bind, execute, all: async () => execute(), run: async () => execute(), raw: async () => execute().results.map(row => Object.values(row)) }
    }
    return bind()
  }
  return {
    prepare,
    async batch(statements: SqlStatement[]) {
      source.exec('BEGIN')
      try { const results = statements.map(statement => statement.execute()); source.exec('COMMIT'); return results }
      catch (error) { source.exec('ROLLBACK'); throw error }
    },
  }
}

function request(path: string, body?: unknown, bearer?: string, ip = '192.0.2.1') {
  return new NextRequest(`http://localhost${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'cf-connecting-ip': ip, ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

async function pairingCode(): Promise<string> {
  const response = await createCode(request('/api/admin/recorder-devices/pairing-code', {}))
  expect(response.status).toBe(201)
  const body = await response.json() as { code: string }
  return body.code
}

function exchange(code: string, ip = '192.0.2.1') {
  return pair(request('/api/public/recorder/pair', { code, deviceName: 'Liam PC' }, undefined, ip))
}

async function seedDevice(overrides: Record<string, SQLInputValue> = {}) {
  const values = {
    id: 'device-1', team_member_id: 'member-liam', name: 'Liam PC', token_hash: await hashRecorderSecret(token),
    created_at: now, last_seen_at: now, membership_checked_at: now, ...overrides,
  }
  sqlite.prepare(`INSERT INTO recorder_devices (${Object.keys(values).join(',')}) VALUES (${Object.keys(values).map(() => '?').join(',')})`).run(...Object.values(values))
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(now))
  vi.stubEnv('NEXT_PUBLIC_TAHI_ORG_ID', 'tahi')
  vi.stubEnv('MCP_IDENTITY_SECRET', 'recorder-pairing-test-secret-00000000')
  vi.stubEnv('CLERK_SECRET_KEY', '')
  sqlite = new DatabaseSync(':memory:')
  sqlite.exec(RECORDER_DEVICES_MIGRATION.join(';'))
  sqlite.exec(`CREATE TABLE team_members (id TEXT PRIMARY KEY, clerk_user_id TEXT, name TEXT, email TEXT);
    INSERT INTO team_members VALUES ('member-liam','liam','Liam','business@tahi.studio'), ('member-staci','staci','Staci','staci@tahi.studio');
    CREATE TABLE audit_log (id TEXT PRIMARY KEY, actor_id TEXT, actor_type TEXT, action TEXT NOT NULL,
      entity_type TEXT, entity_id TEXT, metadata TEXT, ip_address TEXT, created_at TEXT NOT NULL);`)
  database = drizzle(adapter(sqlite) as unknown as AnyD1Database, { schema })
  h.database = database
  h.auth = { userId: 'liam', orgId: 'tahi', sessionId: 'sess_liam' }
  h.isAdmin = true
  h.membership.mockReset().mockResolvedValue(true)
  h.permissions.mockReset().mockImplementation(async () => ({ isAdmin: h.isAdmin }))
  failDeviceInsert = false
})

afterEach(() => { sqlite.close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('recorder pairing IP protection', () => {
  it('canonicalizes IPv6 /64 prefixes across compressed and expanded addresses', () => {
    expect(recorderPairingIpPrefix('2001:DB8:1234:5678::1')).toBe('ipv6:2001:0db8:1234:5678/64')
    expect(recorderPairingIpPrefix('2001:0db8:1234:5678:aaaa:bbbb:cccc:dddd')).toBe('ipv6:2001:0db8:1234:5678/64')
    expect(recorderPairingIpPrefix('2001:db8:1234:5679::1')).not.toBe(recorderPairingIpPrefix('2001:db8:1234:5678::1'))
    expect(recorderPairingIpPrefix('::1')).toBe('ipv6:0000:0000:0000:0000/64')
    expect(recorderPairingIpPrefix('::ffff:192.0.2.1')).toBe(recorderPairingIpPrefix('0:0:0:0:0:ffff:c000:201'))
    expect(recorderPairingIpPrefix('192.0.2.1')).toBe('ipv4:192.0.2.1')
    expect(recorderPairingIpPrefix('not-an-address')).toBe('unknown')
    expect(recorderPairingIpPrefix(null)).toBe('unknown')
  })

  it('stores a secret-dependent HMAC of the prefix rather than an enumerable plain hash', async () => {
    const first = await hashRecorderPairingIp('2001:db8:1234:5678::1')
    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(first).toBe(await hashRecorderPairingIp('2001:0db8:1234:5678::abcd'))
    expect(first).not.toBe(await hashRecorderSecret('2001:db8:1234:5678::1'))
    expect(first).not.toBe(await hashRecorderSecret(recorderPairingIpPrefix('2001:db8:1234:5678::1')))
    vi.stubEnv('MCP_IDENTITY_SECRET', 'different-pairing-test-secret-0000')
    expect(await hashRecorderPairingIp('2001:db8:1234:5678::1')).not.toBe(first)
  })

  it('uses the existing Clerk secret when the MCP identity secret is unavailable', async () => {
    const expected = await hashRecorderPairingIp('192.0.2.1')
    vi.stubEnv('CLERK_SECRET_KEY', process.env.MCP_IDENTITY_SECRET!)
    vi.stubEnv('MCP_IDENTITY_SECRET', '')
    expect(await hashRecorderPairingIp('192.0.2.1')).toBe(expected)
  })
})

describe('recorder device authentication', () => {
  it('returns the real Clerk identity with a narrow device marker', async () => {
    await seedDevice()
    expect(await getRecorderDeviceAuth(request('/api/admin/recordings', undefined, token))).toEqual({
      userId: 'liam', orgId: 'tahi', sessionId: null, recorderDevice: { id: 'device-1', teamMemberId: 'member-liam' },
    })
    expect(h.permissions).toHaveBeenCalledWith(database, expect.objectContaining({ userId: 'liam', orgId: 'tahi' }))
    expect(h.membership).not.toHaveBeenCalled()
  })

  it('refuses unknown and malformed tokens', async () => {
    expect(await getRecorderDeviceAuth(request('/api/admin/recordings', undefined, token))).toBeNull()
    expect(await getRecorderDeviceAuth(request('/api/admin/recordings', undefined, 'tahi_rec_short'))).toBeNull()
    expect(await getRecorderDeviceAuth(request('/api/admin/recordings'))).toBeNull()
  })

  it('accepts case-insensitive Bearer schemes while keeping the device secret case-sensitive', async () => {
    await seedDevice()
    const mixedCase = request('/api/admin/recordings', undefined, token)
    mixedCase.headers.set('authorization', `bEaReR ${token}`)
    expect(isRecorderDeviceRequest(mixedCase)).toBe(true)
    expect(await getRecorderDeviceAuth(mixedCase)).toMatchObject({ userId: 'liam', recorderDevice: { id: 'device-1' } })

    const upperPrefix = request('/api/admin/recordings', undefined, token.replace('tahi_rec_', 'TAHI_REC_'))
    expect(isRecorderDeviceRequest(upperPrefix)).toBe(true)
    expect(await getRecorderDeviceAuth(upperPrefix)).toBeNull()
  })

  it('refuses revoked devices, missing members, missing Clerk ids and non-admins', async () => {
    await seedDevice({ revoked_at: now })
    expect(await getRecorderDeviceAuth(request('/', undefined, token))).toBeNull()
    sqlite.prepare('UPDATE recorder_devices SET revoked_at = NULL').run()
    sqlite.prepare("DELETE FROM team_members WHERE id='member-liam'").run()
    expect(await getRecorderDeviceAuth(request('/', undefined, token))).toBeNull()
    sqlite.prepare("INSERT INTO team_members VALUES ('member-liam',NULL,'Liam','business@tahi.studio')").run()
    expect(await getRecorderDeviceAuth(request('/', undefined, token))).toBeNull()
    sqlite.prepare("UPDATE team_members SET clerk_user_id='liam' WHERE id='member-liam'").run()
    h.isAdmin = false
    expect(await getRecorderDeviceAuth(request('/', undefined, token))).toBeNull()
  })

  it('rechecks stale membership and caches success for fifteen minutes', async () => {
    await seedDevice({ membership_checked_at: '2026-10-13T23:45:00.000Z' })
    expect(await getRecorderDeviceAuth(request('/', undefined, token))).not.toBeNull()
    expect(h.membership).toHaveBeenCalledExactlyOnceWith('liam')
    expect(sqlite.prepare('SELECT membership_checked_at FROM recorder_devices').get()?.membership_checked_at).toBe(now)
    expect(await getRecorderDeviceAuth(request('/', undefined, token))).not.toBeNull()
    expect(h.membership).toHaveBeenCalledTimes(1)
  })

  it('returns retryable 503 on a Clerk outage and never revokes the device', async () => {
    await seedDevice({ membership_checked_at: null })
    h.membership.mockRejectedValue(new Error('Clerk 503'))
    await expect(getRecorderDeviceAuth(request('/', undefined, token))).rejects.toBeInstanceOf(RecorderDeviceAuthError)
    await expect(getRecorderDeviceAuth(request('/', undefined, token))).rejects.toMatchObject({ status: 503, retryAfter: 30 })
    expect(sqlite.prepare('SELECT revoked_at, membership_checked_at FROM recorder_devices').get()).toMatchObject({ revoked_at: null, membership_checked_at: null })
  })

  it('revokes a definite Clerk membership refusal', async () => {
    await seedDevice({ membership_checked_at: null })
    h.membership.mockResolvedValue(false)
    expect(await getRecorderDeviceAuth(request('/', undefined, token))).toBeNull()
    expect(sqlite.prepare('SELECT revoked_at, revoked_reason FROM recorder_devices').get()).toMatchObject({ revoked_at: now, revoked_reason: 'membership_removed' })
  })

  it('expires after thirty idle days and throttles last seen writes to five minutes', async () => {
    await seedDevice({ last_seen_at: '2026-09-14T00:00:00.000Z' })
    expect(await getRecorderDeviceAuth(request('/', undefined, token))).toBeNull()
    expect(sqlite.prepare('SELECT revoked_reason FROM recorder_devices').get()?.revoked_reason).toBe('idle_expiry')
    sqlite.prepare('DELETE FROM recorder_devices').run()
    await seedDevice({ last_seen_at: '2026-10-13T23:54:00.000Z' })
    expect(await getRecorderDeviceAuth(request('/', undefined, token))).not.toBeNull()
    expect(sqlite.prepare('SELECT last_seen_at FROM recorder_devices').get()?.last_seen_at).toBe(now)
    vi.setSystemTime(new Date('2026-10-14T00:04:59.000Z'))
    expect(await getRecorderDeviceAuth(request('/', undefined, token))).not.toBeNull()
    expect(sqlite.prepare('SELECT last_seen_at FROM recorder_devices').get()?.last_seen_at).toBe(now)
    vi.setSystemTime(new Date('2026-10-14T00:05:00.000Z'))
    await getRecorderDeviceAuth(request('/', undefined, token))
    expect(sqlite.prepare('SELECT last_seen_at FROM recorder_devices').get()?.last_seen_at).toBe('2026-10-14T00:05:00.000Z')
  })
})

describe('recorder pairing', () => {
  it('requires a real admin Clerk session, refuses service/device tokens and pairs only self', async () => {
    h.auth.sessionId = null
    expect((await createCode(request('/', {}))).status).toBe(403)
    h.auth = { userId: 'api-service', orgId: 'tahi', sessionId: null, mcpActor: { teamMemberId: 'member-liam', clerkUserId: 'liam', profile: 'full' } }
    expect((await createCode(request('/', {}))).status).toBe(403)
    h.auth = { userId: 'liam', orgId: 'tahi', sessionId: 'sess_liam' }
    expect((await createCode(request('/', {}, token))).status).toBe(401)
    h.auth.sessionId = 'ship-studio-preview'
    expect((await createCode(request('/', {}))).status).toBe(403)
    h.auth.sessionId = 'sess_liam'
    h.isAdmin = false
    expect((await createCode(request('/', {}))).status).toBe(403)
    h.isAdmin = true
    const response = await createCode(request('/', { teamMemberId: 'member-staci' }))
    const body = await response.json() as { code: string; expiresAt: string }
    expect(body).toMatchObject({ code: expect.stringMatching(/^[A-HJ-NP-Z2-9]{8}$/), expiresAt: '2026-10-14T00:10:00.000Z' })
    expect(sqlite.prepare('SELECT code_hash, team_member_id, created_by_user_id FROM recorder_pairing_codes').get()).toMatchObject({ code_hash: await hashRecorderSecret(body.code), team_member_id: 'member-liam', created_by_user_id: 'liam' })
  })

  it('exchanges once for a random bearer token and stores only hashes', async () => {
    const code = await pairingCode()
    const response = await exchange(code.toLowerCase())
    expect(response.status).toBe(201)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const body = await response.json() as { token: string; device: { id: string; name: string } }
    expect(body.token).toMatch(/^tahi_rec_[A-Za-z0-9_-]{43}$/)
    expect(body.device.name).toBe('Liam PC')
    expect(sqlite.prepare('SELECT token_hash, team_member_id FROM recorder_devices').get()).toMatchObject({ token_hash: await hashRecorderSecret(body.token), team_member_id: 'member-liam' })
    expect((await exchange(code)).status).toBe(400)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM recorder_devices').get()?.n).toBe(1)
    expect(await getRecorderDeviceAuth(request('/', undefined, body.token))).toMatchObject({ userId: 'liam' })
  })

  it('records creation and pairing audit rows without codes, tokens or their hashes', async () => {
    const code = await pairingCode()
    const response = await exchange(code)
    expect(response.status).toBe(201)
    const body = await response.json() as { token: string; device: { id: string } }
    const rows = sqlite.prepare('SELECT actor_id, action, entity_type, entity_id, metadata, ip_address FROM audit_log ORDER BY rowid').all()
    expect(rows).toEqual([
      expect.objectContaining({ actor_id: 'liam', action: 'recorder_device.pairing_code_created', entity_type: 'team_member', entity_id: 'member-liam' }),
      expect.objectContaining({ actor_id: 'liam', action: 'recorder_device.paired', entity_type: 'recorder_device', entity_id: body.device.id }),
    ])
    const stored = JSON.stringify(rows)
    for (const secret of [code, body.token, await hashRecorderSecret(code), await hashRecorderSecret(body.token)]) {
      expect(stored).not.toContain(secret)
    }
    expect(rows.every(row => row.metadata === null && row.ip_address === null)).toBe(true)
    expect((await exchange(code)).status).toBe(400)
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'recorder_device.paired'").get()?.n).toBe(1)
  })

  it('invalidates earlier unused codes only for the member creating a replacement', async () => {
    h.auth = { userId: 'staci', orgId: 'tahi', sessionId: 'sess_staci' }
    const staciCode = await pairingCode()
    h.auth = { userId: 'liam', orgId: 'tahi', sessionId: 'sess_liam' }
    const oldCode = await pairingCode()
    const replacement = await pairingCode()
    expect((await exchange(oldCode)).status).toBe(400)
    expect((await exchange(replacement)).status).toBe(201)
    expect((await exchange(staciCode)).status).toBe(201)
  })

  it('consumes the code atomically under racing exchanges', async () => {
    const code = await pairingCode()
    const results = await Promise.all([exchange(code), exchange(code)])
    expect(results.map(result => result.status).sort()).toEqual([201, 400])
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM recorder_devices').get()?.n).toBe(1)
  })

  it('retains the code if token persistence fails inside the transaction', async () => {
    const code = await pairingCode()
    failDeviceInsert = true
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect((await exchange(code)).status).toBe(503)
    expect(sqlite.prepare('SELECT used_at FROM recorder_pairing_codes').get()?.used_at).toBeNull()
    failDeviceInsert = false
    expect((await exchange(code)).status).toBe(201)
  })

  it('refuses expired, wrong and already-used codes without returning secrets', async () => {
    const code = await pairingCode()
    const wrong = await exchange('ZZZZZZZZ')
    expect(wrong.status).toBe(400)
    expect(await wrong.json()).toEqual({ error: 'The pairing code is invalid or expired.' })
    vi.setSystemTime(new Date('2026-10-14T00:10:00.000Z'))
    expect((await exchange(code)).status).toBe(400)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM recorder_devices').get()?.n).toBe(0)
  })

  it('rechecks expiry after a slow Clerk membership call', async () => {
    const code = await pairingCode()
    h.membership.mockImplementation(async () => { vi.setSystemTime(new Date('2026-10-14T00:10:00.000Z')); return true })
    expect((await exchange(code)).status).toBe(400)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM recorder_devices').get()?.n).toBe(0)
    expect(sqlite.prepare('SELECT used_at FROM recorder_pairing_codes').get()?.used_at).toBeNull()
  })

  it('atomically limits concurrent failures per hashed IP for fifteen minutes', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => exchange('ZZZZZZZZ')))
    expect(results.filter(result => result.status === 400)).toHaveLength(5)
    expect(results.filter(result => result.status === 429)).toHaveLength(5)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM recorder_pairing_attempts').get()?.n).toBe(5)
    expect(sqlite.prepare('SELECT ip_hash FROM recorder_pairing_attempts LIMIT 1').get()?.ip_hash).toBe(await hashRecorderPairingIp('192.0.2.1'))
    expect((await exchange('ZZZZZZZZ', '192.0.2.2')).status).toBe(400)
    vi.setSystemTime(new Date('2026-10-14T00:15:00.001Z'))
    expect((await exchange('ZZZZZZZZ')).status).toBe(400)
  })

  it('shares the five-failure limit across rotating IPv6 addresses within one /64', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, (_, index) => exchange('ZZZZZZZZ', `2001:db8:1234:5678::${index + 1}`)))
    expect(results.filter(result => result.status === 400)).toHaveLength(5)
    expect(results.filter(result => result.status === 429)).toHaveLength(3)
    expect(sqlite.prepare('SELECT COUNT(DISTINCT ip_hash) AS n FROM recorder_pairing_attempts').get()?.n).toBe(1)
    expect((await exchange('ZZZZZZZZ', '2001:db8:1234:5679::1')).status).toBe(400)
  })

  it('atomically caps concurrent failures at five hundred across all IPs for fifteen minutes', async () => {
    const results = await Promise.all(Array.from({ length: 510 }, (_, index) => exchange('ZZZZZZZZ', `198.18.${Math.floor(index / 254)}.${index % 254 + 1}`)))
    expect(results.filter(result => result.status === 400)).toHaveLength(500)
    expect(results.filter(result => result.status === 429)).toHaveLength(10)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM recorder_pairing_attempts WHERE succeeded = 0').get()?.n).toBe(500)
    const blocked = await exchange('ZZZZZZZZ', '198.51.100.1')
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('Retry-After')).toBe('900')
    vi.setSystemTime(new Date('2026-10-14T00:15:00.001Z'))
    expect((await exchange('ZZZZZZZZ', '198.51.100.1')).status).toBe(400)
  })

  it('purges successful and failed attempts older than one day during exchange', async () => {
    const insert = sqlite.prepare('INSERT INTO recorder_pairing_attempts VALUES (?, ?, ?, ?)')
    insert.run('old-failure', 'old-key', '2026-10-12T23:59:59.999Z', 0)
    insert.run('old-success', 'old-key', '2026-10-12T23:00:00.000Z', 1)
    insert.run('boundary', 'older-key', '2026-10-13T00:00:00.000Z', 0)
    insert.run('recent', 'recent-key', '2026-10-13T23:59:00.000Z', 0)
    expect((await exchange('ZZZZZZZZ')).status).toBe(400)
    const remaining = sqlite.prepare('SELECT id FROM recorder_pairing_attempts').all().map(row => row.id)
    expect(remaining).toEqual(expect.arrayContaining(['boundary', 'recent']))
    expect(remaining).toHaveLength(3)
    expect(remaining).not.toContain('old-failure')
    expect(remaining).not.toContain('old-success')
  })

  it('fails closed without either existing server secret', async () => {
    const code = await pairingCode()
    vi.stubEnv('MCP_IDENTITY_SECRET', '')
    vi.stubEnv('CLERK_SECRET_KEY', '')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect((await exchange(code)).status).toBe(503)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM recorder_pairing_attempts').get()?.n).toBe(0)
    expect(sqlite.prepare('SELECT used_at FROM recorder_pairing_codes').get()?.used_at).toBeNull()
  })

  it('does not count successful exchanges as failures', async () => {
    const insert = sqlite.prepare('INSERT INTO recorder_pairing_attempts VALUES (?, ?, ?, 1)')
    for (let index = 0; index < 500; index++) insert.run(`success-${index}`, `ip-key-${index}`, now)
    for (let index = 0; index < 6; index++) expect((await exchange(await pairingCode())).status).toBe(201)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM recorder_pairing_attempts WHERE succeeded = 0').get()?.n).toBe(0)
  })

  it('fails closed if the code owner has lost admin access or Clerk membership', async () => {
    const code = await pairingCode()
    h.isAdmin = false
    expect((await exchange(code)).status).toBe(400)
    h.isAdmin = true
    h.membership.mockResolvedValue(false)
    expect((await exchange(code)).status).toBe(400)
    h.membership.mockRejectedValue(new Error('Clerk 503'))
    const outage = await exchange(code)
    expect(outage.status).toBe(503)
    expect(outage.headers.get('Retry-After')).toBe('30')
    expect(sqlite.prepare('SELECT used_at FROM recorder_pairing_codes').get()?.used_at).toBeNull()
  })
})

describe('own device management', () => {
  it('ignores a recorded MCP actor on a nonservice caller for device ownership', async () => {
    await seedDevice()
    await seedDevice({ id: 'device-2', team_member_id: 'member-staci', token_hash: 'different' })
    h.auth = { userId: 'staci', orgId: 'tahi', sessionId: 'sess_staci', mcpActor: { teamMemberId: 'member-liam', clerkUserId: 'liam', profile: 'full' } }
    const response = await listDevices(request('/api/admin/recorder-devices'))
    expect(response.status).toBe(200)
    expect((await response.json() as { items: Array<{ id: string }> }).items.map(item => item.id)).toEqual(['device-2'])
    expect((await revokeDevice(request('/', {}), { params: Promise.resolve({ id: 'device-1' }) })).status).toBe(404)
    h.isAdmin = false
    expect((await listDevices(request('/api/admin/recorder-devices'))).status).toBe(403)
    expect(h.permissions).toHaveBeenCalledWith(database, expect.objectContaining({ userId: 'staci' }))
  })

  it('lists only the caller devices and never the token hash', async () => {
    await seedDevice()
    await seedDevice({ id: 'device-2', team_member_id: 'member-staci', token_hash: 'different' })
    const response = await listDevices(request('/api/admin/recorder-devices'))
    expect(await response.json()).toEqual({ items: [{ id: 'device-1', name: 'Liam PC', createdAt: now, lastSeenAt: now, revokedAt: null, revokedReason: null }] })
    expect((await listDevices(request('/', undefined, token))).status).toBe(401)
  })

  it('revokes only owned devices and invalidates their token immediately', async () => {
    await seedDevice()
    const params = { params: Promise.resolve({ id: 'device-1' }) }
    h.auth.userId = 'staci'
    expect((await revokeDevice(request('/', {}), params)).status).toBe(404)
    h.auth.userId = 'liam'
    expect((await revokeDevice(request('/', {}), params)).status).toBe(200)
    expect(await getRecorderDeviceAuth(request('/', undefined, token))).toBeNull()
    expect((await revokeDevice(request('/', {}), params)).status).toBe(200)
    expect((await revokeDevice(request('/', {}), { params: Promise.resolve({ id: '../secret' }) })).status).toBe(400)
  })

  it('uses MCP attribution for the data scope after authorizing api-service', async () => {
    await seedDevice()
    h.auth = { userId: 'api-service', orgId: 'tahi', sessionId: null, mcpActor: { teamMemberId: 'member-liam', clerkUserId: 'liam', profile: 'full' } }
    const response = await listDevices(request('/api/admin/recorder-devices'))
    expect(await response.json()).toMatchObject({ items: [{ id: 'device-1' }] })
    expect(h.permissions).toHaveBeenCalledWith(database, h.auth)
    h.auth = { ...h.auth, mcpActor: { teamMemberId: 'member-liam', clerkUserId: 'liam', profile: 'designer' } }
    expect((await listDevices(request('/api/admin/recorder-devices'))).status).toBe(403)
    expect((await revokeDevice(request('/', {}), { params: Promise.resolve({ id: 'device-1' }) })).status).toBe(403)
    h.auth = { ...h.auth, mcpActor: undefined }
    expect((await listDevices(request('/api/admin/recorder-devices'))).status).toBe(403)
  })

  it('never lets a full recorded actor elevate the authenticated caller', async () => {
    await seedDevice()
    const actor = { teamMemberId: 'member-liam', clerkUserId: 'liam', profile: 'full' as const }
    const params = { params: Promise.resolve({ id: 'device-1' }) }
    h.auth = { userId: 'api-service', orgId: 'other-org', sessionId: null, mcpActor: actor }
    expect((await listDevices(request('/api/admin/recorder-devices'))).status).toBe(403)
    expect((await revokeDevice(request('/', {}), params)).status).toBe(403)
    expect(h.permissions).not.toHaveBeenCalled()

    h.auth = { ...h.auth, orgId: 'tahi' }
    h.isAdmin = false
    expect((await listDevices(request('/api/admin/recorder-devices'))).status).toBe(403)
    expect((await revokeDevice(request('/', {}), params)).status).toBe(403)
    expect(h.permissions).toHaveBeenCalledWith(database, h.auth)
    expect(sqlite.prepare('SELECT revoked_at FROM recorder_devices').get()?.revoked_at).toBeNull()

    h.isAdmin = true
    expect((await createCode(request('/', {}))).status).toBe(403)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM recorder_pairing_codes').get()?.n).toBe(0)
  })
})
