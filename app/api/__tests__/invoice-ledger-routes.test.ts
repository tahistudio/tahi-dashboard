import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { schema } from '@/db/d1'
import { db } from '@/lib/db'
import { getRequestAuth } from '@/lib/server-auth'
import { resolvePermissions, type ResolvedAccess } from '@/lib/permissions'
import { callXeroAPI } from '@/lib/xero'
import { stripeSecretKey } from '@/lib/stripe-key'
import { permissionSqlite } from './helpers/permission-sqlite'
import type { StudioInvoice } from '@/app/(dashboard)/invoices/_studio/invoice-views'

vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn(),
  isTahiAdmin: (orgId: string | null) => orgId === 'org_tahi',
}))
// Real feature decisions, access scope, SQL and handlers; isolate permission loading only.
vi.mock('@/lib/permissions', async original => ({
  ...await original<typeof import('@/lib/permissions')>(), resolvePermissions: vi.fn(),
}))
vi.mock('@/lib/xero', () => ({ callXeroAPI: vi.fn() }))
vi.mock('@/lib/stripe-key', () => ({ stripeSecretKey: vi.fn() }))
vi.mock('@/lib/events', () => ({ dispatchDomainEvent: vi.fn() }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }))

import { GET as list } from '@/app/api/admin/invoices/route'
import { GET as exportCsv } from '@/app/api/admin/export/invoices/route'
import { DELETE as remove } from '@/app/api/admin/invoices/[id]/route'

let fixture: ReturnType<typeof permissionSqlite>
let access: ResolvedAccess
let fetchSpy: ReturnType<typeof vi.fn>
const request = (path: string, method = 'GET') => new NextRequest(`http://localhost/api/admin/${path}`, { method })
const context = (id: string) => ({ params: Promise.resolve({ id }) })
type ListBody = { items: StudioInvoice[]; page: number; limit: number; scope?: string }
function invoice(id: string, orgId = 'org-a', status = 'draft') {
  fixture.insert(schema.invoices, {
    id, org_id: orgId, status, number: `INV-${id}`, total_usd: 123.45, currency: 'USD',
    source: 'stripe', stripe_invoice_id: `in_${id}`, xero_invoice_id: `x_${id}`,
    stripe_hosted_invoice_url: `https://invoice.stripe.com/${id}`,
    xero_online_invoice_url: `https://in.xero.com/${id}`,
    due_date: '2026-10-15', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
    sent_at: '2026-10-02T00:00:00Z', viewed_at: '2026-10-03T00:00:00Z', paid_at: '2026-10-04T00:00:00Z',
  })
  fixture.insert(schema.invoiceItems, { id: `line-${id}`, invoice_id: id, description: 'Work', total_usd: 123.45 })
}
const businessQueries = () => fixture.queries.filter(q => /\b(?:invoices|invoice_items)\b/.test(q))
const writes = () => fixture.queries.filter(q => /^(?:insert|update|delete)\b/i.test(q))

beforeEach(() => {
  vi.clearAllMocks()
  fixture = permissionSqlite([
    schema.invoices, schema.invoiceItems, schema.organisations, schema.teamMembers,
    schema.roles, schema.teamMemberRoles, schema.teamMemberAccess, schema.teamMemberAccessOrgs,
  ], [
    // permissionSqlite omits foreign keys; model the production ON DELETE
    // CASCADE so item deletion is atomic with the parent DELETE statement.
    `CREATE TRIGGER cascade_invoice_items AFTER DELETE ON invoices
      BEGIN DELETE FROM invoice_items WHERE invoice_id = OLD.id; END`,
  ])
  vi.mocked(db).mockResolvedValue(fixture.database as never)
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'member', orgId: 'org_tahi', sessionId: 'session' })
  access = {
    userId: 'member', orgId: 'org_tahi', level: 'team_member', audience: 'team',
    isSuperAdmin: false, isAdmin: false, canManagePermissions: false,
    viewableResources: new Set(['invoices']), overrides: new Map(),
  }
  vi.mocked(resolvePermissions).mockImplementation(async () => access)
  fixture.insert(schema.teamMembers, { id: 'tm', clerk_user_id: 'member', role: 'member' })
  fixture.insert(schema.roles, { id: 'role', name: 'designer' })
  fixture.insert(schema.teamMemberRoles, { id: 'assignment', team_member_id: 'tm', role_id: 'role' })
  fixture.insert(schema.teamMemberAccess, { id: 'scope', team_member_id: 'tm', scope_type: 'specific_clients' })
  fixture.insert(schema.teamMemberAccessOrgs, { access_id: 'scope', org_id: 'org-a' })
  fixture.insert(schema.organisations, { id: 'org-a', name: 'Allowed, client' })
  fixture.insert(schema.organisations, { id: 'org-b', name: 'Private client' })
  invoice('a')
  invoice('b', 'org-b')
  fetchSpy = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetchSpy)
  vi.mocked(stripeSecretKey).mockReturnValue('sk_test_isolated')
  vi.mocked(callXeroAPI).mockResolvedValue({} as never)
})
afterEach(() => { fixture.close(); vi.unstubAllGlobals() })

