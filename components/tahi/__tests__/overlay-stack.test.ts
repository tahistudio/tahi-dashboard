import { describe, it, expect } from 'vitest'
import { createOverlayLayerStack, shouldHandleEscape } from '@/components/tahi/overlay-stack'

// The repo's Vitest runs in the `node` environment with no DOM, so this
// covers the pure rule the three overlay primitives share: who owns Escape.
// The DOM half (focus moves into a Popover panel, returns to the anchor, a
// picker inside a dialog dismisses without taking the dialog with it) runs in
// Playwright.

const escape = (defaultPrevented = false) => ({ key: 'Escape', defaultPrevented })

describe('overlay layer stack', () => {
  it('treats the last pushed layer as the top one', () => {
    const stack = createOverlayLayerStack()
    stack.push('dialog')
    expect(stack.isTop('dialog')).toBe(true)

    stack.push('popover')
    expect(stack.isTop('popover')).toBe(true)
    expect(stack.isTop('dialog')).toBe(false)
    expect(stack.size()).toBe(2)
  })

  it('hands the top back to the layer underneath when the inner one closes', () => {
    const stack = createOverlayLayerStack()
    stack.push('dialog')
    stack.push('popover')
    stack.remove('popover')

    expect(stack.isTop('dialog')).toBe(true)
    expect(stack.size()).toBe(1)
  })

  it('ignores unknown ids and never calls an empty stack topmost', () => {
    const stack = createOverlayLayerStack()
    expect(stack.isTop('nothing')).toBe(false)
    stack.remove('nothing')
    expect(stack.size()).toBe(0)
  })

  it('re-pushing a layer moves it to the top rather than duplicating it', () => {
    const stack = createOverlayLayerStack()
    stack.push('a')
    stack.push('b')
    stack.push('a')

    expect(stack.isTop('a')).toBe(true)
    expect(stack.size()).toBe(2)
    stack.remove('a')
    expect(stack.isTop('b')).toBe(true)
  })
})

describe('shouldHandleEscape', () => {
  it('only fires for Escape', () => {
    const stack = createOverlayLayerStack()
    stack.push('dialog')
    expect(shouldHandleEscape({ key: 'Enter', defaultPrevented: false }, 'dialog', stack)).toBe(false)
    expect(shouldHandleEscape(escape(), 'dialog', stack)).toBe(true)
  })

  it('stands down when a deeper layer already claimed the key', () => {
    const stack = createOverlayLayerStack()
    stack.push('dialog')
    // A picker with its own React keydown handler calls preventDefault before
    // the document listener runs.
    expect(shouldHandleEscape(escape(true), 'dialog', stack)).toBe(false)
  })

  it('stands down when it is not the topmost layer', () => {
    const stack = createOverlayLayerStack()
    stack.push('dialog')
    stack.push('popover')

    // The enclosing dialog registered its document listener first, so it
    // hears the key first; without the stack it closed and took the popover
    // and everything typed with it.
    expect(shouldHandleEscape(escape(), 'dialog', stack)).toBe(false)
    expect(shouldHandleEscape(escape(), 'popover', stack)).toBe(true)
  })
})
