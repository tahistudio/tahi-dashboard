import { describe, it, expect } from 'vitest'
import { healthBucket, type RetainerHealthClient } from '@/lib/retainer-health-bucket'

const client = (over: Partial<RetainerHealthClient> = {}): RetainerHealthClient => ({
  churnRiskScore: 0,
  healthStatus: null,
  ...over,
})

describe('healthBucket', () => {
  it('follows healthStatus green as healthy, regardless of churn score', () => {
    expect(healthBucket(client({ healthStatus: 'green', churnRiskScore: 90 }))).toBe('healthy')
  })

  it('follows healthStatus amber as at risk, regardless of churn score', () => {
    expect(healthBucket(client({ healthStatus: 'amber', churnRiskScore: 0 }))).toBe('atrisk')
  })

  it('follows healthStatus red as needs attention, regardless of churn score', () => {
    expect(healthBucket(client({ healthStatus: 'red', churnRiskScore: 0 }))).toBe('attention')
  })

  it('reproduces the live beta bug fix: five clients, all healthStatus green, all bucket healthy', () => {
    // Beta audit, 2026-09-19: churn scores were 50, 50, 35, 35, 20, and the
    // card read "1 healthy 4 at risk" while every one of the five had
    // healthStatus green from the API.
    const clients = [50, 50, 35, 35, 20].map(churnRiskScore =>
      client({ healthStatus: 'green', churnRiskScore }),
    )
    expect(clients.map(healthBucket)).toEqual(['healthy', 'healthy', 'healthy', 'healthy', 'healthy'])
  })

  it('falls back to churnRiskScore >= 60 as needs attention when healthStatus is null', () => {
    expect(healthBucket(client({ healthStatus: null, churnRiskScore: 60 }))).toBe('attention')
  })

  it('falls back to churnRiskScore >= 35 as at risk when healthStatus is null', () => {
    expect(healthBucket(client({ healthStatus: null, churnRiskScore: 35 }))).toBe('atrisk')
  })

  it('falls back to healthy when healthStatus is null and churn score is low', () => {
    expect(healthBucket(client({ healthStatus: null, churnRiskScore: 34 }))).toBe('healthy')
  })

  it('treats an unrecognised healthStatus string as null (falls back to churn score)', () => {
    expect(healthBucket(client({ healthStatus: 'unknown', churnRiskScore: 70 }))).toBe('attention')
  })
})