describe('scoped invoice ledger and export', () => {
  it('runs both real GET routes through identical scope, preserving native money and CSV escaping', async () => {
    const listed = await list(request('invoices'))
    expect(listed.status).toBe(200)
    await expect(listed.json()).resolves.toMatchObject({ items: [{ id: 'a', totalAmount: 123.45, currency: 'USD' }], page: 1, limit: 50 })
    const exported = await exportCsv(request('export/invoices'))
    expect(exported.status).toBe(200)
    expect(exported.headers.get('content-type')).toBe('text/csv')
    expect((await exported.text()).split('\n')).toEqual([
      'Invoice Number,Invoice ID,Client,Status,Amount,Currency,Due Date,Created',
      'INV-a,a,"Allowed, client",draft,123.45,USD,2026-10-15,2026-10-01T00:00:00Z',
    ])
  })
  it('intersects orgId and status filters with scope instead of allowing a foreign org escape', async () => {
    for (const orgId of ['org-a', 'org-b']) {
      const body = await (await list(request(`invoices?orgId=${orgId}&status=draft`))).json() as ListBody
      expect(body.items.map((row: { id: string }) => row.id)).toEqual(orgId === 'org-a' ? ['a'] : [])
      const csv = await (await exportCsv(request(`export/invoices?orgId=${orgId}&status=draft`))).text()
      expect(csv.split('\n')).toHaveLength(orgId === 'org-a' ? 2 : 1)
    }
    expect((await (await exportCsv(request('export/invoices?status=paid'))).text()).split('\n')).toHaveLength(1)
  })
  it('keeps the existing export creation-date contract', async () => {
    expect((await (await exportCsv(request('export/invoices?dateFrom=2026-10-02'))).text()).split('\n')).toHaveLength(1)
    expect((await (await exportCsv(request('export/invoices?dateFrom=2026-10-01&dateTo=2026-10-02'))).text()).split('\n')).toHaveLength(2)
  })
  it('reports no scope and exports only the header without reading invoices', async () => {
    await fixture.database.delete(schema.teamMemberAccessOrgs)
    fixture.queries.length = 0
    await expect((await list(request('invoices'))).json()).resolves.toMatchObject({ items: [], scope: 'none' })
    expect((await (await exportCsv(request('export/invoices'))).text()).split('\n')).toHaveLength(1)
    expect(businessQueries()).toEqual([])
  })
  it.each(['invoices', 'export/invoices'])('refuses feature-denied %s before any ledger read', async path => {
    access.overrides.set('invoices', 'deny')
    const response = await (path === 'invoices' ? list : exportCsv)(request(path))
    expect(response.status).toBe(403)
    expect(businessQueries()).toEqual([])
    expect(writes()).toEqual([])
  })
  it.each(['invoices', 'export/invoices'])('refuses a client calling %s before permission or DB loading', async path => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'client', orgId: 'client-org', sessionId: 's' })
    expect((await (path === 'invoices' ? list : exportCsv)(request(path))).status).toBe(403)
    expect(db).not.toHaveBeenCalled()
    expect(resolvePermissions).not.toHaveBeenCalled()
  })
  it.each(['super-admin', 'service'])('allows unrestricted %s reads and export', async identity => {
    if (identity === 'service') vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'api-service', orgId: 'org_tahi', sessionId: null })
    else {
      access.isSuperAdmin = true
      fixture.insert(schema.roles, { id: 'super', name: 'super_admin' })
      fixture.insert(schema.teamMemberRoles, { id: 'super-assignment', team_member_id: 'tm', role_id: 'super' })
    }
    access.overrides.set('invoices', 'deny')
    const body = await (await list(request('invoices'))).json() as ListBody
    expect(body.items.map((row: { id: string }) => row.id)).toEqual(['b', 'a'])
    expect((await (await exportCsv(request('export/invoices'))).text()).split('\n')).toHaveLength(3)
  })
  it('projects all payment fields and pages deterministically over tied creation dates', async () => {
    for (let n = 0; n < 55; n++) invoice(`page-${String(n).padStart(2, '0')}`)
    const first = await (await list(request('invoices?page=1'))).json() as ListBody
    const second = await (await list(request('invoices?page=2'))).json() as ListBody
    expect(first.items).toHaveLength(50)
    expect(second.items).toHaveLength(6)
    const ids = [...first.items, ...second.items].map(row => row.id)
    expect(new Set(ids).size).toBe(56)
    expect(ids).toEqual([...ids].sort().reverse())
    expect(first.items[0]).toMatchObject({
      sentAt: '2026-10-02T00:00:00Z', viewedAt: '2026-10-03T00:00:00Z', paidAt: '2026-10-04T00:00:00Z',
      stripeHostedInvoiceUrl: 'https://invoice.stripe.com/page-54', xeroOnlineInvoiceUrl: 'https://in.xero.com/page-54',
    })
    expect(fixture.errors).toEqual([])
  })
})

