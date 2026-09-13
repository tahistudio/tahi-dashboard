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

export type SnapEdge = 'left' | 'right' | 'top' | 'bottom'

export interface Rect extends Point, Size {}

/** The ball's persisted resting spot: which viewport edge it hugs, and its
 *  position along that edge (the y for left/right, the x for top/bottom).
 *  Persisting this instead of a raw {x, y} is what makes the snap survive a
 *  resize: re-clamping an edge + offset never strands the ball off-screen or
 *  drags it away from the edge the user actually dropped it near. */
export interface EdgeSnap {
  edge: SnapEdge
  offset: number
}

/**
 * Pure edge-snap maths for the feedback ball's soft "snap to nearest edge"
 * behaviour. Given the ball's rect at the moment it was dropped and the
 * viewport it was dropped in (callers reduce viewport.height to reserve
 * space for a mobile bottom tab bar before calling this), picks whichever of
 * the four edges is nearest and the clamped position along it.
 *
 * Ties are broken in a fixed order: left, right, top, bottom.
 */
export function snapToEdge(rect: Rect, viewport: Size, inset: number): EdgeSnap {
  const candidates: Array<{ edge: SnapEdge; distance: number }> = [
    { edge: 'left', distance: rect.x },
    { edge: 'right', distance: viewport.width - (rect.x + rect.width) },
    { edge: 'top', distance: rect.y },
    { edge: 'bottom', distance: viewport.height - (rect.y + rect.height) },
  ]
  let nearest = candidates[0]
  for (const candidate of candidates) {
    if (candidate.distance < nearest.distance) nearest = candidate
  }

  if (nearest.edge === 'left' || nearest.edge === 'right') {
    return { edge: nearest.edge, offset: clampAlongEdge(rect.y, rect.height, viewport.height, inset) }
  }
  return { edge: nearest.edge, offset: clampAlongEdge(rect.x, rect.width, viewport.width, inset) }
}

/** Clamps a position along an edge so the ball stays fully inside the
 *  available span, falling back to `inset` (never negative) when the span is
 *  smaller than the ball itself. Mirrors clampBallPosition's own guard. */
function clampAlongEdge(position: number, ballExtent: number, availableExtent: number, inset: number): number {
  const max = Math.max(inset, availableExtent - ballExtent - inset)
  return Math.min(Math.max(position, inset), max)
}

/**
 * Reconstructs the ball's fixed {x, y} from a persisted edge snap. Used both
 * right after `snapToEdge` computes a fresh snap and again on resize, so a
 * snap saved on a wide screen re-clamps along its edge rather than stranding
 * the ball off a phone's edge.
 */
export function positionForEdgeSnap(snap: EdgeSnap, ballSize: number, viewport: Size, inset: number): Point {
  const along = clampAlongEdge(snap.offset, ballSize, snap.edge === 'left' || snap.edge === 'right' ? viewport.height : viewport.width, inset)
  switch (snap.edge) {
    case 'left':
      return { x: inset, y: along }
    case 'right':
      return { x: Math.max(inset, viewport.width - ballSize - inset), y: along }
    case 'top':
      return { x: along, y: inset }
    case 'bottom':
      return { x: along, y: Math.max(inset, viewport.height - ballSize - inset) }
  }
}
