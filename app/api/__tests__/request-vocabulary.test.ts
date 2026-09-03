/**
 * lib/request-vocabulary: the writable request vocabularies.
 *
 * These lists are the server-side whitelists on the create routes, the single
 * PATCH and the bulk PATCH, so this file is the authority for what a request
 * may be born as, moved to, sized as and categorised as. The UI mirrors them
 * (the kanban decides which columns offer a quick-add off CREATABLE_STATUSES,
 * the dialog renders one tile per category); a change here is a change there.
 *
 * Also covers the daily brief's cache key, which has to separate one scope's
 * brief from another's.
 */
import { describe, it, expect } from 'vitest'
import {
  CREATABLE_STATUSES,
  PATCHABLE_STATUSES,
  REQUEST_CATEGORIES,
  REQUEST_PRIORITIES,
  REQUEST_TYPES,
  isCreatableStatus,
  isPatchableStatus,
  isRequestCategory,
  isRequestPriority,
  isRequestType,
} from '@/lib/request-vocabulary'
import { REQUEST_STATUSES } from '@/lib/status-config'
import {
  BRIEF_FEATURES,
  briefCacheKeyForFingerprint,
  briefScopeFingerprint,
  hashScope,
  unrestrictedFingerprint,
} from '@/lib/brief-cache-key'

describe('creatable statuses', () => {
  it('is the request vocabulary minus the two ends of a request life', () => {
    expect(CREATABLE_STATUSES).toEqual([
      'submitted', 'in_review', 'in_progress', 'client_review', 'on_hold', 'archived',
    ])
  })

  it('rejects delivered and cancelled, which have to be moved to', () => {
    expect(isCreatableStatus('delivered')).toBe(false)
    expect(isCreatableStatus('cancelled')).toBe(false)
  })

  it('rejects anything outside the vocabulary, including a label', () => {
    expect(isCreatableStatus('todo')).toBe(false)
    expect(isCreatableStatus('In Progress')).toBe(false)
    expect(isCreatableStatus(undefined)).toBe(false)
    expect(isCreatableStatus(null)).toBe(false)
    expect(isCreatableStatus(7)).toBe(false)
  })

  it('tracks REQUEST_STATUSES so a new status cannot be missed', () => {
    for (const status of REQUEST_STATUSES) {
      if (status.value === 'delivered' || status.value === 'cancelled') continue
      expect(isCreatableStatus(status.value)).toBe(true)
    }
  })
})

describe('patchable statuses', () => {
  it('is the whole vocabulary plus draft', () => {
    expect([...PATCHABLE_STATUSES].sort()).toEqual(
      [...REQUEST_STATUSES.map((s) => s.value), 'draft'].sort(),
    )
  })

  it('accepts the two the bulk bar sends that a create may not', () => {
    expect(isPatchableStatus('delivered')).toBe(true)
    expect(isPatchableStatus('archived')).toBe(true)
    expect(isPatchableStatus('on_hold')).toBe(true)
  })

  it('rejects a display label or an unknown slug', () => {
    expect(isPatchableStatus('Delivered')).toBe(false)
    expect(isPatchableStatus('done')).toBe(false)
    expect(isPatchableStatus('')).toBe(false)
  })
})

describe('priorities, types and categories', () => {
  it('holds priority to the two the dialog offers', () => {
    expect(REQUEST_PRIORITIES).toEqual(['standard', 'high'])
    expect(isRequestPriority('urgent')).toBe(false)
    expect(isRequestPriority('high')).toBe(true)
  })

  it('holds a created type to the two sizes', () => {
    expect(REQUEST_TYPES).toEqual(['small_task', 'large_task'])
    expect(isRequestType('large_task')).toBe(true)
    // Legacy values still live on old rows but nothing may create one.
    expect(isRequestType('bug_fix')).toBe(false)
    expect(isRequestType('new_feature')).toBe(false)
  })

  it('holds category to the six tiles the dialog renders', () => {
    expect(REQUEST_CATEGORIES).toEqual([
      'design', 'development', 'content', 'strategy', 'admin', 'bug',
    ])
    expect(isRequestCategory('bug')).toBe(true)
    expect(isRequestCategory('Design')).toBe(false)
    expect(isRequestCategory('anything-else')).toBe(false)
  })
})

describe('daily brief cache key', () => {
  it('gives the unrestricted owner scope the plain key', () => {
    const key = briefCacheKeyForFingerprint(
      'overview_brief_latest',
      briefScopeFingerprint(null, BRIEF_FEATURES),
    )
    expect(key).toBe('overview_brief_latest')
  })

  it('gives a scoped team member a different key from the owner', () => {
    const owner = briefCacheKeyForFingerprint('brief', unrestrictedFingerprint())
    const scoped = briefCacheKeyForFingerprint('brief', briefScopeFingerprint(['org-a'], BRIEF_FEATURES))
    expect(scoped).not.toBe(owner)
    expect(scoped.startsWith('brief:')).toBe(true)
  })

  it('separates two members scoped to different clients', () => {
    const a = briefCacheKeyForFingerprint('brief', briefScopeFingerprint(['org-a'], BRIEF_FEATURES))
    const b = briefCacheKeyForFingerprint('brief', briefScopeFingerprint(['org-b'], BRIEF_FEATURES))
    expect(a).not.toBe(b)
  })

  it('separates the same orgs with different feature grants', () => {
    const all = briefScopeFingerprint(['org-a'], BRIEF_FEATURES)
    const noInvoices = briefScopeFingerprint(['org-a'], BRIEF_FEATURES.filter((f) => f !== 'invoices'))
    expect(briefCacheKeyForFingerprint('brief', all)).not.toBe(briefCacheKeyForFingerprint('brief', noInvoices))
  })

  it('does not care about the order the orgs or features arrive in', () => {
    expect(briefScopeFingerprint(['org-b', 'org-a'], ['requests', 'invoices']))
      .toBe(briefScopeFingerprint(['org-a', 'org-b'], ['invoices', 'requests']))
  })

  it('never treats a caller who sees nothing as the owner', () => {
    expect(briefCacheKeyForFingerprint('brief', briefScopeFingerprint([], BRIEF_FEATURES)))
      .not.toBe('brief')
  })

  it('hashes deterministically to a short hex string', () => {
    expect(hashScope('org-a|requests')).toBe(hashScope('org-a|requests'))
    expect(hashScope('org-a|requests')).toMatch(/^[0-9a-f]{8}$/)
    expect(hashScope('org-a|requests')).not.toBe(hashScope('org-b|requests'))
  })
})