describe('draft-only invoice DELETE', () => {
  it.each(['DRAFT', ' draft ', ' Draft '])('claims a normalised %s status consistently with the read guard', async status => {
    fixture.sqlite.prepare('UPDATE invoices SET status = ? WHERE id = ?').run(status, 'a')
    const response = await remove(request('invoices/a', 'DELETE'), context('a'))
    expect(response.status).toBe(200)
    expect(fixture.rows(schema.invoices).map(row => row.id)).toEqual(['b'])
    expect(fixture.rows(schema.invoiceItems).map(row => row.invoice_id)).toEqual(['b'])
    expect(fixture.errors).toEqual([])
  })
  it.each(['paid', 'sent', 'written_off'])('preserves the invoice, items and rails when draft becomes %s after the read', async status => {
    const beforeItems = fixture.rows(schema.invoiceItems)
    const deleteRecord = fixture.database.delete.bind(fixture.database)
    const spy = vi.spyOn(fixture.database, 'delete').mockImplementationOnce(table => {
      fixture.sqlite.prepare('UPDATE invoices SET status = ? WHERE id = ?').run(status, 'a')
      return deleteRecord(table)
    })
    try {
      const response = await remove(request('invoices/a', 'DELETE'), context('a'))
      expect(response.status).toBe(409)
      expect(fixture.rows(schema.invoices).find(row => row.id === 'a')).toMatchObject({ status })
      expect(fixture.rows(schema.invoiceItems)).toEqual(beforeItems)
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(callXeroAPI).not.toHaveBeenCalled()
      expect(stripeSecretKey).not.toHaveBeenCalled()
      expect(writes()).toHaveLength(1)
      expect(fixture.errors).toEqual([])
    } finally {
      spy.mockRestore()
    }
  })

  it.each(['super-admin', 'service'])('still refuses paid invoices for %s without financial writes', async identity => {
    if (identity === 'service') vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'api-service', orgId: 'org_tahi', sessionId: null })
    else {
      access.isSuperAdmin = true
      fixture.insert(schema.roles, { id: 'super', name: 'super_admin' })
      fixture.insert(schema.teamMemberRoles, { id: 'super-assignment', team_member_id: 'tm', role_id: 'super' })
    }
    invoice('paid', 'org-b', 'paid')
    expect((await remove(request('invoices/paid', 'DELETE'), context('paid'))).status).toBe(409)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(callXeroAPI).not.toHaveBeenCalled()
    expect(writes()).toEqual([])
  })
  it.each(['sent', 'viewed', 'overdue', 'pending', 'paid', 'written_off', 'void', 'voided', 'cancelled', 'refunded', 'unknown', ''])('refuses %s before rail or local writes', async status => {
    invoice('refused', 'org-a', status)
    const beforeInvoices = fixture.rows(schema.invoices)
    const beforeItems = fixture.rows(schema.invoiceItems)
    const response = await remove(request('invoices/refused', 'DELETE'), context('refused'))
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'Only draft invoices can be deleted' })
    expect(stripeSecretKey).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(callXeroAPI).not.toHaveBeenCalled()
    expect(writes()).toEqual([])
    expect(fixture.rows(schema.invoices)).toEqual(beforeInvoices)
    expect(fixture.rows(schema.invoiceItems)).toEqual(beforeItems)
  })
  it('deletes an accessible draft and its lines, retaining other organisations', async () => {
    const response = await remove(request('invoices/a', 'DELETE'), context('a'))
    expect(response.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledExactlyOnceWith('https://api.stripe.com/v1/invoices/in_a/void', expect.objectContaining({ method: 'POST' }))
    expect(callXeroAPI).toHaveBeenCalledExactlyOnceWith('POST', '/Invoices/x_a', { InvoiceID: 'x_a', Status: 'VOIDED' })
    expect(fixture.rows(schema.invoices).map(row => row.id)).toEqual(['b'])
    expect(fixture.rows(schema.invoiceItems).map(row => row.invoice_id)).toEqual(['b'])
    expect(fixture.errors).toEqual([])
  })
  it('refuses a foreign draft before financial or local writes', async () => {
    expect((await remove(request('invoices/b', 'DELETE'), context('b'))).status).toBe(403)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(callXeroAPI).not.toHaveBeenCalled()
    expect(writes()).toEqual([])
  })
  it('refuses a feature-denied draft before even reading its status', async () => {
    access.overrides.set('invoices', 'deny')
    expect((await remove(request('invoices/a', 'DELETE'), context('a'))).status).toBe(403)
    expect(businessQueries()).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(callXeroAPI).not.toHaveBeenCalled()
    expect(writes()).toEqual([])
  })
  it('returns 404 for a missing invoice without writes', async () => {
    expect((await remove(request('invoices/missing', 'DELETE'), context('missing'))).status).toBe(404)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(callXeroAPI).not.toHaveBeenCalled()
    expect(writes()).toEqual([])
  })
})
