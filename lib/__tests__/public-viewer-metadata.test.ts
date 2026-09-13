/**
 * generateMetadata support for the public proposal/schedule viewers.
 *
 * A shared link with no OpenGraph tags renders as a bare URL in Slack,
 * iMessage and email previews. These helpers query the same public token
 * lookup the GET routes use (no self-fetch) and fall back to a generic,
 * non-leaking title for anything invalid, revoked or never shared.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

const queue: Row[][] = []

vi.mock('@/db/d1', () => ({
  schema: new Proxy({}, {
    get: (_t, table: string) => new Proxy({}, { get: (_x, col: string) => `${table}.${col}` }),
  }),
}))

vi.mock('drizzle-orm', () => ({ eq: () => ({}) }))

vi.mock('@/lib/app-url', () => ({
  publicUrl: (p: string) => `https://portal.tahi.studio${p}`,
}))

function chain(): Record<string, unknown> {
  const b: Record<string, unknown> = {}
  for (const key of ['from', 'leftJoin', 'where', 'limit']) b[key] = () => b
  b.then = (resolve: (rows: Row[]) => void) => resolve(queue.shift() ?? [])
  return b
}

vi.mock('@/lib/db', () => ({
  db: async () => ({ select: () => chain() }),
}))

const { resolveProposalMetadata, resolveScheduleMetadata, toMetadata } = await import('../public-viewer-metadata')

describe('resolveProposalMetadata', () => {
  beforeEach(() => { queue.length = 0 })

  it('rejects a malformed token before ever touching the database', async () => {
    const doc = await resolveProposalMetadata('too-short')
    expect(doc).toEqual({ title: 'Proposal', description: 'A Tahi Studio proposal.', path: '' })
    expect(queue).toHaveLength(0)
  })

  it('falls back to the generic title for a token with no matching row', async () => {
    queue.push([])
    const doc = await resolveProposalMetadata('a'.repeat(32))
    expect(doc.title).toBe('Proposal')
    expect(doc.path).toBe('')
  })

  it('falls back to the generic title for a never-shared / revoked proposal', async () => {
    queue.push([{ title: 'Giant Group build', status: 'draft', orgName: 'Giant Group' }])
    const doc = await resolveProposalMetadata('a'.repeat(32))
    expect(doc.title).toBe('Proposal')
  })

  it('renders the real title and an org-scoped description for a shared proposal', async () => {
    const token = 'a'.repeat(32)
    queue.push([{ title: 'Giant Group {{build}}', status: 'shared', orgName: 'Giant Group' }])
    const doc = await resolveProposalMetadata(token)
    expect(doc.title).toBe('Giant Group {{build}}')
    expect(doc.description).toContain('Giant Group')
    expect(doc.path).toBe(`/p/proposal/${token}`)
  })

  it('still resolves a decided proposal so the recipient sees the same preview after accepting', async () => {
    queue.push([{ title: 'Giant Group build', status: 'accepted', orgName: 'Giant Group' }])
    const doc = await resolveProposalMetadata('a'.repeat(32))
    expect(doc.title).toBe('Giant Group build')
  })
})

describe('resolveScheduleMetadata', () => {
  beforeEach(() => { queue.length = 0 })

  it('falls back to the generic title outside the shared status', async () => {
    queue.push([{ title: 'Build plan', status: 'draft', orgName: 'Giant Group' }])
    const doc = await resolveScheduleMetadata('a'.repeat(32))
    expect(doc.title).toBe('Project schedule')
  })

  it('renders the real title for a shared schedule', async () => {
    const token = 'b'.repeat(32)
    queue.push([{ title: 'Giant Group build plan', status: 'shared', orgName: 'Giant Group' }])
    const doc = await resolveScheduleMetadata(token)
    expect(doc.title).toBe('Giant Group build plan')
    expect(doc.path).toBe(`/p/schedule/${token}`)
  })
})

describe('toMetadata', () => {
  it('always sets noindex and carries openGraph + twitter tags', () => {
    const meta = toMetadata({ title: 'Giant Group build', description: 'A Tahi Studio proposal for Giant Group.', path: '/p/proposal/tok' })
    expect(meta.robots).toEqual({ index: false, follow: false })
    expect(meta.openGraph.title).toBe('Giant Group build')
    expect(meta.openGraph.url).toBe('https://portal.tahi.studio/p/proposal/tok')
    expect(meta.openGraph.images[0].url).toBe('https://portal.tahi.studio/tahi-logo.png')
    expect(meta.twitter.card).toBe('summary_large_image')
  })

  it('omits the url for the generic fallback (empty path, no token to link)', () => {
    const meta = toMetadata({ title: 'Proposal', description: 'A Tahi Studio proposal.', path: '' })
    expect(meta.openGraph.url).toBeUndefined()
  })
})
