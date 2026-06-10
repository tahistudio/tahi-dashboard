import { describe, it, expect } from 'vitest'
import { trackDeliveredStats, deliveredInWindow } from '@/lib/track-stats'
import { getUpgradeGhostTracks } from '@/lib/plan-utils'

const NOW = '2026-06-11T00:00:00Z'
const daysAgo = (n: number) => new Date(new Date(NOW).getTime() - n * 86400000).toISOString()

describe('trackDeliveredStats', () => {
  it('counts only items delivered within the window', () => {
    const items = [
      { deliveredAt: daysAgo(5), createdAt: daysAgo(9) },   // in
      { deliveredAt: daysAgo(29), createdAt: daysAgo(33) },  // in
      { deliveredAt: daysAgo(45), createdAt: daysAgo(50) },  // out (>30d)
      { deliveredAt: null, createdAt: daysAgo(2) },          // not delivered
    ]
    const s = trackDeliveredStats(items, NOW, 30)
    expect(s.count).toBe(2)
  })

  it('averages turnaround in whole days (min 1)', () => {
    const items = [
      { deliveredAt: daysAgo(2), createdAt: daysAgo(6) },  // 4d
      { deliveredAt: daysAgo(3), createdAt: daysAgo(9) },  // 6d
    ]
    expect(trackDeliveredStats(items, NOW).avgTurnaroundDays).toBe(5) // (4+6)/2
  })

  it('same-day delivery rounds up to 1 day, not 0', () => {
    const items = [{ deliveredAt: daysAgo(1), createdAt: daysAgo(1) }]
    expect(trackDeliveredStats(items, NOW).avgTurnaroundDays).toBe(1)
  })

  it('returns null turnaround when nothing delivered', () => {
    const s = trackDeliveredStats([], NOW)
    expect(s).toEqual({ count: 0, avgTurnaroundDays: null })
  })

  it('deliveredInWindow excludes future + missing dates', () => {
    const items = [
      { deliveredAt: daysAgo(-2), createdAt: daysAgo(5) }, // future delivery -> excluded
      { deliveredAt: daysAgo(1), createdAt: daysAgo(3) },  // in
      { deliveredAt: null, createdAt: daysAgo(1) },        // excluded
    ]
    expect(deliveredInWindow(items, NOW, 30)).toHaveLength(1)
  })
})

describe('getUpgradeGhostTracks', () => {
  it('maintain (no priority) upsells a 2nd small track + a large track', () => {
    const g = getUpgradeGhostTracks('maintain', false)
    expect(g.map(t => t.type)).toEqual(['small', 'large'])
  })

  it('maintain + priority upsells only a large track (Scale)', () => {
    const g = getUpgradeGhostTracks('maintain', true)
    expect(g).toHaveLength(1)
    expect(g[0].type).toBe('large')
  })

  it('scale (no priority) upsells a second large track', () => {
    const g = getUpgradeGhostTracks('scale', false)
    expect(g).toHaveLength(1)
    expect(g[0].type).toBe('large')
  })

  it('scale + priority is top tier — no ghosts', () => {
    expect(getUpgradeGhostTracks('scale', true)).toEqual([])
  })

  it('no recognised plan -> no ghosts', () => {
    expect(getUpgradeGhostTracks(null, false)).toEqual([])
    expect(getUpgradeGhostTracks('custom', false)).toEqual([])
  })
})
