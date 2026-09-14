/**
 * lib/feedback-screenshot.ts
 *
 * The feedback ball's best-effort screenshot. Client only, and imported
 * dynamically at send time so html-to-image never lands in the main bundle
 * for the overwhelming majority of sessions that never leave a comment.
 *
 * WHAT IS CAPTURED, AND WHY THE WHOLE PAGE RATHER THAN THE VIEWPORT
 *
 * html-to-image works by cloning the node into an SVG foreignObject, and a
 * clone does not carry scrollTop: an internally scrolled container renders
 * from its top no matter where the user actually was. Cropping to the
 * viewport would therefore reliably produce a picture of the top of the
 * page, which is the one region the commenter was probably not looking at.
 *
 * So the whole scroll container is captured instead, at pixelRatio 1, with
 * no downscaling. That gives a contract worth having: one image pixel is one
 * CSS pixel, the image is exactly `scrollHeight` tall, and the anchor rect
 * stored alongside it (lib/feedback-anchor.ts#rectInScroller, which is
 * content-relative for the same scroller) indexes straight into the image.
 * Draw the rect on the image and you have the pin.
 *
 * Everything here fails soft. A capture that throws, times out, or would be
 * absurdly large returns null and the comment sends without one. Losing a
 * comment to save a picture would be the wrong trade.
 */

/** Past this many pixels the canvas is more likely to OOM a phone than to
 *  produce anything, so the capture is skipped. A 400px-wide page would have
 *  to be 30,000px tall to trip it. */
const MAX_CAPTURE_PIXELS = 12_000_000

/** A slow capture must not hold the comment hostage. */
const CAPTURE_TIMEOUT_MS = 6000

const SCROLLABLE_OVERFLOW = new Set(['auto', 'scroll', 'overlay'])

function scrolls(el: Element): boolean {
  return el.scrollHeight > el.clientHeight
    && SCROLLABLE_OVERFLOW.has(window.getComputedStyle(el).overflowY)
}

/**
 * The element whose content the screenshot should cover: the same one
 * findScrollState resolves the anchor rect against, so the two share a
 * coordinate space. Walks up from the picked element (or the body when the
 * comment is general), then falls back to the dashboard shell and finally to
 * the document.
 */
export function findScrollerNode(start: HTMLElement | null): HTMLElement {
  let current: HTMLElement | null = start?.parentElement ?? null
  while (current) {
    if (scrolls(current)) return current
    current = current.parentElement
  }
  const shell = document.getElementById('main-content')
  if (shell && scrolls(shell)) return shell
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    work,
    new Promise<null>(resolve => window.setTimeout(() => resolve(null), ms)),
  ])
}

/**
 * Rasterise the scroll container and store it, returning the R2 key to hang
 * on the comment. Null on any failure, including a missing STORAGE binding,
 * a page too large to capture, and the timeout.
 */
export async function captureAndStoreScreenshot(
  pickedEl: HTMLElement | null,
  uploadPath: string,
): Promise<string | null> {
  try {
    const node = findScrollerNode(pickedEl)
    const width = node.clientWidth
    const height = node.scrollHeight
    if (width < 1 || height < 1) return null
    if (width * height > MAX_CAPTURE_PIXELS) return null

    const { toCanvas } = await import('html-to-image')
    const canvas = await withTimeout(
      toCanvas(node, {
        pixelRatio: 1,
        width,
        height,
        // The clone is laid out at full content height, so anything relying
        // on the scroller's own clipping has to be told its new size.
        style: { height: `${height}px`, maxHeight: 'none', overflow: 'visible' },
        // The ball itself is not part of what the comment is about.
        filter: (n: HTMLElement) => n.dataset?.feedbackBall !== 'true',
      }),
      CAPTURE_TIMEOUT_MS,
    )
    if (!canvas) return null

    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, 'image/webp', 0.8),
    )
    if (!blob || blob.size === 0) return null

    const res = await fetch(uploadPath, {
      method: 'POST',
      headers: { 'Content-Type': 'image/webp' },
      body: blob,
    })
    if (!res.ok) return null
    const json = (await res.json()) as { key?: unknown }
    return typeof json.key === 'string' ? json.key : null
  } catch {
    return null
  }
}
