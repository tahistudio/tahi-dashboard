/**
 * Onboarding used to have no way out: sign in with the wrong account, or
 * follow an invite meant for someone else, and the wizard just sat there with
 * no menu and no sign-out. This pins the quiet "sign out and return to sign
 * in" link that now lives inside <SceneShell>, the frame every step of both
 * onboarding flows (components/tahi/onboarding-content.tsx: the chooser AND
 * the enquiry sub-screens both render through it) and the team welcome flow
 * (components/tahi/team-welcome-content.tsx) already renders unchanged. That
 * means touching only onboarding-shell.tsx puts the link on every one of
 * those screens, with no other call site needing its own copy.
 */
import { describe, it, expect, vi } from 'vitest'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const signOut = vi.fn()
vi.mock('@clerk/nextjs', () => ({ useClerk: () => ({ signOut }) }))

import { SceneShell } from '@/components/tahi/onboarding-shell'

describe('SceneShell return-to-sign-in footer', () => {
  it('renders the quiet sign-out copy regardless of what scene content a step passes in', () => {
    const html = renderToStaticMarkup(
      <SceneShell>
        <span>Any step&apos;s own scene content</span>
      </SceneShell>,
    )
    expect(html).toContain('ta-signout')
    expect(html).toContain('Not you, or wrong account?')
    expect(html).toContain('Sign out and return to sign in')
  })

  it('is a real button (not inert text) sized for a 44px hit area, not an anchor with no handler', () => {
    const html = renderToStaticMarkup(
      <SceneShell>
        <span />
      </SceneShell>,
    )
    expect(html).toMatch(/<button type="button" class="ta-signout">/)
  })
})
