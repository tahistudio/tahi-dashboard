import { describe, it, expect } from 'vitest'
import {
  ARCHIVED_VIEW_KEY,
  DEFAULT_CLIENTS_SORT,
  DEFAULT_CLIENT_FILTERS,
  ENGAGEMENT_LABEL,
  UNASSIGNED_OWNER,
  applyClientViews,
  clientTagValues,
  clientsSnapshotsEqual,
  countClientsSavedViews,
  engagementStatLabel,
  healthReasons,
  isClientsSnapshot,
  matchesClientFilters,
  mrrFallbackLabel,
  showsArchived,
  sortClients,
  statusFromUrl,
  toClientRow,
  tracksLine,
  type ClientApiRow,
  type ClientRow,
} from '../clients-views'

function api(over: Partial<ClientApiRow> & { id: string; name: string }): ClientApiRow {
  return {
    status: 'active',
    planType: 'maintain',
    healthStatus: 'green',
    openRequestCount: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
    tags: '[]',
    brands: '[]',
    tracksMode: 'auto',
    ...over,
  }
}

const base = {
  savedView: null as string | null,
  filters: { ...DEFAULT_CLIENT_FILTERS },
  query: '',
  sort: DEFAULT_CLIENTS_SORT,
}

describe('toClientRow', () => {
  it('parses the JSON columns and resolves the plan track shape', () => {
    const row = toClientRow(api({
      id: 'a', name: 'Kowtow', planType: 'scale', tags: '["vip","retainer"]', brands: '["One","Two"]',
    }))
    expect(row.tags).toEqual(['vip', 'retainer'])
    expect(row.brandCount).toBe(2)
    expect(row.engagement).toBe('retainer')
    // scale without priority support is one large plus one small
    expect(row.tracks).toMatchObject({ mode: 'auto', small: 1, large: 1, total: 2 })
  })

  it('survives a corrupt JSON column rather than throwing', () => {
    const row = toClientRow(api({ id: 'a', name: 'Broken', tags: '{not json', brands: 'null' }))
    expect(row.tags).toEqual([])
    expect(row.brandCount).toBe(0)
  })

  it('honours a custom track override over the plan default', () => {
    const row = toClientRow(api({
      id: 'a', name: 'Halter', planType: 'maintain', tracksMode: 'custom', customSmallTracks: 2, customLargeTracks: 1,
    }))
    expect(row.tracks).toMatchObject({ mode: 'custom', small: 2, large: 1, total: 3 })
  })

  it('reads a "none" plan as no plan at all', () => {
    const row = toClientRow(api({ id: 'a', name: 'Nobody', planType: 'none' }))
    expect(row.planType).toBeNull()
    expect(row.engagement).toBe('none')
  })

  it('carries the account owner when one is handed in, and null when not', () => {
    const held = toClientRow(api({ id: 'a', name: 'Held' }), 1500, { id: 'tm_1', name: 'Liam Miller' })
    expect(held.ownerId).toBe('tm_1')
    expect(held.ownerName).toBe('Liam Miller')
    const loose = toClientRow(api({ id: 'b', name: 'Loose' }))
    expect(loose.ownerId).toBeNull()
    expect(loose.ownerName).toBeNull()
  })
})

describe('archived rows', () => {
  const rows: ClientRow[] = [
    toClientRow(api({ id: 'live', name: 'Live' })),
    toClientRow(api({ id: 'gone', name: 'Gone', status: 'archived' })),
  ]

  it('hides archived clients from every view but Archived', () => {
    const all = applyClientViews(rows, base)
    expect(all.map(r => r.id)).toEqual(['live'])
  })

  it('shows only archived clients in the Archived view', () => {
    const archived = applyClientViews(rows, { ...base, savedView: ARCHIVED_VIEW_KEY })
    expect(archived.map(r => r.id)).toEqual(['gone'])
  })

  it('shows archived clients when the status filter asks for them', () => {
    const filters = { ...DEFAULT_CLIENT_FILTERS, status: 'archived' }
    expect(showsArchived(null, filters)).toBe(true)
    expect(applyClientViews(rows, { ...base, filters }).map(r => r.id)).toEqual(['gone'])
  })

  it('counts archived clients even while standing somewhere else', () => {
    const counts = countClientsSavedViews(rows)
    expect(counts.__all).toBe(1)
    expect(counts[ARCHIVED_VIEW_KEY]).toBe(1)
  })
})

