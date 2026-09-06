/**
 * The snapshot client: the importer's read side without a token.
 *
 * Two properties are pinned here. The validator refuses BY KEY PATH, so an
 * operator who assembled a few megabytes by hand is told exactly which row is
 * wrong. And the client is a faithful ManyRequestsClient: copies of the lists,
 * a detail read that answers with the matching row, a loud ManyRequestsReadError
 * on a miss (run.ts turns that into a warning and a fall back to the list row)
 * and NO live path at all.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ManyRequestsReadError } from '../client'
import { createSnapshotClient, SNAPSHOT_KEYS, validateSnapshotPayload } from '../snapshot-client'

function minimal() {
  return { organizations: [{ id: 18, name: 'Blank Space Inc' }] }
}

function full() {
  return {
    organizations: [
      {
        id: 18,
        name: 'Blank Space Inc',
        owner: { id: 40, name: 'Saif Al-Janabi', email: 'saif@blankspaceinc.ca' },
        subscription_status: 'unsubscribed',
        balance: { hours: -6.57, purchased_hours: 10 },
        // Extra keys the MCP connector adds. Kept, never refused.
        url: 'https://tahistudio.manyrequests.com/organizations/18',
        notice: 'members_total 1',
        members_total: 1,
      },
    ],
    membersByOrg: { '18': [{ id: 40, name: 'Saif Al-Janabi', email: 'saif@blankspaceinc.ca', is_owner: true }] },
    brandsByOrg: { '18': [{ id: 7, name: 'Blank Space' }] },
    subscriptionsByOrg: {
      '18': [{ service: { id: 5, name: 'Retainer' }, status: 'canceled', billing_period: 'Monthly', hours_per_period: 10 }],
    },
    clients: [{ id: 40, name: 'Saif Al-Janabi', email: 'saif@blankspaceinc.ca', organization: { id: 18, name: 'Blank Space Inc' } }],
    services: [{ id: 5, name: 'Retainer', type: 'recurring', currency: 'USD', price: 500, hours: 10 }],
    requests: [
      { id: 347, number: 347, title: 'Custom Redirects', status: 'In progress', organization: { id: 18, name: 'Blank Space Inc' } },
      { id: '348', number: 348, title: 'Footer fix', status: 'Submitted', organization: { id: 18, name: 'Blank Space Inc' } },
    ],
    invoices: [
      { number: 'INV-2025000024', status: 'pending', amount: 100, currency: 'USD', organization: { id: 18, name: 'Blank Space Inc' } },
    ],
  }
}

describe('validateSnapshotPayload', () => {
  it('accepts a minimal payload and counts every key, absent ones as zero', () => {
    const result = validateSnapshotPayload(minimal())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot.organizations).toHaveLength(1)
    expect(result.counts).toEqual({
      organizations: 1,
      membersByOrg: 0,
      brandsByOrg: 0,
      subscriptionsByOrg: 0,
      clients: 0,
      services: 0,
      requests: 0,
      invoices: 0,
    })
  })

  it('accepts the full eight-key shape and counts the per-org maps by rows', () => {
    const result = validateSnapshotPayload(full())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.counts).toEqual({
      organizations: 1,
      membersByOrg: 1,
      brandsByOrg: 1,
      subscriptionsByOrg: 1,
      clients: 1,
      services: 1,
      requests: 2,
      invoices: 1,
    })
    expect(Object.keys(result.snapshot).sort()).toEqual([...SNAPSHOT_KEYS].sort())
  })

  it('keeps the raw keys inside a row rather than stripping what it does not know', () => {
    const result = validateSnapshotPayload(full())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const org = result.snapshot.organizations?.[0] as unknown as Record<string, unknown>
    expect(org.url).toContain('manyrequests.com')
    expect(org.members_total).toBe(1)
  })

  it('refuses a row with no id, naming the key path', () => {
    const result = validateSnapshotPayload({ requests: [{ id: 1 }, { title: 'no id' }] })
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('snapshot.requests[1].id') })
  })

  it('refuses an empty-string id, which the planner would treat as no key', () => {
    const result = validateSnapshotPayload({ services: [{ id: '   ' }] })
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('snapshot.services[0].id') })
  })

  it('refuses an invoice with no number, because the number is its identifier', () => {
    const result = validateSnapshotPayload({ invoices: [{ number: 'INV-1' }, { status: 'paid' }] })
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('snapshot.invoices[1].number') })
  })

  it('refuses a list that is not an array', () => {
    const result = validateSnapshotPayload({ services: { id: 5 } })
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('snapshot.services must be an array') })
  })

  it('refuses a null list rather than reading it as absent', () => {
    const result = validateSnapshotPayload({ organizations: [{ id: 1 }], requests: null })
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('snapshot.requests must be an array, got null') })
  })

  it('refuses a row that is not a plain object', () => {
    const result = validateSnapshotPayload({ organizations: [{ id: 1 }, 'Blank Space Inc'] })
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('snapshot.organizations[1] must be a plain object') })
  })

  it('refuses a per-org map whose value is not an array', () => {
    const result = validateSnapshotPayload({ membersByOrg: { '18': { id: 40 } } })
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('snapshot.membersByOrg["18"] must be an array') })
  })

  it('refuses a per-org map that is not an object', () => {
    const result = validateSnapshotPayload({ brandsByOrg: [] })
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('snapshot.brandsByOrg must be an object') })
  })

  it('refuses an unknown top-level key BY NAME, so a raw MCP response cannot be pasted in whole', () => {
    const result = validateSnapshotPayload({ organizations: [], url: 'x', notice: 'y' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('url')
    expect(result.reason).toContain('notice')
    expect(result.reason).toContain('Known keys')
  })

  it('refuses anything that is not a plain object', () => {
    for (const value of [null, undefined, 'text', 42, true, [], [{ id: 1 }]]) {
      const result = validateSnapshotPayload(value)
      expect({ value, ok: result.ok }).toEqual({ value, ok: false })
      if (!result.ok) expect(result.reason).toContain('snapshot must be a plain object')
    }
  })

  it('refuses a payload that carries none of the known keys', () => {
    const result = validateSnapshotPayload({})
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('none of the known keys') })
  })
})

describe('createSnapshotClient', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('answers the lists from the snapshot', async () => {
    const client = createSnapshotClient(full())
    expect(await client.listOrganizations()).toHaveLength(1)
    expect(await client.listClients()).toHaveLength(1)
    expect(await client.listServices()).toHaveLength(1)
    expect(await client.listRequests()).toHaveLength(2)
    expect(await client.listInvoices()).toHaveLength(1)
  })

  it('returns a request by id and an invoice by number, matching a string id against a numeric row', async () => {
    const client = createSnapshotClient(full())
    expect((await client.getRequest('347')).title).toBe('Custom Redirects')
    expect((await client.getRequest('348')).title).toBe('Footer fix')
    expect((await client.getInvoice('INV-2025000024')).status).toBe('pending')
  })

  it('reads the per-org maps by String(orgId) and answers empty for an org that is not there', async () => {
    const client = createSnapshotClient(full())
    expect(await client.listOrgMembers('18')).toHaveLength(1)
    expect(await client.listOrgBrands('18')).toHaveLength(1)
    expect(await client.listOrgServices('18')).toHaveLength(1)
    expect(await client.listOrgMembers('999')).toEqual([])
    expect(await client.listOrgBrands('999')).toEqual([])
    expect(await client.listOrgServices('999')).toEqual([])
  })

  it('answers empty lists for absent keys', async () => {
    const client = createSnapshotClient(minimal())
    expect(await client.listClients()).toEqual([])
    expect(await client.listServices()).toEqual([])
    expect(await client.listRequests()).toEqual([])
    expect(await client.listInvoices()).toEqual([])
    expect(await client.listOrgMembers('18')).toEqual([])
    expect(await client.listOrgBrands('18')).toEqual([])
    expect(await client.listOrgServices('18')).toEqual([])
  })

  it('returns copies, so a caller that splices its result cannot change the next read', async () => {
    const client = createSnapshotClient(full())
    const first = await client.listRequests()
    first.pop()
    expect(first).toHaveLength(1)
    expect(await client.listRequests()).toHaveLength(2)
    const members = await client.listOrgMembers('18')
    members.length = 0
    expect(await client.listOrgMembers('18')).toHaveLength(1)
  })

  it('throws ManyRequestsReadError for a request or invoice that is not in the snapshot', async () => {
    const client = createSnapshotClient(full())
    await expect(client.getRequest('999')).rejects.toBeInstanceOf(ManyRequestsReadError)
    await expect(client.getRequest('999')).rejects.toThrow('not in snapshot')
    await expect(client.getInvoice('INV-0')).rejects.toBeInstanceOf(ManyRequestsReadError)
  })

  it('throws ManyRequestsReadError for a request when the snapshot has no requests at all', async () => {
    const client = createSnapshotClient(minimal())
    await expect(client.getRequest('347')).rejects.toBeInstanceOf(ManyRequestsReadError)
  })

  it('has no live paths: get, getOne and listAll refuse rather than answer', async () => {
    const client = createSnapshotClient(full())
    await expect(client.get('/organizations')).rejects.toBeInstanceOf(ManyRequestsReadError)
    await expect(client.getOne('/requests/347', { field: 'id', expected: '347' })).rejects.toBeInstanceOf(
      ManyRequestsReadError,
    )
    await expect(client.listAll('/requests')).rejects.toBeInstanceOf(ManyRequestsReadError)
    await expect(client.listAll('/requests')).rejects.toThrow('snapshot client has no live paths')
  })

  it('never touches fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network reached'))
    const client = createSnapshotClient(full())
    await client.listOrganizations()
    await client.listOrgMembers('18')
    await client.listOrgBrands('18')
    await client.listOrgServices('18')
    await client.listClients()
    await client.listServices()
    await client.listInvoices()
    await client.getInvoice('INV-2025000024')
    await client.listRequests()
    await client.getRequest('347')
    await client.getRequest('999').catch(() => undefined)
    await client.get('/anything').catch(() => undefined)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
