import { describe, it, expect } from 'vitest'
import {
  coerceTaskLinks,
  setTaskClient,
  setTaskLevel,
  setTaskRequest,
  type TaskLinkState,
} from './task-consistency'

const TAHI: TaskLinkState = { level: 'tahi_internal', orgId: null, requestId: null }
const CLIENT: TaskLinkState = { level: 'client_task', orgId: 'o1', requestId: 'r1' }

describe('setTaskLevel', () => {
  it('clears the client and the request when moving to Tahi', () => {
    expect(setTaskLevel(CLIENT, 'tahi_internal')).toEqual({
      level: 'tahi_internal', orgId: null, requestId: null,
    })
  })

  it('leaves the links alone moving between Client and Internal', () => {
    expect(setTaskLevel(CLIENT, 'internal_client_task')).toEqual({
      level: 'internal_client_task', orgId: 'o1', requestId: 'r1',
    })
  })

  it('is a no-op on the same level', () => {
    expect(setTaskLevel(CLIENT, 'client_task')).toBe(CLIENT)
  })
})

describe('setTaskClient', () => {
  it('clearing the client drops the request and falls back to Tahi', () => {
    expect(setTaskClient(CLIENT, null, null)).toEqual(TAHI)
  })

  it('setting a client on a Tahi task promotes it to Internal', () => {
    expect(setTaskClient(TAHI, 'o1', null)).toEqual({
      level: 'internal_client_task', orgId: 'o1', requestId: null,
    })
  })

  it('keeps a Client-level task at Client', () => {
    expect(setTaskClient(CLIENT, 'o2', 'o1')).toEqual({
      level: 'client_task', orgId: 'o2', requestId: null,
    })
  })

  it('keeps a request that still belongs to the new client', () => {
    expect(setTaskClient(CLIENT, 'o1', 'o1')).toEqual(CLIENT)
  })
})

describe('setTaskRequest', () => {
  it('unlinking touches nothing but the request', () => {
    expect(setTaskRequest(CLIENT, null)).toEqual({
      level: 'client_task', orgId: 'o1', requestId: null,
    })
  })

  it('linking a request adopts its client and promotes a Tahi task', () => {
    expect(setTaskRequest(TAHI, { id: 'r9', orgId: 'o9' })).toEqual({
      level: 'client_task', orgId: 'o9', requestId: 'r9',
    })
  })

  it('leaves an Internal task Internal', () => {
    const internal: TaskLinkState = { level: 'internal_client_task', orgId: 'o1', requestId: null }
    expect(setTaskRequest(internal, { id: 'r2', orgId: 'o1' })).toEqual({
      level: 'internal_client_task', orgId: 'o1', requestId: 'r2',
    })
  })
})

describe('coerceTaskLinks', () => {
  it('promotes a Tahi task that somehow carries a client', () => {
    expect(coerceTaskLinks({ level: 'tahi_internal', orgId: 'o1', requestId: null })).toEqual({
      level: 'internal_client_task', orgId: 'o1', requestId: null,
    })
  })

  it('promotes a Tahi task that carries a request all the way to Client', () => {
    expect(coerceTaskLinks({ level: 'tahi_internal', orgId: 'o1', requestId: 'r1' })).toEqual({
      level: 'client_task', orgId: 'o1', requestId: 'r1',
    })
  })

  // Deliberately NOT promoted. setTaskRequest leaves an Internal task
  // Internal when you link a request to it, and this coercion has to agree
  // with it or the same triple would mean two things depending on which door
  // it came through.
  it('leaves an Internal task with a request Internal', () => {
    expect(coerceTaskLinks({ level: 'internal_client_task', orgId: 'o1', requestId: 'r1' })).toEqual({
      level: 'internal_client_task', orgId: 'o1', requestId: 'r1',
    })
  })

  it('drops a request that has no client behind it', () => {
    expect(coerceTaskLinks({ level: 'tahi_internal', orgId: null, requestId: 'r1' })).toEqual(TAHI)
  })

  it('forces a client-flavoured level with no client back to Tahi', () => {
    expect(coerceTaskLinks({ level: 'client_task', orgId: null, requestId: null })).toEqual(TAHI)
  })

  it('leaves a consistent state untouched', () => {
    expect(coerceTaskLinks(CLIENT)).toEqual(CLIENT)
    expect(coerceTaskLinks(TAHI)).toEqual(TAHI)
  })
})
