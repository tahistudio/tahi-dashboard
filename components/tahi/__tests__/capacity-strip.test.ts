import { describe, it, expect } from 'vitest'
import { orderQueue } from '../requests/capacity-strip'
import type { CapacityStripRequest } from '../requests/capacity-strip'

// The list payload, in the order /api/portal/requests returns it: updatedAt
// descending, which puts a brand new request first.
const row = (id: string, status = 'submitted'): CapacityStripRequest => ({
  id,
  title: `Request ${id}`,
  status,
  dueDate: null,
})

const listPayload: CapacityStripRequest[] = [
  row('new'),      // just submitted, so the freshest updatedAt
  row('old-a'),
  row('old-b'),
]

// What /api/portal/capacity returns: queue_order then created_at, the same
// order the submit confirmation counts positions in.
const serverQueue = [
  { id: 'old-a', title: 'Request old-a', status: 'submitted', dueDate: null },
  { id: 'old-b', title: 'Request old-b', status: 'submitted', dueDate: null },
  { id: 'new',   title: 'Request new',   status: 'submitted', dueDate: null },
]

const byId = new Map(listPayload.map(r => [r.id, r]))

describe('orderQueue', () => {
  it('follows the server order, not the list payload order', () => {
    const out = orderQueue(serverQueue, listPayload, new Set(), byId)
    expect(out.map(r => r.id)).toEqual(['old-a', 'old-b', 'new'])
  })

  it('drops anything already sitting on a lane', () => {
    const out = orderQueue(serverQueue, listPayload, new Set(['old-a']), byId)
    expect(out.map(r => r.id)).toEqual(['old-b', 'new'])
  })

  it('keeps only work still waiting to be picked up', () => {
    const queue = [
      { id: 'building', title: 'Building', status: 'in_progress', dueDate: null },
      ...serverQueue,
    ]
    const out = orderQueue(queue, listPayload, new Set(), byId)
    expect(out.map(r => r.id)).toEqual(['old-a', 'old-b', 'new'])
  })

  it('hydrates each row from the list payload when it has a richer copy', () => {
    const rich: CapacityStripRequest = {
      id: 'old-a',
      title: 'Request old-a',
      status: 'submitted',
      dueDate: '2026-09-30',
      requestNumber: 12,
      participants: [],
    }
    const out = orderQueue(serverQueue, listPayload, new Set(), new Map([['old-a', rich]]))
    expect(out[0]).toBe(rich)
    // A row the list payload does not carry still renders from the queue.
    expect(out[1]).toEqual({ id: 'old-b', title: 'Request old-b', status: 'submitted', dueDate: null })
  })

  it('falls back to the list payload when the endpoint has no queue field', () => {
    const out = orderQueue(undefined, listPayload, new Set(['old-a']), byId)
    expect(out.map(r => r.id)).toEqual(['new', 'old-b'])
  })

  it('reports an empty server queue as empty rather than falling back', () => {
    const out = orderQueue([], listPayload, new Set(), byId)
    expect(out).toEqual([])
  })
})
