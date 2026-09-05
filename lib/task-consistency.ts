/**
 * lib/task-consistency.ts
 *
 * The three invariants that hold the level, the client and the request
 * together. They are the semantic core of the Tasks surface, so they live in
 * one pure module that the detail panel, the create dialog, the quick add and
 * the API route all read, rather than three near-copies of the same if-tree.
 *
 * The invariants, stated once:
 *   - A Tahi task has no client and no request.
 *   - Any task with a request has a client, and it is that request's client.
 *   - Any task with a client is Client level or Internal level.
 */

import type { TaskLevel } from '@/lib/tasks-views'

export interface TaskLinkState {
  level: TaskLevel
  orgId: string | null
  requestId: string | null
}

/**
 * Change the level. Moving to Tahi drops both links, because studio
 * housekeeping cannot carry a client. Moving between Client and Internal
 * changes nothing else: the same work can be client-facing or not.
 */
export function setTaskLevel(state: TaskLinkState, level: TaskLevel): TaskLinkState {
  if (state.level === level) return state
  if (level === 'tahi_internal') {
    return { level, orgId: null, requestId: null }
  }
  return { ...state, level }
}

/**
 * Change the client.
 *
 * `linkedRequestOrgId` is the client the currently linked request belongs to,
 * or null when nothing is linked. The caller has that to hand from the
 * request list it already loaded; passing it in keeps this module free of
 * lookups.
 */
export function setTaskClient(
  state: TaskLinkState,
  orgId: string | null,
  linkedRequestOrgId: string | null,
): TaskLinkState {
  if (!orgId) {
    // No client means no request either, and the task falls back to being
    // the studio's own unless it was already explicitly Internal or Client
    // for a reason the user is about to restate.
    return { level: 'tahi_internal', orgId: null, requestId: null }
  }

  const level: TaskLevel = state.level === 'tahi_internal' ? 'internal_client_task' : state.level
  // A request that belongs to a different client cannot survive the move.
  const requestId = state.requestId && linkedRequestOrgId === orgId ? state.requestId : null
  return { level, orgId, requestId }
}

/**
 * Change the linked request. Linking adopts the request's client, because a
 * task and its request disagreeing about the client is the one state nothing
 * downstream can render honestly.
 */
export function setTaskRequest(
  state: TaskLinkState,
  request: { id: string; orgId: string | null } | null,
): TaskLinkState {
  if (!request) return { ...state, requestId: null }
  const level: TaskLevel = state.level === 'tahi_internal' ? 'client_task' : state.level
  return { level, orgId: request.orgId, requestId: request.id }
}

/**
 * Belt and braces for every path that builds a task from parts rather than by
 * editing one: quick add, the board's column composer, templates, duplicate,
 * and the POST route. Applied last, it makes an inconsistent triple
 * impossible to persist.
 *
 * It only ever REPAIRS a level that cannot be true; it never overrides a level
 * the caller stated and could have meant. In particular an Internal task that
 * carries a request stays Internal, because setTaskRequest above leaves it
 * Internal too. The prototype's own coercion promoted it to Client while its
 * setRequest rule did not, so the same triple meant two different things
 * depending on which door it came through. One rule, stated once.
 *
 * Callers that want the "moving to Tahi clears the links" behaviour must run
 * setTaskLevel first: this function reads a client on a Tahi task as a level
 * that needs fixing, not as links that need dropping.
 */
export function coerceTaskLinks(state: TaskLinkState): TaskLinkState {
  const { orgId } = state
  let { level, requestId } = state

  // A request with no client behind it is not a link, it is a dangling id.
  if (requestId && !orgId) requestId = null

  // No client at all: only one level can be true.
  if (!orgId) return { level: 'tahi_internal', orgId: null, requestId: null }

  // A client is present, so Tahi is the one level that cannot be true. A
  // linked request makes it client-facing; a bare client does not.
  if (level === 'tahi_internal') level = requestId ? 'client_task' : 'internal_client_task'

  return { level, orgId, requestId }
}
