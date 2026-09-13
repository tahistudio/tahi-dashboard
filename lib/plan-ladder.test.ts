/**
 * The plan ladder's three rules, tested where they are decided.
 *
 *   1. The ladder orders itself around the client's own plan, and a client at
 *      either end sees two rungs rather than a filler third.
 *   2. A rung only carries a number when the number is the client's own.
 *   3. The upsell is a consequence of usage, so planPressure stays silent
 *      until the client's own figures earn it.
 */

import { describe, it, expect } from 'vitest'
import {
  LADDER_ORDER,
  PRESSURE_AT,
  RUNGS,
  isLadderPlanName,
  ladder,
  ladderPlanNames,
  planPressure,
  rungLive,
} from './plan-ladder'

describe('ladder order', () => {
  it('puts the client in the middle with a neighbour either side', () => {
    const view = ladder('maintain')
    expect(view?.down?.key).toBe('tune')
    expect(view?.here.key).toBe('maintain')
    expect(view?.up?.key).toBe('scale')
  })

  it('gives the lowest plan no step down rather than a filler rung', () => {
    const view = ladder('tune')
    expect(view?.down).toBeNull()
    expect(view?.here.key).toBe('tune')
    expect(view?.up?.key).toBe('maintain')
  })

  it('gives the highest plan no step up', () => {
    const view = ladder('launch')
    expect(view?.down?.key).toBe('scale')
    expect(view?.up).toBeNull()
  })

  it('carries the rung copy through, so a rung is never a bare name', () => {
    const view = ladder('scale')
    expect(view?.here.bestIf).toBe(RUNGS.scale.bestIf)
    expect(view?.here.tracks).toBe(RUNGS.scale.tracks)
    expect(view?.here.turnaround).toBe(RUNGS.scale.turnaround)
    expect(view?.here.services).toBe(RUNGS.scale.services)
  })

  it('answers null for a custom plan: those clients are not standing on a step', () => {
    expect(ladder('custom')).toBeNull()
  })

  it('answers null for hourly, which is a way of working and not a rung', () => {
    expect(ladder('hourly')).toBeNull()
  })

  it('answers null for no plan at all, and for anything unrecognised', () => {
    expect(ladder('none')).toBeNull()
    expect(ladder(null)).toBeNull()
    expect(ladder(undefined)).toBeNull()
    expect(ladder('')).toBeNull()
    expect(ladder('enterprise')).toBeNull()
  })

  it('follows a plan the studio renamed in settings', () => {
    const view = ladder('maintain', { maintain: 'Steady', scale: 'Momentum' })
    expect(view?.here.name).toBe('Steady')
    expect(view?.up?.name).toBe('Momentum')
    // An override that is blank or missing falls back to the studio copy.
    expect(view?.down?.name).toBe('Tune')
  })

  it('every ladder id has copy, so no rung can render empty', () => {
    for (const key of LADDER_ORDER) {
      expect(RUNGS[key].name.length).toBeGreaterThan(0)
      expect(RUNGS[key].bestIf.length).toBeGreaterThan(0)
    }
  })
})

describe('plan rows in the catalogue', () => {
  it('names every plan on the ladder', () => {
    expect(ladderPlanNames()).toEqual(['Tune', 'Maintain', 'Scale', 'Launch'])
  })

  it('recognises a catalogue row that is really a plan, whatever its casing', () => {
    expect(isLadderPlanName('Maintain')).toBe(true)
    expect(isLadderPlanName('  scale ')).toBe(true)
  })

  it('leaves a real service alone', () => {
    expect(isLadderPlanName('Lottie animation')).toBe(false)
    expect(isLadderPlanName('')).toBe(false)
    expect(isLadderPlanName(null)).toBe(false)
  })

  it('follows the rename, so a renamed plan still leaves the grid', () => {
    expect(isLadderPlanName('Steady', { maintain: 'Steady' })).toBe(true)
  })
})