describe('filters', () => {
  const row = toClientRow(api({ id: 'a', name: 'Ethique', tags: '["vip"]', planType: 'launch' }))

  it('matches on plan, tag and health', () => {
    expect(matchesClientFilters(row, { ...DEFAULT_CLIENT_FILTERS, plan: 'launch' })).toBe(true)
    expect(matchesClientFilters(row, { ...DEFAULT_CLIENT_FILTERS, plan: 'scale' })).toBe(false)
    expect(matchesClientFilters(row, { ...DEFAULT_CLIENT_FILTERS, tag: 'vip' })).toBe(true)
    expect(matchesClientFilters(row, { ...DEFAULT_CLIENT_FILTERS, tag: 'nope' })).toBe(false)
    expect(matchesClientFilters(row, { ...DEFAULT_CLIENT_FILTERS, health: 'green' })).toBe(true)
    expect(matchesClientFilters(row, { ...DEFAULT_CLIENT_FILTERS, health: 'red' })).toBe(false)
  })

  it('reads a null health as "not scored" rather than dropping the row', () => {
    const unscored = toClientRow(api({ id: 'b', name: 'New', healthStatus: null }))
    expect(matchesClientFilters(unscored, { ...DEFAULT_CLIENT_FILTERS, health: 'none' })).toBe(true)
  })

  it('separates "no plan" from any named plan', () => {
    const noPlan = toClientRow(api({ id: 'c', name: 'Bare', planType: null }))
    expect(matchesClientFilters(noPlan, { ...DEFAULT_CLIENT_FILTERS, plan: 'none' })).toBe(true)
    expect(matchesClientFilters(row, { ...DEFAULT_CLIENT_FILTERS, plan: 'none' })).toBe(false)
  })

  it('filters on the account owner, and can ask for the unheld ones', () => {
    const held = toClientRow(api({ id: 'h', name: 'Held' }), null, { id: 'tm_1', name: 'Liam Miller' })
    const loose = toClientRow(api({ id: 'l', name: 'Loose' }))
    expect(matchesClientFilters(held, { ...DEFAULT_CLIENT_FILTERS, owner: 'tm_1' })).toBe(true)
    expect(matchesClientFilters(held, { ...DEFAULT_CLIENT_FILTERS, owner: 'tm_2' })).toBe(false)
    expect(matchesClientFilters(loose, { ...DEFAULT_CLIENT_FILTERS, owner: 'tm_1' })).toBe(false)
    expect(matchesClientFilters(loose, { ...DEFAULT_CLIENT_FILTERS, owner: UNASSIGNED_OWNER })).toBe(true)
    expect(matchesClientFilters(held, { ...DEFAULT_CLIENT_FILTERS, owner: UNASSIGNED_OWNER })).toBe(false)
    // The default dimension keeps both.
    expect(matchesClientFilters(held, DEFAULT_CLIENT_FILTERS)).toBe(true)
    expect(matchesClientFilters(loose, DEFAULT_CLIENT_FILTERS)).toBe(true)
  })

  it('filters on the configured track shape', () => {
    const off = toClientRow(api({ id: 'd', name: 'Off', tracksMode: 'off' }))
    const withTracks = toClientRow(api({ id: 'e', name: 'On', planType: 'maintain' }))
    expect(matchesClientFilters(off, { ...DEFAULT_CLIENT_FILTERS, tracks: 'off' })).toBe(true)
    expect(matchesClientFilters(off, { ...DEFAULT_CLIENT_FILTERS, tracks: 'none' })).toBe(true)
    expect(matchesClientFilters(withTracks, { ...DEFAULT_CLIENT_FILTERS, tracks: 'some' })).toBe(true)
    expect(matchesClientFilters(withTracks, { ...DEFAULT_CLIENT_FILTERS, tracks: 'none' })).toBe(false)
  })
})

