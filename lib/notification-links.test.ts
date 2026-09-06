/**
 * Ship readiness Tier 1 item 13: notification deep links resolve per audience.
 *
 * The bell used to run both audiences through one route map, so a client's
 * invoice / contract / call notification threw them at an admin page that 403s
 * or redirects. These tests pin the two maps apart, and pin the invariant that
 * a client link is only ever a route their session can actually render.
 */
import { describe, it, expect } from 'vitest'
import {
  buildNotificationFacets,
  kindsCoverUnmappedEntities,
  MAPPED_NOTIFICATION_ENTITY_TYPES,
  notificationHref,
  type NotificationEntityType,
} from '@/lib/notification-links'

// Every route a client portal session can render (page has a client branch and
// middleware does not bounce them). Kept explicit so widening it is a decision.
const CLIENT_RENDERABLE = new Set([
  '/overview', '/requests', '/files', '/services', '/invoices', '/billing', '/settings',
])

const ALL_ENTITIES: NotificationEntityType[] = [
  'request', 'task', 'message', 'invoice', 'organisation', 'contract', 'proposal',
  'call', 'deal', 'lead', 'schedule', 'announcement', 'subscription', 'affiliate',
  'finance_anomaly', 'system', 'content_week', 'cron',
]

describe('notificationHref - team audience (unchanged behaviour)', () => {
  it('deep-links entities with a detail page', () => {
    expect(notificationHref('request', 'r1', 'team')).toBe('/requests/r1')
    expect(notificationHref('invoice', 'i1', 'team')).toBe('/invoices/i1')
    expect(notificationHref('organisation', 'o1', 'team')).toBe('/clients/o1')
    expect(notificationHref('contract', 'c1', 'team')).toBe('/contracts/c1')
    expect(notificationHref('proposal', 'p1', 'team')).toBe('/proposals/p1')
    expect(notificationHref('deal', 'd1', 'team')).toBe('/deals/d1')
    expect(notificationHref('lead', 'l1', 'team')).toBe('/leads/l1')
    expect(notificationHref('schedule', 's1', 'team')).toBe('/schedules/s1')
    expect(notificationHref('task', 't1', 'team')).toBe('/tasks/t1')
  })

  it('falls back to the list when the entity id is missing', () => {
    expect(notificationHref('request', null, 'team')).toBe('/requests')
    expect(notificationHref('invoice', undefined, 'team')).toBe('/invoices')
  })

  it('lands list-only and operator surfaces on their page', () => {
    expect(notificationHref('call', 'x', 'team')).toBe('/calls')
    expect(notificationHref('announcement', null, 'team')).toBe('/announcements')
    expect(notificationHref('subscription', null, 'team')).toBe('/billing')
    expect(notificationHref('affiliate', 'affiliate:abc', 'team')).toBe('/leads')
    expect(notificationHref('finance_anomaly', null, 'team')).toBe('/financial-reports')
    expect(notificationHref('content_week', 'week:1', 'team')).toBe('/content-studio?tab=ideas')
    expect(notificationHref('cron', 'cron:daily', 'team')).toBe('/settings/crons')
  })

  it('defaults to the team map when no audience is given', () => {
    expect(notificationHref('invoice', 'i1')).toBe('/invoices/i1')
    expect(notificationHref('organisation', 'o1')).toBe('/clients/o1')
  })
})

describe('notificationHref - client audience', () => {
  it('deep-links a request, the one surface both audiences share', () => {
    expect(notificationHref('request', 'r1', 'client')).toBe('/requests/r1')
    expect(notificationHref('request', null, 'client')).toBe('/requests')
  })

  it('sends money notifications to portal surfaces, never the admin ones', () => {
    // The invoice DETAIL page still fetches /api/admin/invoices, so the client
    // lands on their own list rather than a page that 403s them.
    expect(notificationHref('invoice', 'i1', 'client')).toBe('/invoices')
    expect(notificationHref('subscription', null, 'client')).toBe('/billing')
  })

  it('maps org, message and announcement onto surfaces a client can open', () => {
    expect(notificationHref('organisation', 'o1', 'client')).toBe('/settings')
    expect(notificationHref('message', 'm1', 'client')).toBe('/requests')
    expect(notificationHref('announcement', 'a1', 'client')).toBe('/overview')
  })

  it('returns null for every team-only entity instead of a bouncing link', () => {
    for (const entity of ['task', 'contract', 'proposal', 'deal', 'lead', 'schedule', 'call', 'affiliate', 'finance_anomaly', 'content_week', 'cron', 'system'] as NotificationEntityType[]) {
      expect(notificationHref(entity, 'x', 'client')).toBeNull()
    }
  })

  it('never resolves to a route a client session cannot render', () => {
    for (const entity of ALL_ENTITIES) {
      for (const id of ['x', null]) {
        const href = notificationHref(entity, id, 'client')
        if (href === null) continue
        const base = href.split('?')[0]
        // Either an exact renderable route, or a detail page under one.
        const root = '/' + base.split('/').filter(Boolean)[0]
        expect(CLIENT_RENDERABLE.has(base) || CLIENT_RENDERABLE.has(root)).toBe(true)
      }
    }
  })
})

