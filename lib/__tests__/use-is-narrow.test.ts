/**
 * useIsNarrow was hoisted out of schedule-section-renderers.tsx (where it
 * was a private helper) into lib/use-is-narrow.ts so the gantt strip and
 * any other public-viewer surface can share the same narrow-mode
 * threshold. This pins the re-export so existing imports keep working
 * and the two modules stay the same function, not two copies that could
 * drift.
 */
import { describe, it, expect } from 'vitest'
import { useIsNarrow as fromLib } from '@/lib/use-is-narrow'
import { useIsNarrow as reExported } from '@/components/tahi/schedule-section-renderers'

describe('useIsNarrow', () => {
  it('is a hook (a function taking an optional breakpoint)', () => {
    expect(typeof fromLib).toBe('function')
  })

  it('schedule-section-renderers re-exports the exact same function, not a duplicate', () => {
    expect(reExported).toBe(fromLib)
  })
})
