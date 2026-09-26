/**
 * lib/theme-boot-script.ts: the blocking <head> script app/layout.tsx runs
 * before first paint. Executes the exact string against a stubbed
 * location/localStorage/document, because what matters is what the browser
 * does with it: the dashboard keeps its no-flash dark mode, and a /p/
 * document never gets `.dark` in the first place (it used to be added here
 * and removed by app/p/layout.tsx after hydration, a visible dark flash).
 */
import { describe, it, expect } from 'vitest'
import { themeBootScript } from '@/lib/theme-boot-script'

function run(pathname: string, stored: Record<string, string>, prefix = '/p/'): string[] {
  const classes = new Set<string>()
  const location = { pathname }
  const localStorage = { getItem: (k: string) => stored[k] ?? null }
  const document = { documentElement: { classList: { add: (c: string) => { classes.add(c) } } } }
  new Function('location', 'localStorage', 'document', themeBootScript(prefix))(location, localStorage, document)
  return [...classes].sort()
}

describe('themeBootScript', () => {
  it('applies the stored dark theme on a dashboard route', () => {
    expect(run('/contracts/abc', { 'tahi-theme': 'dark' })).toEqual(['dark'])
  })

  it('never applies dark on a public document route', () => {
    expect(run('/p/contract/tok_123', { 'tahi-theme': 'dark' })).toEqual([])
    expect(run('/p/proposal/tok_123', { 'tahi-theme': 'dark' })).toEqual([])
    expect(run('/p/schedule/tok_123/print', { 'tahi-theme': 'dark' })).toEqual([])
  })

  it('only skips the /p/ segment itself, not routes that merely start with p', () => {
    expect(run('/proposals/abc', { 'tahi-theme': 'dark' })).toEqual(['dark'])
    expect(run('/preview/contract/abc', { 'tahi-theme': 'dark' })).toEqual(['dark'])
  })

  it('still applies reduced motion on a public document, an accessibility preference rather than a theme', () => {
    expect(run('/p/contract/tok_123', { 'tahi-theme': 'dark', 'tahi-reduce-motion': 'true' })).toEqual(['reduce-motion'])
  })

  it('leaves the light theme alone', () => {
    expect(run('/overview', { 'tahi-theme': 'light' })).toEqual([])
  })

  it('honours a base path in front of /p/', () => {
    expect(run('/dashboard/p/contract/tok_123', { 'tahi-theme': 'dark' }, '/dashboard/p/')).toEqual([])
    expect(run('/dashboard/overview', { 'tahi-theme': 'dark' }, '/dashboard/p/')).toEqual(['dark'])
  })

  it('swallows a storage error instead of breaking the page', () => {
    const throwing = { getItem: () => { throw new Error('blocked') } }
    const document = { documentElement: { classList: { add: () => {} } } }
    expect(() => new Function('location', 'localStorage', 'document', themeBootScript('/p/'))(
      { pathname: '/overview' }, throwing, document,
    )).not.toThrow()
  })
})
