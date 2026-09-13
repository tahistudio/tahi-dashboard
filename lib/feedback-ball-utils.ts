/**
 * lib/feedback-ball-utils.ts
 *
 * Pure helpers for components/tahi/feedback-ball.tsx, split out so the
 * drag-versus-click decision and the viewport clamp can be unit tested
 * without a real pointer or a real window.
 */

export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

/** A completed pointer gesture under this many px of travel is a click. */
export const CLICK_DISTANCE_THRESHOLD_PX = 6

/** Euclidean distance between two points. */
export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * Decide whether a completed pointer gesture opens the panel (click) or just
 * repositioned the ball (drag). Judged on the LARGEST distance the pointer
 * travelled from its press-down point at any moment during the gesture, not
 * the net start-to-end displacement, so a drag that loops back to its origin
 * still counts as a drag rather than a click.
 */
export function isClickGesture(
  maxDisplacementPx: number,
  threshold: number = CLICK_DISTANCE_THRESHOLD_PX,
): boolean {
  return maxDisplacementPx < threshold
}

/**
 * Clamp the ball's top-left position so the whole ball stays inside the
 * viewport. Used both while dragging and on window resize, so a position
 * saved from a wide screen never strands the ball off a phone's edge.
 *
 * A viewport narrower/shorter than the ball itself (an extreme resize) still
 * returns a sane, non-negative position rather than a negative max.
 */
export function clampBallPosition(
  position: Point,
  ballSize: number,
  viewport: Size,
  margin: number = 0,
): Point {
  const maxX = Math.max(margin, viewport.width - ballSize - margin)
  const maxY = Math.max(margin, viewport.height - ballSize - margin)
  return {
    x: Math.min(Math.max(position.x, margin), maxX),
    y: Math.min(Math.max(position.y, margin), maxY),
  }
}

/** Tailwind's own breakpoints: <640 phone, <1024 tablet, else desktop. */
export function breakpointForWidth(width: number): 'phone' | 'tablet' | 'desktop' {
  if (width < 640) return 'phone'
  if (width < 1024) return 'tablet'
  return 'desktop'
}
