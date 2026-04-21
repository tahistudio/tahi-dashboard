/**
 * pipeline-probability invariants.
 *
 * Regression guard for the Stalled-is-linear bug (2026-04-21): previous
 * formula reported Stalled at 52% and flattened every other stage around
 * 25% because it treated ordinal position as journey progress.
 */

import { describe, it, expect } from 'vitest'
import {
  buildJourneyMap,
  inferStagesVisited,
  computeStageProbabilities,
  isNonLinearStage,
  type StageInfo,
  type ActivityStageEvent,
} from '../pipeline-probability'

const STAGES: StageInfo[] = [
  { id: 'lead',          slug: 'lead',          position: 0, isClosedWon: false, isClosedLost: false },
  { id: 'discovery',     slug: 'discovery',     position: 1, isClosedWon: false, isClosedLost: false },
  { id: 'proposal',      slug: 'proposal',      position: 2, isClosedWon: false, isClosedLost: false },
  { id: 'negotiation',   slug: 'negotiation',   position: 3, isClosedWon: false, isClosedLost: false },
  { id: 'verbal_commit', slug: 'verbal_commit', position: 4, isClosedWon: false, isClosedLost: false },
  { id: 'stalled',       slug: 'stalled',       position: 5, isClosedWon: false, isClosedLost: false },
  { id: 'closed_won',    slug: 'closed_won',    position: 6, isClosedWon: true,  isClosedLost: false },
  { id: 'closed_lost',   slug: 'closed_lost',   position: 7, isClosedWon: false, isClosedLost: true },
]

describe('isNonLinearStage', () => {
  it('flags stalled', () => {
    expect(isNonLinearStage({ slug: 'stalled' })).toBe(true)
  })
  it('flags on_hold variants', () => {
    expect(isNonLinearStage({ slug: 'on_hold' })).toBe(true)
    expect(isNonLinearStage({ slug: 'on-hold' })).toBe(true)
    expect(isNonLinearStage({ slug: 'paused' })).toBe(true)
  })
  it('does not flag linear stages', () => {
    expect(isNonLinearStage({ slug: 'lead' })).toBe(false)
    expect(isNonLinearStage({ slug: 'verbal_commit' })).toBe(false)
    expect(isNonLinearStage({ slug: 'closed_won' })).toBe(false)
  })
})

describe('buildJourneyMap', () => {
  it('records initial stage from deal_created', () => {
    const events: ActivityStageEvent[] = [
      { dealId: 'd1', type: 'deal_created', metadata: JSON.stringify({ initial: { stageId: 'lead' } }), createdAt: '2026-01-01' },
    ]
    const map = buildJourneyMap(events)
    expect(map.get('d1')).toEqual(new Set(['lead']))
  })
  it('records before and after from stage_change', () => {
    const events: ActivityStageEvent[] = [
      { dealId: 'd1', type: 'stage_change', metadata: JSON.stringify({ before: { stageId: 'lead' }, after: { stageId: 'discovery' } }), createdAt: '2026-01-02' },
      { dealId: 'd1', type: 'stage_change', metadata: JSON.stringify({ before: { stageId: 'discovery' }, after: { stageId: 'proposal' } }), createdAt: '2026-01-03' },
    ]
    const map = buildJourneyMap(events)
    expect(map.get('d1')).toEqual(new Set(['lead', 'discovery', 'proposal']))
  })
  it('skips rows with no dealId', () => {
    const events: ActivityStageEvent[] = [
      { dealId: null, type: 'stage_change', metadata: JSON.stringify({ before: { stageId: 'lead' }, after: { stageId: 'discovery' } }), createdAt: '2026-01-01' },
    ]
    const map = buildJourneyMap(events)
    expect(map.size).toBe(0)
  })
  it('handles corrupt metadata gracefully', () => {
    const events: ActivityStageEvent[] = [
      { dealId: 'd1', type: 'stage_change', metadata: '{not json', createdAt: '2026-01-01' },
    ]
    const map = buildJourneyMap(events)
    expect(map.size).toBe(0)
  })
})

