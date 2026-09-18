/**
 * lib/retainer-org-filter.ts - which organisations GET
 * /api/admin/reports/retainer-health treats as a retainer client. Pulled out
 * of the route so the rule can be unit tested without standing up a D1 mock
 * for the route's several raw-SQL queries.
 *
 * A retainer client, for this card, is one with an actual custom MRR set.
 * `customMrr` null or 0 is excluded outright, even when the org carries an
 * active subscription row: a subscription with no MRR attached is not a
 * billing commitment, and letting it through is how Tahi Test Client (Liam's
 * own test org, customMrr 0) used to get scored for churn risk alongside real
 * clients (beta audit, 2026-09-19).
 *
 * Explicitly hourly or project billed orgs never show here even with an MRR
 * set: their MRR is an estimated average for forecast purposes, not a
 * contractual retainer commitment.
 */

export interface RetainerOrgCandidate {
  billingModel: string | null
  customMrr: number | null
}

export function isRetainerOrg(org: RetainerOrgCandidate): boolean {
  if (org.billingModel === 'hourly' || org.billingModel === 'project') return false
  return !!(org.customMrr && org.customMrr > 0)
}
