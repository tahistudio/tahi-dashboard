/**
 * Unit tests for PUT /api/admin/pipeline/stages reconciliation logic.
 *
 * The PUT endpoint reconciles the full stage list: entries with an id update,
 * entries without an id insert new rows, and stored stages missing from the
 * payload are deleted. Deletions are guarded all-or-nothing before any write:
 * core stages (default / closed won / closed lost) refuse with 400, stages
 * still referenced by deals refuse with 409.
 *
 * We mock the auth and db modules, then call the route handler directly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks - vi.mock factories cannot reference outer variables (hoisted)
// ---------------------------------------------------------------------------

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({
    userId: 'user_admin',
    orgId: 'org_tahi',
    sessionId: 'sess_1',
  }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/db/d1', () => ({
  schema: {
    pipelineStages: {
      _table: 'pipeline_stages',
      id: 'id',
      name: 'name',
      slug: 'slug',
      probability: 'probability',
      position: 'position',
      colour: 'colour',
      isDefault: 'is_default',
      isClosedWon: 'is_closed_won',
      isClosedLost: 'is_closed_lost',
      createdAt: 'created_at',
    },
    deals: {
      _table: 'deals',
      id: 'id',
      stageId: 'stage_id',
      closeReason: 'close_reason',
    },
  },
}))

type StageRecord = Record<string, unknown>

interface DbMockHandles {
  state: { stages: StageRecord[]; deals: Array<{ stageId: string }> }
  insert: ReturnType<typeof vi.fn>
  insertValues: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  updateSet: ReturnType<typeof vi.fn>
  updateWhere: ReturnType<typeof vi.fn>
  del: ReturnType<typeof vi.fn>
  deleteWhere: ReturnType<typeof vi.fn>
}

vi.mock('@/lib/db', () => {
  const state: DbMockHandles['state'] = { stages: [], deals: [] }

  const insertValues = vi.fn().mockResolvedValue(undefined)
  const insert = vi.fn().mockReturnValue({ values: insertValues })

  const updateWhere = vi.fn().mockResolvedValue(undefined)
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere })
  const update = vi.fn().mockReturnValue({ set: updateSet })

  const deleteWhere = vi.fn().mockResolvedValue(undefined)
  const del = vi.fn().mockReturnValue({ where: deleteWhere })

  const select = vi.fn().mockImplementation(() => ({
    from: (table: { _table?: string } | undefined) => {
      if (table && table._table === 'deals') {
        return { where: () => Promise.resolve(state.deals) }
      }
      // pipeline_stages: awaited directly for the existing list, or chained
      // through orderBy for the final response list.
      const promise = Promise.resolve(state.stages) as Promise<StageRecord[]> & {
        orderBy: () => Promise<StageRecord[]>
      }
      promise.orderBy = () => Promise.resolve(state.stages)
      return promise
    },
  }))

  const database = { select, insert, update, delete: del }

  return {
    db: vi.fn().mockResolvedValue(database),
    __mock: { state, insert, insertValues, update, updateSet, updateWhere, del, deleteWhere },
  }
})

// Import after mocks are set up
import { PUT } from '@/app/api/admin/pipeline/stages/route'
import { NextRequest } from 'next/server'
import * as dbModule from '@/lib/db'

const dbMock = (dbModule as unknown as { __mock: DbMockHandles }).__mock

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/pipeline/stages', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function stageRow(overrides: StageRecord): StageRecord {
  return {
    id: 'stage-id',
    name: 'Stage',
    slug: 'stage',
    probability: 10,
    position: 0,
    colour: null,
    isDefault: 0,
    isClosedWon: 0,
    isClosedLost: 0,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('PUT /api/admin/pipeline/stages (reconciliation)', () => {
  beforeEach(() => {
    dbMock.state.stages = []
    dbMock.state.deals = []
    dbMock.insert.mockClear()
    dbMock.insertValues.mockClear()
    dbMock.update.mockClear()
    dbMock.updateSet.mockClear()
    dbMock.updateWhere.mockClear()
    dbMock.del.mockClear()
    dbMock.deleteWhere.mockClear()
  })

  it('inserts entries without an id as new stages', async () => {
    dbMock.state.stages = [
      stageRow({ id: 's1', name: 'Lead', slug: 'lead', position: 0 }),
    ]

    const res = await PUT(makeRequest({
      stages: [
        { id: 's1', name: 'Lead', colour: '#60a5fa', position: 0 },
        { name: 'Qualified', colour: '#5A824E', position: 1 },
      ],
    }))

    expect(res.status).toBe(200)
    expect(dbMock.insertValues).toHaveBeenCalledTimes(1)

    const inserted = dbMock.insertValues.mock.calls[0][0] as StageRecord
    expect(inserted.name).toBe('Qualified')
    expect(inserted.slug).toBe('qualified')
    expect(inserted.position).toBe(1)
    expect(inserted.probability).toBe(10)
    expect(String(inserted.id)).toMatch(UUID_RE)

    // No stage was omitted from the payload, so nothing is deleted.
    expect(dbMock.del).not.toHaveBeenCalled()
  })

  it('deletes stored stages missing from the payload when no deal references them', async () => {
    dbMock.state.stages = [
      stageRow({ id: 's1', name: 'Lead', slug: 'lead', position: 0 }),
      stageRow({ id: 's2', name: 'Stalled', slug: 'stalled', position: 1 }),
    ]
    dbMock.state.deals = []

    const res = await PUT(makeRequest({
      stages: [{ id: 's1', name: 'Lead', position: 0 }],
    }))

    expect(res.status).toBe(200)
    expect(dbMock.del).toHaveBeenCalledTimes(1)
    expect(dbMock.deleteWhere).toHaveBeenCalledTimes(1)
    expect(dbMock.insertValues).not.toHaveBeenCalled()
  })

  it('returns 409 and writes nothing when a to-be-deleted stage still has deals', async () => {
    dbMock.state.stages = [
      stageRow({ id: 's1', name: 'Lead', slug: 'lead', position: 0 }),
      stageRow({ id: 's2', name: 'Proposal', slug: 'proposal', position: 1 }),
    ]
    dbMock.state.deals = [{ stageId: 's2' }]

    const res = await PUT(makeRequest({
      stages: [{ id: 's1', name: 'Lead', position: 0 }],
    }))

    expect(res.status).toBe(409)
    const json = await res.json() as { error?: string }
    expect(json.error).toBe('Stage "Proposal" still has deals - move them first')

    // All-or-nothing: the guard fires before any write.
    expect(dbMock.update).not.toHaveBeenCalled()
    expect(dbMock.insertValues).not.toHaveBeenCalled()
    expect(dbMock.del).not.toHaveBeenCalled()
  })

  it('returns 400 and writes nothing when a to-be-deleted stage is a core stage', async () => {
    dbMock.state.stages = [
      stageRow({ id: 's1', name: 'Lead', slug: 'lead', position: 0 }),
      stageRow({ id: 's2', name: 'Closed Won', slug: 'closed_won', position: 1, isClosedWon: 1 }),
    ]

    const res = await PUT(makeRequest({
      stages: [{ id: 's1', name: 'Lead', position: 0 }],
    }))

    expect(res.status).toBe(400)
    const json = await res.json() as { error?: string }
    expect(json.error).toContain('required by the pipeline')

    expect(dbMock.update).not.toHaveBeenCalled()
    expect(dbMock.insertValues).not.toHaveBeenCalled()
    expect(dbMock.del).not.toHaveBeenCalled()
  })

  it('returns 400 when the stages array is missing or empty', async () => {
    const missing = await PUT(makeRequest({}))
    expect(missing.status).toBe(400)

    const empty = await PUT(makeRequest({ stages: [] }))
    expect(empty.status).toBe(400)
  })

  it('returns 400 when a new stage has no name', async () => {
    dbMock.state.stages = [
      stageRow({ id: 's1', name: 'Lead', slug: 'lead', position: 0 }),
    ]

    const res = await PUT(makeRequest({
      stages: [
        { id: 's1', position: 0 },
        { colour: '#5A824E', position: 1 },
      ],
    }))

    expect(res.status).toBe(400)
    expect(dbMock.insertValues).not.toHaveBeenCalled()
  })

  it('returns 403 for non-admin users', async () => {
    const { getRequestAuth } = await import('@/lib/server-auth')
    vi.mocked(getRequestAuth).mockResolvedValueOnce({
      userId: 'user_client',
      orgId: 'org_other',
      sessionId: 'sess_2',
    })

    const res = await PUT(makeRequest({ stages: [{ id: 's1', name: 'Lead' }] }))
    expect(res.status).toBe(403)
  })
})
