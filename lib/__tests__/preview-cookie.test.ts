/**
 * One definition of previewing, and what it refuses.
 *
 * The middleware used to read `tahi-impersonate-org` raw and treat any
 * non-empty value as Client view, while lib/view-audience.ts ignored the same
 * cookie for anyone outside the Tahi org. Two rules for one question: the
 * middleware's took the /clients tree away from an admin holding a stale or
 * malformed cookie, and the way back was a button that renders inside the
 * shell those redirects were bouncing.
 */
import { describe, it, expect } from 'vitest'
import {
  ACT_MODE_VALUE,
  EXIT_PREVIEW_PARAM,
  IMPERSONATE_MODE_COOKIE,
  IMPERSONATE_ORG_COOKIE,
  readPreviewMode,
  readPreviewOrgId,
  resolvePreviewOrgId,
} from '@/lib/preview-cookie'

const UUID = '4f0d2c1a-8e77-4b31-9d2a-7c5b1e6a0f33'

describe('readPreviewOrgId', () => {
  it('accepts the two ids an org can actually have', () => {
    // organisations.id (a UUID) and, for a pre-link legacy row, the Clerk org
    // id used as the primary key.
    expect(readPreviewOrgId(UUID)).toBe(UUID)
    expect(readPreviewOrgId('org_3BUxNgQp84abc')).toBe('org_3BUxNgQp84abc')
  })

  it('decodes a percent-encoded value and trims it', () => {
    expect(readPreviewOrgId(encodeURIComponent(UUID))).toBe(UUID)
    expect(readPreviewOrgId(`  ${UUID}  `)).toBe(UUID)
  })

  it('refuses anything that could not name an org', () => {
    for (const junk of [
      '', '   ', null, undefined,
      'short',                      // too short to be an id
      'a'.repeat(65),               // too long
      'org acme/1',                 // spaces and a path separator
      '{"orgId":"x"}',              // a whole JSON blob, half-written
      '../../etc/passwd',
      'org_abc; Path=/',            // a cookie attribute leaking into the value
    ]) {
      expect(readPreviewOrgId(junk)).toBeNull()
    }
  })

  it('judges a malformed encoding instead of throwing', () => {
    // decodeURIComponent('%E0%A4%A') throws. The caller is the middleware on
    // every request, so it must come back with an answer either way.
    expect(() => readPreviewOrgId('%E0%A4%A')).not.toThrow()
    expect(readPreviewOrgId('%E0%A4%A')).toBeNull()
  })
})

describe('resolvePreviewOrgId', () => {
  it('lets only a Tahi session preview', () => {
    expect(resolvePreviewOrgId(true, UUID)).toBe(UUID)
    expect(resolvePreviewOrgId(false, UUID)).toBeNull()
  })

  it('is null for an admin holding no cookie', () => {
    expect(resolvePreviewOrgId(true, undefined)).toBeNull()
  })
})

describe('the shared constants', () => {
  it('names the cookie the banner writes', () => {
    expect(IMPERSONATE_ORG_COOKIE).toBe('tahi-impersonate-org')
  })

  it('names the escape hatch the middleware honours', () => {
    expect(EXIT_PREVIEW_PARAM).toBe('exit-preview')
  })
})

/**
 * Act as client rides a SECOND cookie. It decides whether a super admin's
 * Client view can write into somebody else's workspace, so the parsing has to
 * be boring: one literal counts and everything else is the read-only side.
 */
describe('readPreviewMode', () => {
  it('accepts only the exact literal', () => {
    expect(readPreviewMode('act')).toBe('act')
    expect(readPreviewMode(encodeURIComponent('act'))).toBe('act')
    expect(readPreviewMode('  act  ')).toBe('act')
  })

  it('reads everything else as the read-only lens', () => {
    for (const junk of [
      '', '   ', null, undefined,
      'ACT',            // case matters: the cookie is written by us, not typed
      'act ive',
      'acting',
      'true', '1', 'yes',
      'view',
      '{"mode":"act"}',
      'act; Path=/',    // a cookie attribute leaking into the value
      'a'.repeat(500),
    ]) {
      expect(readPreviewMode(junk)).toBe('view')
    }
  })

  it('judges a malformed encoding instead of throwing', () => {
    expect(() => readPreviewMode('%E0%A4%A')).not.toThrow()
    expect(readPreviewMode('%E0%A4%A')).toBe('view')
  })

  it('is independent of the org cookie, which keeps its own rule', () => {
    // Two cookies on purpose: clearing one must not be able to leave the other
    // meaning something. The mode says nothing about WHO is previewed, and the
    // org cookie says nothing about whether writes are real.
    expect(readPreviewMode(UUID)).toBe('view')
    expect(readPreviewOrgId(ACT_MODE_VALUE)).toBeNull()
  })
})

describe('the mode constants', () => {
  it('names the second cookie', () => {
    expect(IMPERSONATE_MODE_COOKIE).toBe('tahi-impersonate-mode')
    // Distinct names, or clearing the preview would clear the mode by accident
    // and the two rules could never be reasoned about apart.
    expect(IMPERSONATE_MODE_COOKIE).not.toBe(IMPERSONATE_ORG_COOKIE)
  })

  it('names the one value that means writes are real', () => {
    expect(ACT_MODE_VALUE).toBe('act')
  })
})