describe('inferStagesVisited (fallback, no journey)', () => {
  it('linear stage at position N includes all linear stages at positions <= N', () => {
    const deal = { id: 'd1', stageId: 'negotiation', stagePosition: 3 }
    const visited = inferStagesVisited(deal, STAGES, undefined)
    expect(visited).toEqual(new Set(['lead', 'discovery', 'proposal', 'negotiation']))
  })
  it('excludes Stalled from the linear backfill', () => {
    const deal = { id: 'd1', stageId: 'verbal_commit', stagePosition: 4 }
    const visited = inferStagesVisited(deal, STAGES, undefined)
    expect(visited.has('stalled')).toBe(false)
  })
  it('deal currently at Stalled is only counted for Stalled, not earlier stages', () => {
    const deal = { id: 'd1', stageId: 'stalled', stagePosition: 5 }
    const visited = inferStagesVisited(deal, STAGES, undefined)
    expect(visited).toEqual(new Set(['stalled']))
  })
  it('Closed Won deal with no history: inferred linear path up to but excluding Stalled', () => {
    const deal = { id: 'd1', stageId: 'closed_won', stagePosition: 6 }
    const visited = inferStagesVisited(deal, STAGES, undefined)
    // Should include all linear stages up to closed_won, EXCLUDING stalled.
    expect(visited.has('lead')).toBe(true)
    expect(visited.has('verbal_commit')).toBe(true)
    expect(visited.has('closed_won')).toBe(true)
    expect(visited.has('stalled')).toBe(false)
  })
  it('with activity history: trusts the journey', () => {
    const deal = { id: 'd1', stageId: 'closed_won', stagePosition: 6 }
    const journey = new Set(['lead', 'stalled', 'closed_won'])
    const visited = inferStagesVisited(deal, STAGES, journey)
    // Only what we actually saw + current.
    expect(visited).toEqual(new Set(['lead', 'stalled', 'closed_won']))
    // Notably: Discovery, Proposal, etc. are NOT inferred when we have history.
    expect(visited.has('discovery')).toBe(false)
  })
})

