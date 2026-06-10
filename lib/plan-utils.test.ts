import { describe, it, expect } from 'vitest'
import { resolveTracksConfig, buildEffectiveTracks, type RealTrackRow } from './plan-utils'

describe('resolveTracksConfig', () => {
  it('auto + maintain derives 1 small track and shows ghosts', () => {
    const c = resolveTracksConfig({ tracksMode: 'auto' }, 'maintain', false)
    expect(c).toEqual({ mode: 'auto', smallTracks: 1, largeTracks: 0, showGhosts: true })
  })

  it('auto + scale + priority derives 2 large + 1 small, ghosts on', () => {
    const c = resolveTracksConfig({ tracksMode: 'auto' }, 'scale', true)
    expect(c).toMatchObject({ mode: 'auto', smallTracks: 1, largeTracks: 2, showGhosts: true })
  })

  it('auto + custom plan (no retainer) shows no ghosts', () => {
    const c = resolveTracksConfig(null, 'custom', false)
    expect(c.mode).toBe('auto')
    expect(c.showGhosts).toBe(false)
  })

  it('custom uses explicit counts and never shows ghosts', () => {
    const c = resolveTracksConfig({ tracksMode: 'custom', customSmallTracks: 2, customLargeTracks: 1 }, 'maintain', false)
    expect(c).toEqual({ mode: 'custom', smallTracks: 2, largeTracks: 1, showGhosts: false })
  })

  it('custom clamps the total to 4 (large first)', () => {
    const c = resolveTracksConfig({ tracksMode: 'custom', customSmallTracks: 3, customLargeTracks: 3 }, 'scale', true)
    expect(c.largeTracks).toBe(3)
    expect(c.smallTracks).toBe(1)
    expect(c.largeTracks + c.smallTracks).toBe(4)
  })

  it('off zeroes the counts and kills ghosts', () => {
    const c = resolveTracksConfig({ tracksMode: 'off' }, 'scale', true)
    expect(c).toEqual({ mode: 'off', smallTracks: 0, largeTracks: 0, showGhosts: false })
  })

  it('missing override defaults to auto', () => {
    const c = resolveTracksConfig(undefined, 'maintain', false)
    expect(c.mode).toBe('auto')
  })
})

describe('buildEffectiveTracks', () => {
  const real = (id: string, type: string, currentRequestId: string | null = null): RealTrackRow =>
    ({ id, type, isPriorityTrack: false, currentRequestId })

  it('keeps a real row and pads with a synthetic shell to reach the count', () => {
    const out = buildEffectiveTracks([real('t1', 'small')], 2, 0)
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ id: 't1', synthetic: false })
    expect(out[1].synthetic).toBe(true)
    expect(out[1].type).toBe('small')
  })

  it('orders large tracks before small', () => {
    const out = buildEffectiveTracks([], 1, 1)
    expect(out.map(t => t.type)).toEqual(['large', 'small'])
  })

  it('trims extra real rows beyond the count', () => {
    const out = buildEffectiveTracks([real('a', 'small'), real('b', 'small'), real('c', 'small')], 1, 0)
    expect(out).toHaveLength(1)
  })

  it('keeps rows with an active request first when the count is tight', () => {
    const out = buildEffectiveTracks([real('idle', 'small', null), real('busy', 'small', 'req-9')], 1, 0)
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('busy')
  })

  it('all synthetic when there are no real rows', () => {
    const out = buildEffectiveTracks([], 0, 2)
    expect(out).toHaveLength(2)
    expect(out.every(t => t.synthetic)).toBe(true)
    expect(out.every(t => t.type === 'large')).toBe(true)
  })

  it('off-style zero counts yield no tracks', () => {
    expect(buildEffectiveTracks([real('t1', 'small')], 0, 0)).toEqual([])
  })
})
