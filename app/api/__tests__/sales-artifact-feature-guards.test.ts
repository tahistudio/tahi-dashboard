import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { schema } from '@/db/d1'
import { db } from '@/lib/db'
import { resolvePermissions, type ResolvedAccess } from '@/lib/permissions'
import { getRequestAuth } from '@/lib/server-auth'
import { deliverEmail } from '@/lib/email-delivery'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { permissionSqlite } from './helpers/permission-sqlite'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn(),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))
vi.mock('@/lib/db', () => ({ db: vi.fn() }))
// Keep the real route guard and feature decisions. Only permission loading is isolated.
vi.mock('@/lib/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/permissions')>()),
  resolvePermissions: vi.fn(),
}))
vi.mock('@/lib/email-delivery', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email-delivery')>()),
  deliverEmail: vi.fn().mockRejectedValue(new Error('Unexpected email delivery')),
}))
vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: vi.fn().mockRejectedValue(new Error('Unexpected storage access')),
}))

import * as contractsRoute0 from '@/app/api/admin/contracts/route'
import * as contractsRoute1 from '@/app/api/admin/contracts/[id]/route'
import * as contractsRoute2 from '@/app/api/admin/contracts/[id]/email/route'
import * as contractsRoute3 from '@/app/api/admin/contracts/[id]/preview-data/route'
import * as contractsRoute4 from '@/app/api/admin/contracts/[id]/send/route'
import * as contractsRoute5 from '@/app/api/admin/contracts/[id]/signed-pdf/route'
import * as contractsRoute6 from '@/app/api/admin/contracts/[id]/signers/route'
import * as contractsRoute7 from '@/app/api/admin/contracts/[id]/signers/[signerId]/route'
import * as contractsRoute8 from '@/app/api/admin/contracts/templates/route'
import * as contractsRoute9 from '@/app/api/admin/contracts/templates/[id]/route'
import * as proposalsRoute0 from '@/app/api/admin/proposals/route'
import * as proposalsRoute1 from '@/app/api/admin/proposals/[id]/route'
import * as proposalsRoute2 from '@/app/api/admin/proposals/[id]/email/route'
import * as proposalsRoute3 from '@/app/api/admin/proposals/[id]/preview-data/route'
import * as proposalsRoute4 from '@/app/api/admin/proposals/[id]/publish/route'
import * as proposalsRoute5 from '@/app/api/admin/proposals/[id]/sections/route'
import * as proposalsRoute6 from '@/app/api/admin/proposals/[id]/sections/[sectionId]/route'
import * as proposalsRoute7 from '@/app/api/admin/proposals/[id]/share/route'
import * as proposalsRoute8 from '@/app/api/admin/proposals/[id]/variants/route'
import * as proposalsRoute9 from '@/app/api/admin/proposals/[id]/variants/[variantId]/route'
import * as proposalsRoute10 from '@/app/api/admin/proposals/templates/route'
import * as proposalsRoute11 from '@/app/api/admin/proposals/templates/[id]/route'
import * as schedulesRoute0 from '@/app/api/admin/schedules/route'
import * as schedulesRoute1 from '@/app/api/admin/schedules/[id]/route'
import * as schedulesRoute2 from '@/app/api/admin/schedules/[id]/delivery-status/route'
import * as schedulesRoute3 from '@/app/api/admin/schedules/[id]/email/route'
import * as schedulesRoute4 from '@/app/api/admin/schedules/[id]/linked-work/route'
import * as schedulesRoute5 from '@/app/api/admin/schedules/[id]/preview-data/route'
import * as schedulesRoute6 from '@/app/api/admin/schedules/[id]/publish/route'
import * as schedulesRoute7 from '@/app/api/admin/schedules/[id]/rows/route'
import * as schedulesRoute8 from '@/app/api/admin/schedules/[id]/rows/[rowId]/route'
import * as schedulesRoute9 from '@/app/api/admin/schedules/[id]/rows/reorder/route'
import * as schedulesRoute10 from '@/app/api/admin/schedules/[id]/sections/route'
import * as schedulesRoute11 from '@/app/api/admin/schedules/[id]/sections/[sectionId]/route'
import * as schedulesRoute12 from '@/app/api/admin/schedules/[id]/sections/reorder/route'
import * as schedulesRoute13 from '@/app/api/admin/schedules/[id]/share/route'
import * as schedulesRoute14 from '@/app/api/admin/schedules/templates/route'
import * as schedulesRoute15 from '@/app/api/admin/schedules/templates/[id]/route'

