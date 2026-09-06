/**
 * lib/plan-type.ts
 *
 * The plan vocabulary an organisation carries (organisations.planType) and the
 * one way to say "no plan".
 *
 * Six real plans plus the none value. The column defaults to 'none' (see
 * db/schema.ts), but rows imported or written by older code hold NULL and the
 * UI has always read both as "no plan", so every writer here folds NULL, the
 * empty select option and 'none' onto the single stored value. That keeps the
 * `?plan=` list filter and the team-access plan_type scope honest: they match
 * on the column with `=`, and a client with no plan must sit under one spelling.
 *
 * Pure, so the route, the settings card and the MCP worker agree on the
 * vocabulary without any of them reaching into a route.ts (CLAUDE.md: never
 * export a non-route symbol from a route).
 */

/** The plans a client can be on, in the order they are offered in the UI. */
export const PLAN_TYPES = [
  { value: 'maintain', label: 'Maintain' },
  { value: 'scale', label: 'Scale' },
  { value: 'tune', label: 'Tune' },
  { value: 'launch', label: 'Launch' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'custom', label: 'Custom' },
] as const

export type PlanType = (typeof PLAN_TYPES)[number]['value']

/** The stored value for "no plan". Matches the column default. */
export const NO_PLAN = 'none'

export type StoredPlanType = PlanType | typeof NO_PLAN

/** The two plans that come with a subscription row and provisioned tracks. */
export const RETAINER_PLAN_TYPES: readonly PlanType[] = ['maintain', 'scale']

export function isPlanType(value: unknown): value is PlanType {
  return typeof value === 'string' && PLAN_TYPES.some(p => p.value === value)
}

export function isRetainerPlanType(value: unknown): value is 'maintain' | 'scale' {
  return isPlanType(value) && RETAINER_PLAN_TYPES.includes(value)
}

/**
 * The value to store for a plan a caller sent.
 *
 * NULL, undefined, '' and 'none' all mean no plan and come back as NO_PLAN. A
 * real plan comes back as itself. Anything else (a typo, a number, a label
 * instead of a slug) comes back undefined so the caller can refuse it with a
 * sentence rather than write a value no list filter will ever match.
 */
export function normalisePlanType(value: unknown): StoredPlanType | undefined {
  if (value === null || value === undefined || value === '' || value === NO_PLAN) return NO_PLAN
  if (isPlanType(value)) return value
  return undefined
}

/** The sentence a route answers with when the plan is outside the vocabulary. */
export const PLAN_TYPE_ERROR =
  `planType must be one of ${PLAN_TYPES.map(p => p.value).join(', ')}, or null to leave the client with no plan.`