describe('computeStageProbabilities (end-to-end)', () => {
  it('reproduces the Stalled-is-linear bug, now fixed', () => {
    // The bug: 21 deals existed. 11 were currently closed_won, 5 closed_lost,
    // 1 stalled, 4 across earlier stages. The old math said Stalled had
    // 52% win rate because it counted all 11 wins as "past Stalled".
    const deals = [
      // 11 won (no history in activity log; pre-logging deals)
      ...Array.from({ length: 11 }, (_, i) => ({ id: `won-${i}`, stageId: 'closed_won', stagePosition: 6 })),
      // 5 lost
      ...Array.from({ length: 5 }, (_, i) => ({ id: `lost-${i}`, stageId: 'closed_lost', stagePosition: 7 })),
      // 1 currently stalled
      { id: 'stall-1', stageId: 'stalled', stagePosition: 5 },
      // Linear open deals
      { id: 'open-1', stageId: 'verbal_commit', stagePosition: 4 },
      { id: 'open-2', stageId: 'negotiation', stagePosition: 3 },
      { id: 'open-3', stageId: 'proposal', stagePosition: 2 },
      { id: 'open-4', stageId: 'discovery', stagePosition: 1 },
    ]
    const result = computeStageProbabilities({ stages: STAGES, deals, stageEvents: [] })
    // Stalled: only 1 deal ever reached it (the currently-stalled one),
    // and it hasn't won. So < minSample(3) — return null, not 52%.
    expect(result.get('stalled')?.historicalProbability).toBeNull()
    expect(result.get('stalled')?.source).toBe('insufficient')
    // Lead: every deal (21 total) was inferred to have passed through Lead
    // (except the stalled one which is currently at Stalled and we can't
    // infer linearity for it). So 20 in sample (11 won + 5 lost + 4 open),
    // 11 won. 11/20 = 55%.
    const lead = result.get('lead')!
    expect(lead.dealsSampled).toBe(20)
    expect(lead.wonCount).toBe(11)
    expect(lead.historicalProbability).toBe(55)
    // Verbal Commit sample: 11 won + 5 lost (linearly inferred to have
    // passed through) + 1 currently there = 17. Won count = 11.
    // 11/17 = 65%. Compared to the old formula's 27%, this is a big step
    // up and will tighten further as real activity history accumulates.
    const vc = result.get('verbal_commit')!
    expect(vc.dealsSampled).toBe(17)
    expect(vc.wonCount).toBe(11)
    expect(vc.historicalProbability).toBe(65)
    // Critically: Stalled no longer inflates its win rate by absorbing
    // every closed-won deal. Verbal Commit is now > Stalled, matching
    // business reality.
    const stalledProb = result.get('stalled')?.historicalProbability
    const vcProb = result.get('verbal_commit')?.historicalProbability
    if (stalledProb != null && vcProb != null) {
      expect(vcProb).toBeGreaterThan(stalledProb)
    }
  })

  it('prefers activity-log journey when deals have history', () => {
    // Three deals: one passed Lead -> Won without ever stalling, one went
    // Lead -> Stalled -> Won, one currently stalled.
    const deals = [
      { id: 'a', stageId: 'closed_won', stagePosition: 6 },
      { id: 'b', stageId: 'closed_won', stagePosition: 6 },
      { id: 'c', stageId: 'stalled', stagePosition: 5 },
    ]
    const stageEvents: ActivityStageEvent[] = [
      { dealId: 'a', type: 'deal_created', metadata: JSON.stringify({ initial: { stageId: 'lead' } }), createdAt: '2026-01-01' },
      { dealId: 'a', type: 'stage_change', metadata: JSON.stringify({ before: { stageId: 'lead' }, after: { stageId: 'closed_won' } }), createdAt: '2026-01-05' },
      { dealId: 'b', type: 'deal_created', metadata: JSON.stringify({ initial: { stageId: 'lead' } }), createdAt: '2026-01-01' },
      { dealId: 'b', type: 'stage_change', metadata: JSON.stringify({ before: { stageId: 'lead' }, after: { stageId: 'stalled' } }), createdAt: '2026-01-02' },
      { dealId: 'b', type: 'stage_change', metadata: JSON.stringify({ before: { stageId: 'stalled' }, after: { stageId: 'closed_won' } }), createdAt: '2026-01-05' },
      { dealId: 'c', type: 'deal_created', metadata: JSON.stringify({ initial: { stageId: 'lead' } }), createdAt: '2026-01-01' },
      { dealId: 'c', type: 'stage_change', metadata: JSON.stringify({ before: { stageId: 'lead' }, after: { stageId: 'stalled' } }), createdAt: '2026-01-02' },
    ]
    const result = computeStageProbabilities({ stages: STAGES, deals, stageEvents })
    // Stalled: 2 deals passed through (b and c). 1 of them (b) won. 50%.
    const stalled = result.get('stalled')!
    expect(stalled.dealsSampled).toBe(2)
    expect(stalled.wonCount).toBe(1)
    // Sample size 2 is under minSample(3), so historicalProbability is null
    // but the counts reflect reality.
    expect(stalled.historicalProbability).toBeNull()
  })

  it('gates on minSample', () => {
    const deals = [
      { id: 'a', stageId: 'lead', stagePosition: 0 },
      { id: 'b', stageId: 'lead', stagePosition: 0 },
    ]
    const result = computeStageProbabilities({ stages: STAGES, deals, stageEvents: [], minSample: 5 })
    expect(result.get('lead')?.historicalProbability).toBeNull()
    expect(result.get('lead')?.source).toBe('insufficient')
  })

  it('returns null for closed stages', () => {
    const result = computeStageProbabilities({
      stages: STAGES,
      deals: [{ id: 'a', stageId: 'closed_won', stagePosition: 6 }],
      stageEvents: [],
    })
    expect(result.get('closed_won')?.historicalProbability).toBeNull()
    expect(result.get('closed_lost')?.historicalProbability).toBeNull()
  })
})
