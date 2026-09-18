/**
 * lib/retainer-health-bucket.ts - the three-way bucket behind the owner
 * overview's "Retainer health" card. Pulled out of owner-home.tsx so it can
 * be unit tested on its own.
 *
 * GET /api/admin/reports/retainer-health already computes `healthStatus`
 * (green | amber | red | null) per client, the same status the client detail
 * page reads. This bucket follows that status first. `churnRiskScore` is only
 * a fallback for a client with no `healthStatus` set at all, so the card can
 * never disagree with the client detail page over a client that HAS a health
 * status (beta audit, 2026-09-19: the card bucketed purely off churn score,
 * printing "1 healthy 4 at risk" while the API reported healthStatus green
 * for all five retainer clients it returned).
 */

export interface RetainerHealthClient {
  churnRiskScore: number
  healthStatus: string | null
}

export type HealthBucket = 'healthy' | 'atrisk' | 'attention'

export function healthBucket(client: RetainerHealthClient): HealthBucket {
  if (client.healthStatus === 'red') return 'attention'
  if (client.healthStatus === 'amber') return 'atrisk'
  if (client.healthStatus === 'green') return 'healthy'
  // No healthStatus on record: fall back to the churn risk score.
  if (client.churnRiskScore >= 60) return 'attention'
  if (client.churnRiskScore >= 35) return 'atrisk'
  return 'healthy'
}
