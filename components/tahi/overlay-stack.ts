/**
 * The overlay layer stack.
 *
 * Escape has to close exactly one thing: the layer the user is looking at.
 * Every overlay primitive (SlideOver, Popover, ConfirmDialog) listens for
 * Escape on `document`, and native document listeners fire in registration
 * order, so the OUTER layer hears the key first and used to close with the
 * inner one still open (dismiss a client picker inside the New request
 * dialog, lose everything typed).
 *
 * The stack fixes the ordering: each overlay registers an id while it is
 * open, and only the topmost id acts on Escape. Layers that are not part of
 * this stack (a picker with its own React keydown handler) still get their
 * say through `event.defaultPrevented`, which every consumer checks first.
 *
 * The module is deliberately dependency-free and synchronous so it can be
 * unit tested without a DOM.
 */

export interface OverlayLayerStack {
  /** Registers a layer as the new topmost one. Re-pushing an id moves it to the top. */
  push(id: string): void
  /** Removes a layer, wherever it sits. Unknown ids are ignored. */
  remove(id: string): void
  /** True when `id` is the topmost open layer (and when the stack is empty for an unknown id, never). */
  isTop(id: string): boolean
  /** How many layers are open. Exported for tests. */
  size(): number
}

export function createOverlayLayerStack(): OverlayLayerStack {
  let layers: string[] = []
  return {
    push(id) {
      layers = layers.filter(existing => existing !== id)
      layers.push(id)
    },
    remove(id) {
      layers = layers.filter(existing => existing !== id)
    },
    isTop(id) {
      return layers.length > 0 && layers[layers.length - 1] === id
    },
    size() {
      return layers.length
    },
  }
}

/** The one stack every overlay primitive shares. */
export const overlayLayers = createOverlayLayerStack()

/**
 * True when this layer should act on a keydown. Pure so the rule is testable:
 * the key has to be Escape, nobody deeper may have claimed it already, and the
 * layer has to be the topmost one open.
 */
export function shouldHandleEscape(
  event: { key: string; defaultPrevented: boolean },
  layerId: string,
  stack: OverlayLayerStack = overlayLayers,
): boolean {
  if (event.key !== 'Escape') return false
  if (event.defaultPrevented) return false
  return stack.isTop(layerId)
}

/**
 * Everything Tab can land on inside an overlay panel, in DOM order.
 * tabindex="-1" is excluded everywhere, not just on the catch-all: a
 * roving-tabindex group (the request dialog's category tiles) is a pile of
 * real buttons the browser skips, and counting them would put a trap's "last
 * stop" on something Tab never reaches.
 *
 * Lifted out of <SlideOver> unchanged so <Popover> and <ConfirmDialog> share
 * one definition of "focusable".
 */
export const FOCUSABLE_SELECTOR = [
  'a[href]:not([tabindex="-1"])',
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  '[contenteditable="true"]:not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** The visible focus stops inside a panel, in DOM order. */
export function focusablesIn(el: HTMLElement): HTMLElement[] {
  return Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter(node => node.offsetParent !== null || node === document.activeElement)
}

/**
 * True when focus has fallen off an unmounted control onto the document
 * itself. That is the only case where an overlay may pull focus back on
 * close without stealing it from something the user just clicked.
 */
export function isOrphanedFocus(active: Element | null): boolean {
  return !active || active === document.body || active === document.documentElement
}

/**
 * The document surface a scroll lock writes to. Abstracted so the refcount
 * rule below can be unit tested in the repo's DOM-free `node` environment.
 */
export interface ScrollLockTarget {
  read(): string
  write(value: string): void
}

export interface BodyScrollLock {
  /** Takes a hold. The first holder is the one that captures what to restore. */
  acquire(): void
  /** Drops a hold. The last one out restores what the first one captured. */
  release(): void
  /** How many holds are outstanding. Exported for tests. */
  holders(): number
}

/**
 * A refcounted body scroll lock.
 *
 * Every overlay used to save `document.body.style.overflow` on open and write
 * its own copy back on close. With two overlays up at once (a ConfirmDialog
 * raised from inside a SlideOver, which is the shape on docs, contracts,
 * proposals, leads, team, time and tasks) the inner one captured 'hidden' from
 * the outer one, and whichever restore ran last won: closing both could leave
 * the page permanently unscrollable with no overlay on screen.
 *
 * Counting holders fixes every ordering. Only the 0 to 1 transition reads and
 * overwrites the value, and only the 1 to 0 transition puts it back, so nested
 * overlays, sibling overlays closing in one commit, and effects that re-run
 * mid-flight (React runs every destroy before any create, which drops the
 * count to 0 and re-captures a clean value) all land on the same result.
 */
export function createBodyScrollLock(target: ScrollLockTarget): BodyScrollLock {
  let count = 0
  let restore = ''
  return {
    acquire() {
      if (count === 0) {
        restore = target.read()
        target.write('hidden')
      }
      count += 1
    },
    release() {
      if (count === 0) return
      count -= 1
      if (count === 0) target.write(restore)
    },
    holders() {
      return count
    },
  }
}

const documentBodyOverflow: ScrollLockTarget = {
  read: () => (typeof document === 'undefined' ? '' : document.body.style.overflow),
  write: value => {
    if (typeof document !== 'undefined') document.body.style.overflow = value
  },
}

/** The one lock every overlay primitive shares. */
export const bodyScrollLock = createBodyScrollLock(documentBodyOverflow)

/**
 * Takes a hold on the shared lock and hands back its release. Shaped for a
 * `useEffect` cleanup, and idempotent so a double cleanup cannot drive the
 * count negative.
 */
export function lockBodyScroll(lock: BodyScrollLock = bodyScrollLock): () => void {
  lock.acquire()
  let released = false
  return () => {
    if (released) return
    released = true
    lock.release()
  }
}
