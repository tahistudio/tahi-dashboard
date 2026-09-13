import { describe, it, expect } from 'vitest'
import { isClerkNotFoundError } from '@/lib/clerk-errors'

describe('isClerkNotFoundError', () => {
  it('is true for a plain 404 status', () => {
    expect(isClerkNotFoundError({ status: 404 })).toBe(true)
  })

  it('is true for a resource_not_found error body code, regardless of status', () => {
    expect(isClerkNotFoundError({ status: 422, errors: [{ code: 'resource_not_found' }] })).toBe(true)
  })

  it('is true for organization_not_found', () => {
    expect(isClerkNotFoundError({ errors: [{ code: 'organization_not_found' }] })).toBe(true)
  })

  it('is true for organization_membership_not_found, the shape deleteOrganizationMembership throws for a non-member', () => {
    expect(
      isClerkNotFoundError({ status: 404, errors: [{ code: 'organization_membership_not_found' }] }),
    ).toBe(true)
  })

  it('is false for a genuine failure: wrong status, unrelated error code', () => {
    expect(isClerkNotFoundError({ status: 500 })).toBe(false)
    expect(isClerkNotFoundError({ status: 422, errors: [{ code: 'form_param_missing' }] })).toBe(false)
  })

  it('is false for a 403 (a real member Clerk simply refuses to remove)', () => {
    expect(isClerkNotFoundError({ status: 403, errors: [{ code: 'not_authorized' }] })).toBe(false)
  })

  it('is false for non-object, null, and undefined input', () => {
    expect(isClerkNotFoundError(null)).toBe(false)
    expect(isClerkNotFoundError(undefined)).toBe(false)
    expect(isClerkNotFoundError('boom')).toBe(false)
    expect(isClerkNotFoundError(new Error('plain error, no status'))).toBe(false)
  })

  it('is false when errors is present but not an array, and when entries have no code', () => {
    expect(isClerkNotFoundError({ errors: 'nope' })).toBe(false)
    expect(isClerkNotFoundError({ errors: [{}] })).toBe(false)
  })
})