type Feature = 'contracts' | 'proposals' | 'schedules'
type RouteContext = {
  params: Promise<{ id: string; signerId: string; sectionId: string; variantId: string; rowId: string }>
}
type Handler = (request: NextRequest, context: RouteContext) => Promise<Response>
const METHODS = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'])
const ROUTES: Array<{ file: string; feature: Feature; exports: Record<string, unknown> }> = [
  { file: 'contracts/route.ts', feature: 'contracts', exports: contractsRoute0 },
  { file: 'contracts/[id]/route.ts', feature: 'contracts', exports: contractsRoute1 },
  { file: 'contracts/[id]/email/route.ts', feature: 'contracts', exports: contractsRoute2 },
  { file: 'contracts/[id]/preview-data/route.ts', feature: 'contracts', exports: contractsRoute3 },
  { file: 'contracts/[id]/send/route.ts', feature: 'contracts', exports: contractsRoute4 },
  { file: 'contracts/[id]/signed-pdf/route.ts', feature: 'contracts', exports: contractsRoute5 },
  { file: 'contracts/[id]/signers/route.ts', feature: 'contracts', exports: contractsRoute6 },
  { file: 'contracts/[id]/signers/[signerId]/route.ts', feature: 'contracts', exports: contractsRoute7 },
  { file: 'contracts/templates/route.ts', feature: 'contracts', exports: contractsRoute8 },
  { file: 'contracts/templates/[id]/route.ts', feature: 'contracts', exports: contractsRoute9 },
  { file: 'proposals/route.ts', feature: 'proposals', exports: proposalsRoute0 },
  { file: 'proposals/[id]/route.ts', feature: 'proposals', exports: proposalsRoute1 },
  { file: 'proposals/[id]/email/route.ts', feature: 'proposals', exports: proposalsRoute2 },
  { file: 'proposals/[id]/preview-data/route.ts', feature: 'proposals', exports: proposalsRoute3 },
  { file: 'proposals/[id]/publish/route.ts', feature: 'proposals', exports: proposalsRoute4 },
  { file: 'proposals/[id]/sections/route.ts', feature: 'proposals', exports: proposalsRoute5 },
  { file: 'proposals/[id]/sections/[sectionId]/route.ts', feature: 'proposals', exports: proposalsRoute6 },
  { file: 'proposals/[id]/share/route.ts', feature: 'proposals', exports: proposalsRoute7 },
  { file: 'proposals/[id]/variants/route.ts', feature: 'proposals', exports: proposalsRoute8 },
  { file: 'proposals/[id]/variants/[variantId]/route.ts', feature: 'proposals', exports: proposalsRoute9 },
  { file: 'proposals/templates/route.ts', feature: 'proposals', exports: proposalsRoute10 },
  { file: 'proposals/templates/[id]/route.ts', feature: 'proposals', exports: proposalsRoute11 },
  { file: 'schedules/route.ts', feature: 'schedules', exports: schedulesRoute0 },
  { file: 'schedules/[id]/route.ts', feature: 'schedules', exports: schedulesRoute1 },
  { file: 'schedules/[id]/delivery-status/route.ts', feature: 'schedules', exports: schedulesRoute2 },
  { file: 'schedules/[id]/email/route.ts', feature: 'schedules', exports: schedulesRoute3 },
  { file: 'schedules/[id]/linked-work/route.ts', feature: 'schedules', exports: schedulesRoute4 },
  { file: 'schedules/[id]/preview-data/route.ts', feature: 'schedules', exports: schedulesRoute5 },
  { file: 'schedules/[id]/publish/route.ts', feature: 'schedules', exports: schedulesRoute6 },
  { file: 'schedules/[id]/rows/route.ts', feature: 'schedules', exports: schedulesRoute7 },
  { file: 'schedules/[id]/rows/[rowId]/route.ts', feature: 'schedules', exports: schedulesRoute8 },
  { file: 'schedules/[id]/rows/reorder/route.ts', feature: 'schedules', exports: schedulesRoute9 },
  { file: 'schedules/[id]/sections/route.ts', feature: 'schedules', exports: schedulesRoute10 },
  { file: 'schedules/[id]/sections/[sectionId]/route.ts', feature: 'schedules', exports: schedulesRoute11 },
  { file: 'schedules/[id]/sections/reorder/route.ts', feature: 'schedules', exports: schedulesRoute12 },
  { file: 'schedules/[id]/share/route.ts', feature: 'schedules', exports: schedulesRoute13 },
  { file: 'schedules/templates/route.ts', feature: 'schedules', exports: schedulesRoute14 },
  { file: 'schedules/templates/[id]/route.ts', feature: 'schedules', exports: schedulesRoute15 },
]
// Discover actual HTTP exports so an added verb cannot escape the matrix.
const HANDLERS = ROUTES.flatMap(route => Object.entries(route.exports)
  .filter(([method, handler]) => METHODS.has(method) && typeof handler === 'function')
  .map(([method, handler]) => ({
    label: method + ' /api/admin/' + route.file.replace(/\/route\.ts$/, ''),
    method, feature: route.feature, handler: handler as Handler,
  })))