describe('rungLive: only the client\'s own numbers', () => {
  it('prints the real track entitlement and the real measured turnaround', () => {
    const live = rungLive({ trackCount: 2, avgTurnaroundDays: 6 })
    expect(live.tracks).toBe('2 tracks, building at the same time.')
    expect(live.turnaround).toBe('6 days from asked to delivered, averaged over your own work.')
  })

  it('says one track and one day in words a person would use', () => {
    const live = rungLive({ trackCount: 1, avgTurnaroundDays: 1 })
    expect(live.tracks).toBe('One track, building at a time.')
    expect(live.turnaround).toBe('1 day from asked to delivered, averaged over your own work.')
  })

  it('returns null rather than a guess when nothing has been delivered yet', () => {
    const live = rungLive({ trackCount: 2, avgTurnaroundDays: null })
    expect(live.tracks).toBe('2 tracks, building at the same time.')
    expect(live.turnaround).toBeNull()
  })

  it('returns null for both when the portal could source neither', () => {
    expect(rungLive({})).toEqual({ tracks: null, turnaround: null })
    expect(rungLive({ trackCount: 0, avgTurnaroundDays: 0 })).toEqual({ tracks: null, turnaround: null })
  })
})

describe('planPressure: the queue signal', () => {
  it('stays silent when the queue fits on the tracks', () => {
    expect(planPressure({ trackCount: 2, openCount: 2 })).toEqual([])
    expect(planPressure({ trackCount: 2, openCount: 1 })).toEqual([])
  })

  it('fires one past the track count, and counts the overflow', () => {
    const signals = planPressure({ trackCount: 2, openCount: 3 })
    expect(signals).toHaveLength(1)
    expect(signals[0].key).toBe('queue')
    expect(signals[0].body).toContain('There are 3 things waiting and 2 tracks')
    expect(signals[0].body).toContain('one keeps waiting')
  })

  it('reads grammatically on a single track plan with several waiting', () => {
    const [signal] = planPressure({ trackCount: 1, openCount: 4 })
    expect(signal.body).toContain('and one track to pull them onto')
    expect(signal.body).toContain('3 keep waiting')
  })

  it('stays silent with no entitlement to measure against', () => {
    expect(planPressure({ trackCount: 0, openCount: 9 })).toEqual([])
    expect(planPressure({ openCount: 9 })).toEqual([])
    expect(planPressure({})).toEqual([])
  })
})

describe('planPressure: the track days signal', () => {
  const lanes = [{ days: 9, studioDays: 10 }, { days: 8, studioDays: 10 }]

  it('fires once the tracks were busy for most of the month', () => {
    const signals = planPressure({ monthLabel: 'September', lanes })
    expect(signals.map(s => s.key)).toEqual(['tracks'])
    expect(signals[0].body).toContain('worked on 17 of the 20 track days')
    expect(signals[0].body).toContain('September')
  })

  it('stays under the threshold when there was room left', () => {
    expect(planPressure({
      monthLabel: 'September',
      lanes: [{ days: 4, studioDays: 10 }],
    })).toEqual([])
  })

  it('lands exactly on the threshold rather than just past it', () => {
    const ratio = PRESSURE_AT.busy
    const signals = planPressure({
      monthLabel: 'September',
      lanes: [{ days: ratio * 20, studioDays: 20 }],
    })
    expect(signals).toHaveLength(1)
  })

  it('says nothing when nothing writes lane days, which is the portal today', () => {
    expect(planPressure({ trackCount: 2, openCount: 2, monthLabel: 'September' })).toEqual([])
    expect(planPressure({ lanes, monthLabel: null })).toEqual([])
  })
})

describe('planPressure: the hours signal', () => {
  it('fires near an hourly cap', () => {
    const signals = planPressure({ hoursCap: 20, hoursUsed: 18 })
    expect(signals.map(s => s.key)).toEqual(['hours'])
    expect(signals[0].body).toContain('18 of the 20 hours')
  })

  it('invents no denominator for a retainer client, who has no cap', () => {
    expect(planPressure({ trackCount: 2, openCount: 2, hoursUsed: 40 })).toEqual([])
    expect(planPressure({ hoursCap: 0, hoursUsed: 40 })).toEqual([])
  })
})

describe('planPressure: more than one edge at once', () => {
  it('returns them in the order they were named, queue first', () => {
    const signals = planPressure({
      trackCount: 2,
      openCount: 5,
      monthLabel: 'September',
      lanes: [{ days: 10, studioDays: 10 }],
      hoursCap: 10,
      hoursUsed: 10,
    })
    expect(signals.map(s => s.key)).toEqual(['queue', 'tracks', 'hours'])
  })
})
