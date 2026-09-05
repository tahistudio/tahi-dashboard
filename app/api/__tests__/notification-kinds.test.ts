/**
 * lib/notification-links.ts : kinds and honest destinations.
 *
 * The /notifications page and the API both read this module, so a drift here
 * shows up as "the Invoices chip returns nothing" or, worse, as a link that
 * bounces a client off a page they cannot open.
 */
import { describe, it, expect } from 'vitest'
import {
  NOTIFICATION_KINDS,
  ENTITY_TYPES_FOR_KIND,
  notificationKind,
  notificationKindsFor,
  entityTypesForKinds,
  notificationDestination,
  isNotificationKind,
  type NotificationKind,
  type NotificationEntityType,
} from '@/lib/notification-links'

const ALL_ENTITIES: NotificationEntityType[] = [
  'request', 'task', 'message', 'invoice', 'organisation', 'contract', 'proposal',
  'call', 'deal', 'lead', 'schedule', 'announcement', 'subscription', 'affiliate',
  'finance_anomaly', 'system', 'content_week', 'cron',
]

describe('notification kinds', () => {
  it('folds every entity type into exactly one kind', () => {
    const seen = new Map<string, NotificationKind>()
    for (const kind of Object.keys(ENTITY_TYPES_FOR_KIND) as NotificationKind[]) {
      for (const entity of ENTITY_TYPES_FOR_KIND[kind]) {
        expect(seen.has(entity)).toBe(false)
        seen.set(entity, kind)
      }
    }
    for (const entity of ALL_ENTITIES) {
      expect(seen.has(entity)).toBe(true)
    }
  })

  it('lands an unknown or missing entity in System rather than dropping the row', () => {
    expect(notificationKind(null)).toBe('system')
    expect(notificationKind('something_new')).toBe('system')
    expect(notificationKind('request')).toBe('request')
  })

  it('gives a client the plain five and never the internal ones', () => {
    const labels = notificationKindsFor('client').map(k => k.label)
    expect(labels).toEqual(['Requests', 'Replies', 'Invoices', 'Studio notes', 'Documents'])
    expect(labels).not.toContain('System')
    expect(labels).not.toContain('Sales')
  })

  it('gives the studio its seven', () => {
    const keys = notificationKindsFor('team').map(k => k.key)
    expect(keys).toEqual(['request', 'task', 'message', 'invoice', 'call', 'deal', 'system'])
  })

  it('every kind carries a label, an icon and a tone', () => {
    for (const key of Object.keys(NOTIFICATION_KINDS) as NotificationKind[]) {
      const def = NOTIFICATION_KINDS[key]
      expect(def.key).toBe(key)
      expect(def.label.length).toBeGreaterThan(0)
      expect(def.icon.length).toBeGreaterThan(0)
      expect(def.tone.length).toBeGreaterThan(0)
    }
  })

  it('expands a kind list to entity types and drops what it does not know', () => {
    expect(entityTypesForKinds(['document'])).toEqual(['contract', 'proposal', 'schedule'])
    expect(entityTypesForKinds(['request', 'request'])).toEqual(['request'])
    expect(entityTypesForKinds(['made_up'])).toEqual([])
    expect(isNotificationKind('invoice')).toBe(true)
    expect(isNotificationKind('made_up')).toBe(false)
  })
})

describe('honest destinations', () => {
  it('gives a client nothing to open for entities their portal has no page for', () => {
    for (const entity of ['task', 'contract', 'proposal', 'deal', 'lead', 'schedule', 'call'] as const) {
      expect(notificationDestination(entity, 'x1', 'client')).toBeNull()
    }
  })

  it('gives the studio a deep link for the same entities', () => {
    expect(notificationDestination('task', 't1', 'team')).toEqual({ href: '/tasks/t1', label: 'the task' })
    expect(notificationDestination('contract', 'c1', 'team')?.href).toBe('/contracts/c1')
  })

  it('names the list when there is no entity id', () => {
    expect(notificationDestination('request', null, 'team')).toEqual({ href: '/requests', label: 'Requests' })
  })

  it('speaks the portal\'s words to a client', () => {
    expect(notificationDestination('invoice', 'i1', 'client')).toEqual({ href: '/invoices', label: 'Invoices' })
    expect(notificationDestination('organisation', 'o1', 'client')).toEqual({ href: '/settings', label: 'your account' })
    expect(notificationDestination('announcement', 'a1', 'client')).toEqual({ href: '/overview', label: 'Overview' })
  })

  it('returns null when the entity is missing entirely', () => {
    expect(notificationDestination(null, 'x', 'client')).toBeNull()
    expect(notificationDestination(undefined, undefined, 'team')).toBeNull()
  })

  it('never returns a label without a route, or a route without a label', () => {
    for (const audience of ['client', 'team'] as const) {
      for (const entity of ALL_ENTITIES) {
        const dest = notificationDestination(entity, 'id1', audience)
        if (dest) {
          expect(dest.href.startsWith('/')).toBe(true)
          expect(dest.label.length).toBeGreaterThan(0)
        }
      }
    }
  })
})