function routeFiles(directory: string, prefix: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const relative = prefix + '/' + entry.name
    if (entry.isDirectory()) return routeFiles(resolve(directory, entry.name), relative)
    return entry.name === 'route.ts' ? [relative] : []
  })
}
// Walk once at collection time, rather than for every matrix row.
const DISK_ROUTES = (['contracts', 'proposals', 'schedules'] as const).flatMap(feature =>
  routeFiles(resolve(process.cwd(), 'app/api/admin', feature), feature),
)

function member(): ResolvedAccess {
  return {
    userId: 'qa_member', orgId: 'org_tahi', level: 'team_member', audience: 'team',
    isSuperAdmin: false, isAdmin: false, canManagePermissions: false,
    viewableResources: new Set(['contracts', 'proposals', 'schedules']), overrides: new Map(),
  }
}

function failBusinessRead() { throw new Error('Business database accessed before denial') }
function forbiddenDatabase() {
  return {
    select: vi.fn(failBusinessRead), selectDistinct: vi.fn(failBusinessRead),
    insert: vi.fn(failBusinessRead), update: vi.fn(failBusinessRead), delete: vi.fn(failBusinessRead),
    all: vi.fn(failBusinessRead), get: vi.fn(failBusinessRead), run: vi.fn(failBusinessRead),
    execute: vi.fn(failBusinessRead), batch: vi.fn(failBusinessRead), transaction: vi.fn(failBusinessRead),
  }
}

function request(path: string, method: string, body?: unknown) {
  return new NextRequest('http://localhost:3000/api/admin/' + path, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
  })
}
function context(id = 'artifact-1'): RouteContext {
  return { params: Promise.resolve({ id, signerId: 'signer-1', sectionId: 'section-1', variantId: 'variant-1', rowId: 'row-1' }) }
}

let database: ReturnType<typeof forbiddenDatabase>
let sqlite: ReturnType<typeof permissionSqlite> | undefined

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'qa_member', orgId: 'org_tahi', sessionId: null })
  vi.mocked(resolvePermissions).mockResolvedValue(member())
  database = forbiddenDatabase()
  vi.mocked(db).mockResolvedValue(database as unknown as Awaited<ReturnType<typeof db>>)
  vi.spyOn(crypto, 'randomUUID')
  vi.spyOn(crypto, 'getRandomValues')
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected external request')))
})
afterEach(() => {
  sqlite?.close()
  sqlite = undefined
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('sales artifact feature denial through every real HTTP handler', () => {
  it('includes every route file on disk, with at least one real HTTP export per file', () => {
    expect(ROUTES.map(route => route.file).sort()).toEqual(DISK_ROUTES.sort())
    expect(new Set(ROUTES.map(route => route.file)).size).toBe(ROUTES.length)
    for (const route of ROUTES) {
      expect(Object.entries(route.exports).some(([method, handler]) =>
        METHODS.has(method) && typeof handler === 'function',
      ), route.file).toBe(true)
    }
  })

  describe.each(['explicit denial', 'roleless member', 'outside Tahi'] as const)('%s', denial => {
    it.each(HANDLERS)('$label returns 403 before business work', async ({ feature, method, handler }) => {
      const access = member()
      if (denial === 'explicit denial') {
        // The other two surfaces remain allowed, so the wrong feature key fails this test.
        access.overrides.set(feature, 'deny')
      } else if (denial === 'roleless member') {
        access.viewableResources = new Set()
      } else {
        vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'qa_client', orgId: 'org_client', sessionId: null })
      }
      vi.mocked(resolvePermissions).mockResolvedValue(access)

      const req = new NextRequest('http://localhost:3000/api/admin/' + feature + '/artifact-1', {
        method,
        // Invalid JSON proves that permission denial happens before body validation.
        ...(!['GET', 'HEAD'].includes(method) ? { body: '{', headers: { 'Content-Type': 'application/json' } } : {}),
      })
      const readJson = vi.spyOn(req, 'json')
      const readForm = vi.spyOn(req, 'formData')
      const readText = vi.spyOn(req, 'text')
      const params = context().params
      // Some handlers destructure ctx at entry. Probe awaiting its data, not property access.
      const readParams = vi.fn(params.then.bind(params))
      const ctx: RouteContext = { params: { then: readParams } as unknown as RouteContext['params'] }

      const response = await handler(req, ctx)
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ error: 'Forbidden' })
      expect(readJson).not.toHaveBeenCalled()
      expect(readForm).not.toHaveBeenCalled()
      expect(readText).not.toHaveBeenCalled()
      expect(readParams).not.toHaveBeenCalled()
      for (const query of Object.values(database)) expect(query).not.toHaveBeenCalled()
      expect(crypto.randomUUID).not.toHaveBeenCalled()
      expect(crypto.getRandomValues).not.toHaveBeenCalled()
      expect(deliverEmail).not.toHaveBeenCalled()
      expect(getCloudflareContext).not.toHaveBeenCalled()
      expect(fetch).not.toHaveBeenCalled()

      if (denial === 'outside Tahi') {
        expect(resolvePermissions).not.toHaveBeenCalled()
        expect(db).not.toHaveBeenCalled()
      } else {
        // This db acquisition is permission loading, never a business query.
        expect(db).toHaveBeenCalledTimes(1)
        expect(resolvePermissions).toHaveBeenCalledExactlyOnceWith(database, { userId: 'qa_member', orgId: 'org_tahi' })
      }
    })
  })
})

