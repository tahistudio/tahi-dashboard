/**
 * lib/task-comments.ts#postTaskComment.
 *
 * The one behaviour worth pinning down: a comment always lands in
 * task_comments, and it ALSO mirrors into the linked request's thread as an
 * internal message, but only when the task actually has a requestId (and an
 * orgId, which a linked task always carries). A task with no request has
 * nowhere else this line belongs, so nothing extra is written.
 */
import { describe, it, expect } from 'vitest'
import { schema } from '@/db/d1'
import { postTaskComment, listTaskComments } from '../task-comments'

interface TaskRow { id: string; requestId: string | null; orgId: string | null }

function fakeDrizzle(taskRow: TaskRow | undefined) {
  const inserted: Array<{ table: unknown; values: Record<string, unknown> }> = []
  const database = {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                limit: async () => (taskRow ? [taskRow] : []),
              }
            },
          }
        },
      }
    },
    insert(table: unknown) {
      return {
        values(vals: Record<string, unknown>) {
          inserted.push({ table, values: vals })
          return Promise.resolve()
        },
      }
    },
  }
  return { database: database as unknown as Parameters<typeof postTaskComment>[0], inserted }
}

describe('postTaskComment', () => {
  it('inserts a task_comments row', async () => {
    const { database, inserted } = fakeDrizzle({ id: 't1', requestId: null, orgId: null })

    const comment = await postTaskComment(database, {
      taskId: 't1',
      author: { authorType: 'team_member', authorId: 'tm1' },
      body: 'Following up tomorrow',
    })

    const taskCommentInsert = inserted.find(i => i.table === schema.taskComments)
    expect(taskCommentInsert).toBeDefined()
    expect(taskCommentInsert?.values.taskId).toBe('t1')
    expect(taskCommentInsert?.values.authorType).toBe('team_member')
    expect(taskCommentInsert?.values.authorId).toBe('tm1')
    expect(taskCommentInsert?.values.body).toBe('Following up tomorrow')
    expect(comment.id).toBeTruthy()
  })

  it('does NOT mirror into messages when the task has no requestId', async () => {
    const { database, inserted } = fakeDrizzle({ id: 't1', requestId: null, orgId: 'org1' })

    await postTaskComment(database, {
      taskId: 't1',
      author: { authorType: 'team_member', authorId: 'tm1' },
      body: 'Tahi-internal note',
    })

    expect(inserted.filter(i => i.table === schema.messages)).toHaveLength(0)
  })

  it('mirrors into the request thread as an internal message when the task has a requestId', async () => {
    const { database, inserted } = fakeDrizzle({ id: 't1', requestId: 'r1', orgId: 'org1' })

    await postTaskComment(database, {
      taskId: 't1',
      author: { authorType: 'team_member', authorId: 'tm1' },
      body: 'Shipped the first draft',
    })

    const mirrored = inserted.find(i => i.table === schema.messages)
    expect(mirrored).toBeDefined()
    expect(mirrored?.values.requestId).toBe('r1')
    expect(mirrored?.values.orgId).toBe('org1')
    expect(mirrored?.values.authorType).toBe('team_member')
    expect(mirrored?.values.authorId).toBe('tm1')
    expect(mirrored?.values.body).toBe('Shipped the first draft')
    expect(mirrored?.values.isInternal).toBe(true)
  })

  it('prefixes the mirrored line with the quote when one is given', async () => {
    const { database, inserted } = fakeDrizzle({ id: 't1', requestId: 'r1', orgId: 'org1' })

    await postTaskComment(database, {
      taskId: 't1',
      author: { authorType: 'team_member', authorId: 'tm1' },
      body: 'Marking this done',
      quote: 'the homepage hero is live',
    })

    const mirrored = inserted.find(i => i.table === schema.messages)
    expect(mirrored?.values.body).toBe('"the homepage hero is live"\n\nMarking this done')

    const taskComment = inserted.find(i => i.table === schema.taskComments)
    expect(taskComment?.values.quote).toBe('the homepage hero is live')
  })

  it('stamps the Tahi bot identity on the mirrored line rather than a null author', async () => {
    const { database, inserted } = fakeDrizzle({ id: 't1', requestId: 'r1', orgId: 'org1' })

    await postTaskComment(database, {
      taskId: 't1',
      author: { authorType: 'bot', authorId: null },
      body: 'The call said this is done',
      quote: 'yeah that one is shipped',
      sourceRef: 'call_42',
    })

    const taskComment = inserted.find(i => i.table === schema.taskComments)
    expect(taskComment?.values.authorType).toBe('bot')
    expect(taskComment?.values.authorId).toBeNull()
    expect(taskComment?.values.sourceRef).toBe('call_42')

    const mirrored = inserted.find(i => i.table === schema.messages)
    expect(mirrored?.values.authorType).toBe('bot')
    expect(mirrored?.values.authorId).toBe('tahi-bot')
  })

  it('throws rather than writing a comment onto a task that no longer exists', async () => {
    const { database, inserted } = fakeDrizzle(undefined)

    await expect(
      postTaskComment(database, { taskId: 'ghost', author: { authorType: 'team_member', authorId: 'tm1' }, body: 'x' }),
    ).rejects.toThrow('Task not found')
    expect(inserted).toHaveLength(0)
  })
})

describe('listTaskComments', () => {
  it('sorts oldest first, the order a thread reads in', async () => {
    const rows = [
      { id: 'c2', taskId: 't1', authorType: 'team_member', authorId: 'tm1', body: 'second', quote: null, sourceRef: null, createdAt: '2026-09-19T10:00:00Z' },
      { id: 'c1', taskId: 't1', authorType: 'team_member', authorId: 'tm1', body: 'first', quote: null, sourceRef: null, createdAt: '2026-09-19T09:00:00Z' },
    ]
    const database = {
      select() {
        return { from: () => ({ where: async () => rows }) }
      },
    } as unknown as Parameters<typeof listTaskComments>[0]

    const ordered = await listTaskComments(database, 't1')
    expect(ordered.map(c => c.id)).toEqual(['c1', 'c2'])
  })
})
