import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { NextRequest, type NextResponse } from 'next/server'
import middlewareModule from '@/middleware'
import { isRecorderDeviceRouteAllowed } from '@/lib/recorder-device-routes'

vi.mock('@clerk/nextjs/server', () => ({ clerkMiddleware: (handler: unknown) => handler, createRouteMatcher: () => () => false }))
vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/lib/onboarding-invites', () => ({ resolveInvite: vi.fn(), isSeatInvite: vi.fn() }))

const middleware = middlewareModule as unknown as (auth: unknown, req: NextRequest) => Promise<NextResponse>
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
const ID = '6f8b9817-1319-47b3-93dd-b6868981090a'
const ALLOWED = new Set([
  'GET /api/admin/recordings', 'POST /api/admin/recordings',
  'GET /api/admin/recordings/upcoming-calls', `GET /api/admin/recordings/${ID}`,
  `POST /api/admin/recordings/${ID}/chunks`, `PUT /api/admin/recordings/${ID}/chunks`,
  `POST /api/admin/recordings/${ID}/stop`, `POST /api/admin/recordings/${ID}/transcribe`,
])

function routes(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? routes(path) : entry.name === 'route.ts' ? [path] : []
  })
}

describe('recorder device route walk', () => {
  it('returns 401 for a device bearer on every route and method outside the explicit allowlist', async () => {
    const files = routes(join(process.cwd(), 'app', 'api'))
    expect(files.length).toBeGreaterThan(100)
    const seen = new Set<string>()
    for (const file of files) {
      const pathname = `/${relative(join(process.cwd(), 'app'), file).replaceAll('\\', '/').replace(/\/route\.ts$/, '')}`
        .replace(/\[\[?[^/]+?\]\]?/g, ID)
      for (const method of METHODS) {
        const key = `${method} ${pathname}`
        const response = await middleware(vi.fn(), new NextRequest(`https://portal.tahi.studio${pathname}`, {
          method, headers: { authorization: 'Bearer tahi_rec_test' },
        }))
        expect(response.status, key).toBe(ALLOWED.has(key) ? 200 : 401)
        if (ALLOWED.has(key)) seen.add(key)
      }
    }
    expect([...seen].sort()).toEqual([...ALLOWED].sort())
  }, 30_000)

  it('keeps handler opt-ins explicit and refuses deletion, linking, public pairing and malformed paths', () => {
    const routeFiles = routes(join(process.cwd(), 'app', 'api', 'admin', 'recordings'))
    const methods: string[] = []
    for (const file of routeFiles) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/device: '(create|chunk|stop|transcribe|read)'/g)) methods.push(match[1])
    }
    expect(methods.sort()).toEqual(['chunk', 'chunk', 'create', 'read', 'read', 'read', 'stop', 'transcribe'])
    for (const [method, path] of [
      ['DELETE', `/api/admin/recordings/${ID}`], ['PATCH', `/api/admin/recordings/${ID}/link`],
      ['POST', `/api/admin/recordings/${ID}/link`], ['POST', '/api/public/recorder/pair'],
      ['GET', '/api/admin/recordings/upcoming-calls/chunks'], ['GET', '/api/admin/recordings/%2fsecret'],
      ['GET', '/api/admin/recordings/x/../secret'],
    ]) expect(isRecorderDeviceRouteAllowed(method, path), `${method} ${path}`).toBe(false)
  })
})