const TEMPLATE_SURFACES = [
  { feature: 'contracts', table: schema.contractTemplates,
    list: contractsRoute8, detail: contractsRoute9,
    body: { type: 'project', bodyHtml: '<p>Deliver the agreed work.</p>' } },
  { feature: 'proposals', table: schema.proposalTemplates,
    list: proposalsRoute10, detail: proposalsRoute11,
    body: { snapshot: { title: 'Proposal', sections: [], variants: [] } } },
  { feature: 'schedules', table: schema.scheduleTemplates,
    list: schedulesRoute14, detail: schedulesRoute15,
    body: { snapshot: { scheduleMeta: { title: 'Plan' }, sections: [], rows: [] } } },
]

describe.each(['granted member', 'super admin', 'API service'] as const)('%s retains real business access', actor => {
  it.each(TEMPLATE_SURFACES)('$feature template CRUD persists real SQL through the real feature guard', async ({ feature, table, list, detail, body }) => {
    const access = member()
    if (actor === 'super admin') {
      Object.assign(access, { userId: 'qa_owner', level: 'super_admin', isSuperAdmin: true, isAdmin: true, canManagePermissions: true })
      access.viewableResources = new Set()
      access.overrides.set(feature, 'deny')
    } else if (actor === 'API service') {
      access.userId = 'api-service'
      access.viewableResources = new Set()
      access.overrides.set(feature, 'deny')
    } else {
      // A direct grant works even without a role baseline.
      access.viewableResources = new Set()
      access.overrides.set(feature, 'allow')
    }
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: access.userId, orgId: 'org_tahi', sessionId: null })
    vi.mocked(resolvePermissions).mockResolvedValue(access)
    sqlite = permissionSqlite([schema.contractTemplates, schema.proposalTemplates, schema.scheduleTemplates])
    vi.mocked(db).mockResolvedValue(sqlite.database as unknown as Awaited<ReturnType<typeof db>>)
    const path = feature + '/templates'

    const create = await list.POST(request(path, 'POST', { name: '  QA template  ', ...body }))
    expect(create.status).toBe(201)
    const { id } = await create.json() as { id: string }
    expect(id).toEqual(expect.any(String))
    expect(sqlite.rows(table)).toEqual([expect.objectContaining({ id, name: 'QA template', created_by_id: access.userId })])

    const all = await list.GET(request(path, 'GET'))
    expect(all.status).toBe(200)
    expect(await all.json()).toMatchObject({ items: [{ id, name: 'QA template' }] })
    const read = await detail.GET(request(path + '/' + id, 'GET'), context(id))
    expect(read.status).toBe(200)
    expect(await read.json()).toMatchObject({ template: { id, name: 'QA template' } })

    const update = await detail.PATCH(request(path + '/' + id, 'PATCH', { name: '  Updated template  ' }), context(id))
    expect(update.status).toBe(200)
    expect(await update.json()).toEqual({ success: true })
    expect(sqlite.rows(table)).toEqual([expect.objectContaining({ id, name: 'Updated template' })])

    const remove = await detail.DELETE(request(path + '/' + id, 'DELETE'), context(id))
    expect(remove.status).toBe(200)
    expect(await remove.json()).toEqual({ success: true })
    expect(sqlite.rows(table)).toEqual([])
    expect(sqlite.errors).toEqual([])
    expect(deliverEmail).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    if (actor === 'API service') expect(resolvePermissions).not.toHaveBeenCalled()
    else {
      expect(resolvePermissions).toHaveBeenCalledTimes(5)
      expect(resolvePermissions).toHaveBeenCalledWith(sqlite.database, { userId: access.userId, orgId: 'org_tahi' })
    }
  })
})
