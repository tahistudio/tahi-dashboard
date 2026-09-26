/**
 * app/p/layout.tsx: no localStorage bleed between documents.
 *
 * A visitor who once toggled the dashboard's dark mode on this browser must
 * not have that preference corrupt a shared proposal or schedule link. The
 * blocking theme script in app/layout.tsx skips /p/ paths on a direct load
 * (lib/__tests__/theme-boot-script.test.ts runs it); this layout still
 * strips the class on mount for a client-side navigation in from the
 * dashboard, and mounts the toast provider these viewers need for their
 * non-alert() error state.
 *
 * No jsdom/testing-library in this repo's Vitest harness, so the DOM
 * effect itself is exercised end to end by Playwright; this pins the
 * two structural facts vitest can check without a document: the layout
 * renders its children (nothing gets swallowed), and it mounts
 * ToastProvider around them.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import PublicDocumentLayout from '@/app/p/layout'

Object.assign(globalThis, { React })

describe('PublicDocumentLayout', () => {
  it('renders its children', () => {
    const html = renderToStaticMarkup(
      <PublicDocumentLayout><div data-testid="child">the document</div></PublicDocumentLayout>,
    )
    expect(html).toContain('the document')
  })

  it('strips the dashboard dark-mode class on mount instead of inheriting it', () => {
    const src = readFileSync(join(process.cwd(), 'app', 'p', 'layout.tsx'), 'utf8')
    expect(src).toContain("classList.remove('dark')")
  })

  it('mounts ToastProvider so the viewers can toast instead of alert()', () => {
    const src = readFileSync(join(process.cwd(), 'app', 'p', 'layout.tsx'), 'utf8')
    expect(src).toContain('ToastProvider')
    expect(src).toContain("from '@/components/tahi/toast'")
  })
})