describe('notificationHref - the hidden Messages surface', () => {
  // /messages redirects (app/(dashboard)/messages/page.tsx bounces an admin to
  // /overview and a client to /requests), so any row resolving there is a
  // notification that vanishes on click. A message notification carries the
  // CONVERSATION id, never the request id, so the resolver cannot deep-link it;
  // request-thread replies already notify with entityType 'request' and get a
  // real deep link from the case above. /requests is the honest floor: it is
  // where every client thread lives, for both audiences.
  it('sends a team message notification to the requests list, not /messages', () => {
    expect(notificationHref('message', 'conv-1', 'team')).toBe('/requests')
    expect(notificationHref('message', null, 'team')).toBe('/requests')
  })

  it('keeps the client message map on the requests list', () => {
    expect(notificationHref('message', 'conv-1', 'client')).toBe('/requests')
  })

  it('never resolves any entity, on either audience, to /messages', () => {
    for (const audience of ['team', 'client'] as const) {
      for (const entity of ALL_ENTITIES) {
        for (const id of ['x', null]) {
          const href = notificationHref(entity, id, audience)
          if (href === null) continue
          expect(href.split('?')[0].split('/')[1]).not.toBe('messages')
        }
      }
    }
  })
})

describe('notificationHref - shared guards', () => {
  it('returns null for a missing entity type on both maps', () => {
    expect(notificationHref(null, 'x', 'team')).toBeNull()
    expect(notificationHref(undefined, 'x', 'client')).toBeNull()
  })
})

/**
 * The /notifications rail puts a number beside all three views and every kind,
 * and greys out a kind with nothing behind it. SQL can group by entity type
 * and read; the rail speaks kinds and views. This is the fold between them,
 * and it has to be exact: an off-by-one here is a filter the reader either
 * cannot press or presses for nothing.
 */
describe('buildNotificationFacets', () => {
  it('folds entity types into kinds and totals the views', () => {
    const facets = buildNotificationFacets(
      [
        { entityType: 'request', read: false, n: 3 },
        { entityType: 'request', read: true, n: 5 },
        { entityType: 'proposal', read: true, n: 1 },
        { entityType: 'schedule', read: false, n: 2 },
      ],
      [{ entityType: 'invoice', read: true, n: 4 }],
    )
    expect(facets.views).toEqual({ all: 11, unread: 5, past: 4 })
    expect(facets.kinds.all.request).toBe(8)
    // proposal and schedule are both Documents.
    expect(facets.kinds.all.document).toBe(3)
    expect(facets.kinds.unread.document).toBe(2)
    expect(facets.kinds.past.invoice).toBe(4)
  })

  it('gives every kind a zero rather than leaving it out', () => {
    const facets = buildNotificationFacets([], [])
    expect(facets.kinds.all.request).toBe(0)
    expect(facets.kinds.unread.system).toBe(0)
    expect(facets.kinds.past.deal).toBe(0)
    expect(facets.views).toEqual({ all: 0, unread: 0, past: 0 })
  })

  it('counts an unrecognised or missing entity type as System', () => {
    const facets = buildNotificationFacets(
      [
        { entityType: null, read: false, n: 2 },
        { entityType: 'not-a-thing', read: false, n: 1 },
      ],
      [],
    )
    expect(facets.kinds.all.system).toBe(3)
    expect(facets.views.unread).toBe(3)
  })

  // `read` is nullable, and `?unread=true` filters on `read = 0`, which does
  // not match NULL. Counting a NULL row as unread would put a number on the
  // Unread view that the Unread view could never show.
  it('does not count a NULL read flag as unread', () => {
    const facets = buildNotificationFacets(
      [
        { entityType: 'request', read: null, n: 7 },
        { entityType: 'request', read: 0, n: 2 },
        { entityType: 'request', read: 1, n: 1 },
      ],
      [],
    )
    expect(facets.views.all).toBe(10)
    expect(facets.views.unread).toBe(2)
    expect(facets.kinds.unread.request).toBe(2)
  })

  it('ignores an empty or nonsensical tally', () => {
    const facets = buildNotificationFacets(
      [
        { entityType: 'request', read: false, n: 0 },
        { entityType: 'invoice', read: false, n: -3 },
      ],
      [],
    )
    expect(facets.views).toEqual({ all: 0, unread: 0, past: 0 })
  })
})

/**
 * The count and the filter have to be able to return the same rows.
 *
 * notificationKind() folds a NULL or unrecognised entity type into System, so
 * the System facet counts those rows. The API's `?kind=system` has to reach
 * them too, or the rail draws a number that answers "Nothing matches those
 * kinds" when it is pressed. These pin the two halves the route builds that
 * predicate from: the flat list of everything the map does know, and the one
 * kind that has to reach past it.
 */
describe('kind filter and kind counts agree', () => {
  it('lists every mapped entity type once', () => {
    const mapped = [...MAPPED_NOTIFICATION_ENTITY_TYPES]
    expect(new Set(mapped).size).toBe(mapped.length)
    for (const entity of ALL_ENTITIES) expect(mapped).toContain(entity)
  })

  it('only System reaches entity types the map does not list', () => {
    expect(kindsCoverUnmappedEntities(['system'])).toBe(true)
    expect(kindsCoverUnmappedEntities(['invoice', 'system'])).toBe(true)
    expect(kindsCoverUnmappedEntities(['invoice', 'request'])).toBe(false)
    expect(kindsCoverUnmappedEntities([])).toBe(false)
  })

  it('folds anything outside the map into the kind that reaches it', () => {
    const facets = buildNotificationFacets(
      [
        { entityType: null, read: false, n: 2 },
        { entityType: 'not-a-thing', read: false, n: 1 },
      ],
      [],
    )
    expect(facets.kinds.all.system).toBe(3)
    expect([...MAPPED_NOTIFICATION_ENTITY_TYPES]).not.toContain('not-a-thing')
    expect(kindsCoverUnmappedEntities(['system'])).toBe(true)
  })
})
