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
  notificationHref,
  type NotificationEntityType,
} from '@/lib/notification-links'

// Every route a client portal session can render (page has a client branch and
// middleware does not bounce them). Kept explicit so widening it is a decision.
const CLIENT_RENDERABLE = new Set([
  '/overview', '/requests', '/files', '/services', '/invoices', '/billing', '/settings',
  // The inbox: one route, a client branch, no redirect (see
  // app/(dashboard)/messages/page.tsx).
  '/messages',
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
    expect(notificationHref('message', 'm1', 'client')).toBe('/messages')
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

describe('notificationHref - the Messages surface', () => {
  // /messages is a real page again for both audiences (the studio inbox and
  // the client's line to the studio), so a comms row lands there instead of on
  // the request list. It stays a LIST link on purpose: a message notification
  // carries the CONVERSATION id, and the inbox addresses a thread by a
  // (source, id) pair, so there is nothing to deep-link to. Replies on a
  // request thread still notify with entityType 'request' and get a real deep
  // link from the request case.
  it('sends a team message notification to the inbox', () => {
    expect(notificationHref('message', 'conv-1', 'team')).toBe('/messages')
    expect(notificationHref('message', null, 'team')).toBe('/messages')
  })

  it('sends a client message notification to their own studio line', () => {
    expect(notificationHref('message', 'conv-1', 'client')).toBe('/messages')
  })

  it('routes ONLY message rows there, so no other entity borrows the page', () => {
    for (const audience of ['team', 'client'] as const) {
      for (const entity of ALL_ENTITIES) {
        if (entity === 'message') continue
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
