/**
 * The one studio-wide "who is everyone's project manager" rule.
 *
 * "make Liam Miller as the project manager for everyone no matter what. in
 * the future we'll add more. right now not." studio.projectManagerId, when
 * set, must win outright over any per-client assignment; when unset, today's
 * behaviour (per-client, then the caller's own fallback) must be unchanged.
 * An id that no longer resolves to a real member falls through rather than
 * leaving a client with no lead.
 */
import { describe, it, expect } from 'vitest'
import {
  resolveProjectManager,
  validateStudioProjectManagerSetting,
  STUDIO_PROJECT_MANAGER_SETTING_KEY,
  type ProjectManagerDeps,
} from '@/lib/studio-project-manager'

interface Candidate {
  id: string
  name: string
}

const OVERRIDE: Candidate = { id: 'tm_liam', name: 'Liam Miller' }
const PER_CLIENT_PM: Candidate = { id: 'tm_staci', name: 'Staci Bonnie' }
const FALLBACK: Candidate = { id: 'tm_owner', name: 'The Default Owner' }

function deps(over: Partial<ProjectManagerDeps<Candidate>> = {}): ProjectManagerDeps<Candidate> {
  return {
    findStudioOverride: () => Promise.resolve(null),
    findPerClientPm: () => Promise.resolve(null),
    findFallback: () => Promise.resolve(null),
    ...over,
  }
}

describe('resolveProjectManager', () => {
  it('set: everyone gets the studio override, even when the org has its own PM', async () => {
    const result = await resolveProjectManager(deps({
      findStudioOverride: () => Promise.resolve(OVERRIDE),
      findPerClientPm: () => Promise.resolve(PER_CLIENT_PM),
      findFallback: () => Promise.resolve(FALLBACK),
    }), 'org_acme')

    expect(result).toEqual(OVERRIDE)
  })

  it('unset: falls back to the org\'s own per-client PM', async () => {
    const result = await resolveProjectManager(deps({
      findPerClientPm: () => Promise.resolve(PER_CLIENT_PM),
      findFallback: () => Promise.resolve(FALLBACK),
    }), 'org_acme')

    expect(result).toEqual(PER_CLIENT_PM)
  })

  it('unset and no per-client PM: falls back to the caller\'s own default owner', async () => {
    const result = await resolveProjectManager(deps({
      findFallback: () => Promise.resolve(FALLBACK),
    }), 'org_acme')

    expect(result).toEqual(FALLBACK)
  })

  it('unknown override id (resolves to nobody): falls through to the per-client PM', async () => {
    // The override dependency itself is responsible for turning an unknown
    // id into null; the resolver just has to honour that null the same as an
    // unset setting.
    const result = await resolveProjectManager(deps({
      findStudioOverride: () => Promise.resolve(null),
      findPerClientPm: () => Promise.resolve(PER_CLIENT_PM),
    }), 'org_acme')

    expect(result).toEqual(PER_CLIENT_PM)
  })

  it('nobody resolves anywhere: answers null rather than inventing a person', async () => {
    const result = await resolveProjectManager(deps(), 'org_acme')
    expect(result).toBeNull()
  })

  it('skips the per-client lookup entirely for a client with no workspace yet', async () => {
    let calls = 0
    const result = await resolveProjectManager(deps({
      findPerClientPm: () => { calls++; return Promise.resolve(PER_CLIENT_PM) },
      findFallback: () => Promise.resolve(FALLBACK),
    }), null)

    expect(calls).toBe(0)
    expect(result).toEqual(FALLBACK)
  })

  it('degrades one step at a time when a dependency throws, never breaking the caller', async () => {
    const result = await resolveProjectManager(deps({
      findStudioOverride: () => Promise.reject(new Error('settings unreadable')),
      findPerClientPm: () => Promise.reject(new Error('d1 down')),
      findFallback: () => Promise.resolve(FALLBACK),
    }), 'org_acme')

    expect(result).toEqual(FALLBACK)

    const allThrow = await resolveProjectManager(deps({
      findStudioOverride: () => Promise.reject(new Error('x')),
      findPerClientPm: () => Promise.reject(new Error('x')),
      findFallback: () => Promise.reject(new Error('x')),
    }), 'org_acme')
    expect(allThrow).toBeNull()
  })
})

describe('validateStudioProjectManagerSetting', () => {
  it('accepts an empty value: it clears the override', () => {
    expect(validateStudioProjectManagerSetting('')).toEqual({ ok: true })
    expect(validateStudioProjectManagerSetting(null)).toEqual({ ok: true })
    expect(validateStudioProjectManagerSetting(undefined)).toEqual({ ok: true })
  })

  it('accepts any non-blank id: an unknown one simply falls through at resolve time', () => {
    expect(validateStudioProjectManagerSetting('tm_liam')).toEqual({ ok: true })
    expect(validateStudioProjectManagerSetting('anything-at-all')).toEqual({ ok: true })
  })

  it('rejects a whitespace-only value, which would look set but resolve to nothing', () => {
    const result = validateStudioProjectManagerSetting('   ')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain(STUDIO_PROJECT_MANAGER_SETTING_KEY)
  })
})
