import { describe, it, expect } from 'vitest'
import {
  createBodyScrollLock,
  createOverlayLayerStack,
  lockBodyScroll,
  shouldHandleEscape,
  type ScrollLockTarget,
} from '@/components/tahi/overlay-stack'

// The repo's Vitest runs in the `node` environment with no DOM, so this
// covers the two pure rules the three overlay primitives share: who owns
// Escape, and who owns the body scroll lock. The DOM half (focus moves into a
// Popover panel, returns to the anchor, a picker inside a dialog dismisses
// without taking the dialog with it) runs in Playwright.

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

function fakeBody(initial = '') {
  const state = { overflow: initial }
  const target: ScrollLockTarget = {
    read: () => state.overflow,
    write: value => { state.overflow = value },
  }
  return { state, target }
}

describe('body scroll lock', () => {
  it('writes on the first hold and restores on the last', () => {
    const { state, target } = fakeBody('auto')
    const lock = createBodyScrollLock(target)

    lock.acquire()
    expect(state.overflow).toBe('hidden')
    expect(lock.holders()).toBe(1)

    lock.release()
    expect(state.overflow).toBe('auto')
    expect(lock.holders()).toBe(0)
  })

  it('acquire, acquire, release, release restores the original value once', () => {
    // The nesting this exists for: a SlideOver takes the lock, a
    // ConfirmDialog raised from inside it takes the lock too. The inner one
    // must not capture the outer one's 'hidden' as the value to put back.
    const { state, target } = fakeBody('')
    const lock = createBodyScrollLock(target)

    lock.acquire()          // SlideOver opens
    lock.acquire()          // ConfirmDialog opens on top
    expect(state.overflow).toBe('hidden')
    expect(lock.holders()).toBe(2)

    lock.release()          // ConfirmDialog closes
    expect(state.overflow).toBe('hidden')

    lock.release()          // SlideOver closes
    expect(state.overflow).toBe('')
  })

  it('survives the two closing in the other order', () => {
    // React runs passive destroys in tree order, so when both close in one
    // commit the OUTER overlay releases first. Before the refcount, that
    // ordering left the inner one writing 'hidden' back over a clean body.
    const { state, target } = fakeBody('')
    const lock = createBodyScrollLock(target)

    lock.acquire()
    lock.acquire()
    lock.release()
    lock.release()
    expect(state.overflow).toBe('')
    expect(lock.holders()).toBe(0)
  })

  it('re-captures a clean value when an effect churns down to zero holders', () => {
    // An effect whose deps include an inline arrow re-runs on every parent
    // render: destroy then create. Dropping to zero restores the original,
    // and the create captures that same original again.
    const { state, target } = fakeBody('auto')
    const lock = createBodyScrollLock(target)

    lock.acquire()
    lock.release()
    lock.acquire()
    expect(state.overflow).toBe('hidden')
    lock.release()
    expect(state.overflow).toBe('auto')
  })

  it('ignores a release with nothing held, so the count cannot go negative', () => {
    const { state, target } = fakeBody('auto')
    const lock = createBodyScrollLock(target)

    lock.release()
    expect(lock.holders()).toBe(0)
    expect(state.overflow).toBe('auto')

    lock.acquire()
    expect(state.overflow).toBe('hidden')
    lock.release()
    expect(state.overflow).toBe('auto')
  })
})

describe('lockBodyScroll', () => {
  it('hands back a release that only counts once', () => {
    // Shaped for a useEffect cleanup, which React may invoke more than once
    // in development. A second call must not free somebody else's hold.
    const { state, target } = fakeBody('')
    const lock = createBodyScrollLock(target)

    const releaseOuter = lockBodyScroll(lock)
    const releaseInner = lockBodyScroll(lock)
    expect(lock.holders()).toBe(2)

    releaseInner()
    releaseInner()
    expect(lock.holders()).toBe(1)
    expect(state.overflow).toBe('hidden')

    releaseOuter()
    expect(lock.holders()).toBe(0)
    expect(state.overflow).toBe('')
  })
})
