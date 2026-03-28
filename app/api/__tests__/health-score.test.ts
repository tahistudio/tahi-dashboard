import { describe, it, expect } from 'vitest'

/**
 * T159 - Health score calculation logic tests.
 *
 * The health score is computed per client based on:
 *   - Response time (avg hours to first response)
 *   - Open requests count
 *   - Overdue requests count
 *   - NPS score (if available)
 *
 * Score range: 0-100, mapped to:
 *   healthy (70-100), at_risk (40-69), critical (0-39)
 */

// Inline the scoring logic for unit testing (mirrors the API implementation)
function calculateHealthScore(params: {
  avgResponseHours: number
  openRequests: number
  overdueRequests: number
  npsScore: number | null
  totalRequests: number
}): { score: number; status: 'healthy' | 'at_risk' | 'critical' } {
  let score = 100

  // Response time penalty: -1 point per hour over 4 hours, max -30
  if (params.avgResponseHours > 4) {
    score -= Math.min(30, Math.floor(params.avgResponseHours - 4))
  }

  // Open request load: -2 points per open request beyond 5, max -20
  if (params.openRequests > 5) {
    score -= Math.min(20, (params.openRequests - 5) * 2)
  }

  // Overdue penalty: -5 points per overdue, max -30
  score -= Math.min(30, params.overdueRequests * 5)

  // NPS bonus/penalty: scale from -10 to +10 around NPS 7
  if (params.npsScore !== null) {
    score += Math.round((params.npsScore - 7) * (10 / 3))
  }

  // No activity penalty
  if (params.totalRequests === 0) {
    score = Math.min(score, 50)
  }

  score = Math.max(0, Math.min(100, score))

  const status = score >= 70 ? 'healthy' : score >= 40 ? 'at_risk' : 'critical'
  return { score, status }
}

describe('calculateHealthScore', () => {
  it('returns 100 / healthy for a perfect client', () => {
    const result = calculateHealthScore({
      avgResponseHours: 2,
      openRequests: 3,
      overdueRequests: 0,
      npsScore: null,
      totalRequests: 10,
    })
    expect(result.score).toBe(100)
    expect(result.status).toBe('healthy')
  })

  it('penalises slow response time', () => {
    const result = calculateHealthScore({
      avgResponseHours: 20,
      openRequests: 1,
      overdueRequests: 0,
      npsScore: null,
      totalRequests: 5,
    })
    // 100 - 16 (hours over 4) = 84
    expect(result.score).toBe(84)
    expect(result.status).toBe('healthy')
  })

  it('caps response time penalty at 30', () => {
    const result = calculateHealthScore({
      avgResponseHours: 100,
      openRequests: 0,
      overdueRequests: 0,
      npsScore: null,
      totalRequests: 5,
    })
    expect(result.score).toBe(70)
    expect(result.status).toBe('healthy')
  })

  it('penalises overdue requests', () => {
    const result = calculateHealthScore({
      avgResponseHours: 2,
      openRequests: 1,
      overdueRequests: 4,
      npsScore: null,
      totalRequests: 10,
    })
    // 100 - 20 = 80
    expect(result.score).toBe(80)
    expect(result.status).toBe('healthy')
  })

  it('marks critical when many issues combine', () => {
    const result = calculateHealthScore({
      avgResponseHours: 50,
      openRequests: 20,
      overdueRequests: 6,
      npsScore: 1,
      totalRequests: 30,
    })
    // 100 - 30 (resp capped) - 20 (open: 15 over * 2 capped) - 30 (overdue capped) - 20 (NPS: (1-7)*10/3 = -20) = 0
    expect(result.score).toBe(0)
    expect(result.status).toBe('critical')
  })

  it('gives NPS bonus for high scores', () => {
    const result = calculateHealthScore({
      avgResponseHours: 1,
      openRequests: 0,
      overdueRequests: 0,
      npsScore: 10,
      totalRequests: 10,
    })
    // 100 + 10 = capped at 100
    expect(result.score).toBe(100)
    expect(result.status).toBe('healthy')
  })

  it('penalises clients with zero activity', () => {
    const result = calculateHealthScore({
      avgResponseHours: 0,
      openRequests: 0,
      overdueRequests: 0,
      npsScore: null,
      totalRequests: 0,
    })
    expect(result.score).toBe(50)
    expect(result.status).toBe('at_risk')
  })

  it('returns at_risk for moderate issues', () => {
    const result = calculateHealthScore({
      avgResponseHours: 24,
      openRequests: 10,
      overdueRequests: 2,
      npsScore: 5,
      totalRequests: 15,
    })
    // 100 - 20 (resp) - 10 (open) - 10 (overdue) - 7 (NPS: (5-7)*10/3=-7) = 53
    expect(result.score).toBe(53)
    expect(result.status).toBe('at_risk')
  })
})