describe('sort', () => {
  const rows: ClientRow[] = [
    toClientRow(api({ id: 'b', name: 'Beta', healthStatus: 'green', openRequestCount: 1 }), 1000),
    toClientRow(api({ id: 'a', name: 'Alpha', healthStatus: 'red', openRequestCount: 9 }), null),
    toClientRow(api({ id: 'c', name: 'Gamma', healthStatus: 'amber', openRequestCount: 4 }), 4000),
  ]

  it('sorts by name ascending by default', () => {
    expect(sortClients(rows).map(r => r.name)).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('puts the most urgent health first', () => {
    expect(sortClients(rows, { key: 'health', dir: 'asc' }).map(r => r.name)).toEqual(['Alpha', 'Gamma', 'Beta'])
  })

  it('puts the most open work first', () => {
    expect(sortClients(rows, { key: 'open', dir: 'asc' }).map(r => r.name)).toEqual(['Alpha', 'Gamma', 'Beta'])
  })

  it('sinks an unknown MRR below every known one', () => {
    expect(sortClients(rows, { key: 'mrr', dir: 'asc' }).map(r => r.name)).toEqual(['Gamma', 'Beta', 'Alpha'])
  })

  it('never mutates the caller array', () => {
    const before = rows.map(r => r.id)
    sortClients(rows, { key: 'open', dir: 'desc' })
    expect(rows.map(r => r.id)).toEqual(before)
  })
})

describe('search and tags', () => {
  const rows = [
    toClientRow(api({ id: 'a', name: 'Kowtow', website: 'kowtow.co.nz', industry: 'Retail', tags: '["vip"]' })),
    toClientRow(api({ id: 'b', name: 'Halter', industry: 'Agritech', tags: '["retainer","vip"]' })),
  ]

  it('searches the name, the site, the industry and the tags', () => {
    expect(applyClientViews(rows, { ...base, query: 'kowtow.co' }).map(r => r.id)).toEqual(['a'])
    expect(applyClientViews(rows, { ...base, query: 'agritech' }).map(r => r.id)).toEqual(['b'])
    // Both carry the tag, and the default sort is by name: Halter, then Kowtow.
    expect(applyClientViews(rows, { ...base, query: 'vip' }).map(r => r.id)).toEqual(['b', 'a'])
  })

  it('offers every tag on the loaded rows exactly once', () => {
    expect(clientTagValues(rows)).toEqual(['retainer', 'vip'])
  })
})

describe('health reasons', () => {
  it('states only what the row carries', () => {
    const row = toClientRow(api({ id: 'a', name: 'Paused co', status: 'paused', healthNote: 'Waiting on brand assets.' }))
    const reasons = healthReasons(row)
    expect(reasons[0]).toBe('Waiting on brand assets.')
    expect(reasons).toContain('The engagement is paused.')
  })

  it('says nothing at all for a plain, healthy, busy retainer', () => {
    const row = toClientRow(api({ id: 'a', name: 'Fine', openRequestCount: 3 }))
    expect(healthReasons(row)).toEqual(['3 open requests.'])
  })
})

describe('the persisted snapshot', () => {
  const snap = {
    view: 'list' as const,
    savedView: null,
    filters: { ...DEFAULT_CLIENT_FILTERS },
    sort: DEFAULT_CLIENTS_SORT,
  }

  it('accepts its own shape and rejects junk', () => {
    expect(isClientsSnapshot(snap)).toBe(true)
    expect(isClientsSnapshot({ view: 'kanban', savedView: null, filters: {}, sort: {} })).toBe(false)
    expect(isClientsSnapshot(null)).toBe(false)
  })

  it('only equals a snapshot that matches on every dimension', () => {
    expect(clientsSnapshotsEqual(snap, { ...snap })).toBe(true)
    expect(clientsSnapshotsEqual(snap, { ...snap, view: 'cards' })).toBe(false)
    expect(clientsSnapshotsEqual(snap, { ...snap, savedView: 'projects' })).toBe(false)
    expect(clientsSnapshotsEqual(snap, { ...snap, sort: { key: 'health', dir: 'asc' } })).toBe(false)
    expect(clientsSnapshotsEqual(null, snap)).toBe(false)
  })
})

describe('statusFromUrl', () => {
  it('keeps a single known status so old links still land', () => {
    expect(statusFromUrl('archived')).toBe('archived')
    expect(statusFromUrl('active')).toBe('active')
  })

  it('falls back to all for a multi-value or unknown param', () => {
    expect(statusFromUrl('active,paused')).toBe('all')
    expect(statusFromUrl('prospect')).toBe('all')
    expect(statusFromUrl(null)).toBe('all')
  })
})

// From the live list: a client with no plan read "No plan, No plan, No plan"
// straight across the row, because the tracks cell and the money cell both
// fell back to the engagement word, which is the sentence the plan chip has
// already said. These three helpers are the rule that the plan is stated
// once and every other cell talks about its own subject.
describe('saying the plan once', () => {
  describe('tracksLine', () => {
    it('counts the configured tracks, singular and plural', () => {
      expect(tracksLine(toClientRow(api({ id: 'a', name: 'One', planType: 'maintain' })))).toBe('1 track')
      expect(tracksLine(toClientRow(api({ id: 'b', name: 'Two', planType: 'scale' })))).toBe('2 tracks')
    })

    it('says nothing at all when there is no plan, because the chip said it', () => {
      expect(tracksLine(toClientRow(api({ id: 'c', name: 'Bare', planType: null })))).toBeNull()
    })

    it('talks about tracks, not about the engagement, on a one-off plan', () => {
      expect(tracksLine(toClientRow(api({ id: 'd', name: 'Launch', planType: 'launch' })))).toBe('No tracks')
    })

    it('keeps saying Tracks off, which is a setting and not a plan', () => {
      expect(tracksLine(toClientRow(api({ id: 'e', name: 'Off', planType: 'scale', tracksMode: 'off' })))).toBe('Tracks off')
      expect(tracksLine(toClientRow(api({ id: 'f', name: 'Off too', planType: null, tracksMode: 'off' })))).toBe('Tracks off')
    })
  })

  describe('mrrFallbackLabel', () => {
    it('separates a retainer with no figure from a client with no retainer', () => {
      expect(mrrFallbackLabel('retainer')).toBe('Not set')
      expect(mrrFallbackLabel('none')).toBe('No retainer')
    })

    it('names the engagement when the money is not monthly', () => {
      expect(mrrFallbackLabel('project')).toBe('Project')
      expect(mrrFallbackLabel('hourly')).toBe('Hourly')
    })
  })

  describe('engagementStatLabel', () => {
    it('reads as Not set under its own label rather than repeating the chip', () => {
      expect(engagementStatLabel('none')).toBe('Not set')
      expect(engagementStatLabel('retainer')).toBe('Retainer')
    })
  })

  it('leaves a plan-less row with no second No plan anywhere on it', () => {
    const row = toClientRow(api({ id: 'g', name: 'Bare', planType: null }))
    const printed = [tracksLine(row), mrrFallbackLabel(row.engagement), engagementStatLabel(row.engagement)]
    expect(printed.filter(label => label === ENGAGEMENT_LABEL.none)).toEqual([])
  })
})
