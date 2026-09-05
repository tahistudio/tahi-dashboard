/**
 * The notification taxonomy and the deep links it resolves to.
 *
 * Both audiences read this map, and they do not share it: most admin surfaces
 * refuse a client session, so a single map meant a client's bell threw them at
 * a page they cannot open. The cases pinned here are the ones a wrong answer
 * turns into a 404 or a bounce.
 */
import { describe, it, expect } from 'vitest'
import { notificationHref } from '@/lib/notification-links'
import { PREF_EVENT_TYPES } from '@/lib/notification-preferences'

describe('notificationHref, the request cases', () => {
  it('deep-links a request for both audiences', () => {
    expect(notificationHref('request', 'req_1', 'team')).toBe('/requests/req_1')
    expect(notificationHref('request', 'req_1', 'client')).toBe('/requests/req_1')
  })

  it('lands on the list when there is no id to open', () => {
    expect(notificationHref('request', null, 'team')).toBe('/requests')
    expect(notificationHref('request', null, 'client')).toBe('/requests')
  })

  it('keeps a client out of the surfaces that would refuse them', () => {
    expect(notificationHref('task', 'task_1', 'client')).toBeNull()
    expect(notificationHref('schedule', 'sch_1', 'client')).toBeNull()
    expect(notificationHref('contract', 'con_1', 'client')).toBeNull()
    // The same entities are real pages for the studio.
    expect(notificationHref('task', 'task_1', 'team')).toBe('/tasks/task_1')
  })

  it('never points either audience at the hidden Messages page', () => {
    expect(notificationHref('message', 'conv_1', 'team')).toBe('/requests')
    expect(notificationHref('message', 'conv_1', 'client')).toBe('/requests')
  })
})

describe('request_assigned', () => {
  /**
   * The three request assignment routes borrowed 'task_assigned' before this,
   * which filed a request hand-over under the task toggle. It is its own event
   * now, and it has to be mutable from the settings endpoints or the toggle it
   * was borrowed from is the only way to silence it.
   */
  it('is a preference the settings endpoints accept', () => {
    expect(PREF_EVENT_TYPES).toContain('request_assigned')
  })

  it('needs no href case of its own: it carries entityType request', () => {
    // The routes emit { type: 'request_assigned', entityType: 'request' }, so a
    // click resolves through the request case above.
    expect(notificationHref('request', 'req_9', 'team')).toBe('/requests/req_9')
  })
})
