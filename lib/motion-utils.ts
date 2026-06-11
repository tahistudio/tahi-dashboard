/**
 * motion-utils.ts. Pure tween math shared by CountUp and any other
 * rAF-driven animation in the delight kit.
 *
 * Kept dependency-free and side-effect-free so it is testable in a plain
 * Node/Vitest environment without a DOM.
 */

// ── Easing ──────────────────────────────────────────────────────────────────

/**
 * easeOutCubic. Decelerating ease used by CountUp and ProgressRing.
 * Maps progress t (0..1) to an eased output value (0..1).
 * At t=0 the result is 0; at t=1 the result is 1.
 */
export function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t))
  return 1 - Math.pow(1 - clamped, 3)
}

// ── Tween ────────────────────────────────────────────────────────────────────

/**
 * computeTweenValue. Calculates the interpolated numeric value at a given
 * point in a tween animation.
 *
 * @param from      Starting value (displayed before the animation begins).
 * @param to        Target value (displayed when the animation finishes).
 * @param elapsed   Milliseconds elapsed since the animation started (>= 0).
 * @param duration  Total animation duration in milliseconds (> 0).
 * @returns         The interpolated value, clamped to [from, to] (or
 *                  [to, from] when counting down) so callers never receive
 *                  values outside the intended range.
 */
export function computeTweenValue(
  from: number,
  to: number,
  elapsed: number,
  duration: number,
): number {
  if (duration <= 0) return to
  const progress = Math.min(1, Math.max(0, elapsed / duration))
  const eased = easeOutCubic(progress)
  const raw = from + (to - from) * eased
  // Clamp to the inclusive range [min(from,to), max(from,to)] so floating-
  // point arithmetic never produces a value fractionally outside the bounds.
  const lo = Math.min(from, to)
  const hi = Math.max(from, to)
  return Math.min(hi, Math.max(lo, raw))
}
