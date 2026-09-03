/**
 * lib/request-vocabulary.ts
 *
 * The writable request vocabularies, in one place, so a server-side whitelist
 * can never drift from the options a person is offered on screen.
 *
 *   CREATABLE_STATUSES  - what a brand new request may be born as
 *   PATCHABLE_STATUSES  - what an existing request may be moved to
 *   REQUEST_PRIORITIES  - the two-value priority vocabulary
 *   REQUEST_TYPES       - the legacy `type` column's creatable values (size)
 *   REQUEST_CATEGORIES  - the six category tiles the request dialog offers
 *
 * Statuses derive from REQUEST_STATUSES in lib/status-config.ts (the one
 * ordered display vocabulary), so a status added there flows into both the
 * pickers and the routes without a second edit.
 *
 * Lives in lib/ rather than beside a handler because route modules may only
 * export HTTP methods and route config; the admin request routes, the bulk
 * route and the portal create route all import from here.
 */

import { REQUEST_STATUSES } from '@/lib/status-config'

/**
 * Statuses a brand new request may be created at. The request vocabulary
 * minus the two ends of its life: delivered and cancelled both carry side
 * effects (delivery timestamps, notifications) that belong to the status
 * PATCH, so a request has to be moved there rather than born there.
 */
export const CREATABLE_STATUSES: readonly string[] = REQUEST_STATUSES
  .map((s) => s.value)
  .filter((v) => v !== 'delivered' && v !== 'cancelled')

export function isCreatableStatus(value: unknown): value is string {
  return typeof value === 'string' && CREATABLE_STATUSES.includes(value)
}

/**
 * Statuses a PATCH (single or bulk) may write. The full vocabulary plus
 * 'draft', which is a real pre-submission state the rail filters on even
 * though it is not a pipeline column. Anything else is a client bug or a
 * probe, and used to land in the row verbatim.
 */
export const PATCHABLE_STATUSES: readonly string[] = [
  ...REQUEST_STATUSES.map((s) => s.value),
  'draft',
]

export function isPatchableStatus(value: unknown): value is string {
  return typeof value === 'string' && PATCHABLE_STATUSES.includes(value)
}

/** The priority vocabulary. The dialog offers Standard and High, nothing else. */
export const REQUEST_PRIORITIES: readonly string[] = ['standard', 'high']

export function isRequestPriority(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_PRIORITIES.includes(value)
}

/**
 * The `type` column's creatable values. Legacy rows still carry bug_fix,
 * content_update, consultation and new_feature; nothing writes those any
 * more, so a create is held to the two sizes the size control produces.
 */
export const REQUEST_TYPES: readonly string[] = ['small_task', 'large_task']

export function isRequestType(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_TYPES.includes(value)
}

/**
 * The category vocabulary: the six tiles the request dialog renders for both
 * audiences (components/tahi/new-request-dialog.tsx CATEGORY_TILES), which is
 * also the list db/schema.ts documents on requests.category.
 */
export const REQUEST_CATEGORIES: readonly string[] = [
  'design',
  'development',
  'content',
  'strategy',
  'admin',
  'bug',
]

export function isRequestCategory(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_CATEGORIES.includes(value)
}
