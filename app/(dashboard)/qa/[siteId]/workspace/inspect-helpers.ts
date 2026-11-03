import { QA_VIEWPORTS, type QaViewportKey } from '@/lib/qa/types'

/**
 * Pure helpers for the workspace view modes.
 *
 * Inspect shows ONE device frame at scale 1 (no transform) so no element edge falls between
 * device pixels. Overview is the original all-frames-side-by-side layout, scaled to fit.
 */

export type QaViewMode = 'inspect' | 'overview'

/** A round (or person) that has never chosen starts in Inspect, the only seam-free mode. */
export const DEFAULT_VIEW_MODE: QaViewMode = 'inspect'
export const VIEW_MODE_STORAGE_KEY = 'tahi-qa-view-mode'

/** Reads a stored mode. Anything missing or unreadable falls back to the default (Inspect). */
export function parseViewMode(raw: unknown): QaViewMode {
  return raw === 'overview' || raw === 'inspect' ? raw : DEFAULT_VIEW_MODE
}

/** The device Inspect (and the narrow single-frame layout) shows before anything is picked. */
export const DEFAULT_INSPECT_DEVICE: QaViewportKey = 'desktop'

/** A viewport key from untrusted input, or the fallback. */
export function parseViewportKey(raw: unknown, fallback: QaViewportKey = DEFAULT_INSPECT_DEVICE): QaViewportKey {
  const hit = QA_VIEWPORTS.find(v => v.key === raw)
  return hit ? hit.key : fallback
}

/**
 * Whether the workspace mounts exactly one frame. True in Inspect (always) and in the narrow
 * dashboard layout (even in Overview, where that one frame is scaled to the width on offer).
 */
export function showsSingleFrame(narrowLayout: boolean, mode: QaViewMode): boolean {
  return narrowLayout || mode === 'inspect'
}

/** Below this switcher width (px) the device switcher uses short labels. */
export const DEVICE_SHORT_LABEL_BELOW_PX = 560
/** Below this switcher width (px) the long labels drop the pixel width. */
export const DEVICE_WIDTH_LABEL_FROM_PX = 760

const SHORT_LABEL: Record<QaViewportKey, string> = { xl: 'XL', desktop: 'Desk', tablet: 'Tab', mobile_l: 'ML', mobile_p: 'MP' }

export interface InspectDeviceOption {
  value: QaViewportKey
  label: string
  title: string
}

/**
 * Options for the Inspect device switcher: the existing viewport labels with their pixel widths
 * ("Desktop 1440") when there is room, the plain label when less, and short codes when narrow.
 * The title always carries the full name and width.
 */
export function inspectDeviceOptions(availableWidthPx: number): InspectDeviceOption[] {
  return QA_VIEWPORTS.map(v => {
    const title = `${v.label} (${v.width}px)`
    if (availableWidthPx > 0 && availableWidthPx < DEVICE_SHORT_LABEL_BELOW_PX) return { value: v.key, label: SHORT_LABEL[v.key], title }
    if (availableWidthPx >= DEVICE_WIDTH_LABEL_FROM_PX) return { value: v.key, label: `${v.label} ${v.width}`, title }
    return { value: v.key, label: v.label, title }
  })
}

/** True when a frame at its true width is wider than the room it sits in, so it scrolls sideways. */
export function inspectOverflows(viewportWidthPx: number, availableWidthPx: number): boolean {
  return availableWidthPx > 0 && viewportWidthPx > availableWidthPx
}

/**
 * Pixels one "scroll sideways" button press moves: most of the visible width, so a little of the
 * previous view stays in sight. Never less than one pixel.
 */
export function inspectScrollStep(availableWidthPx: number): number {
  return Math.max(1, Math.round(availableWidthPx * 0.8))
}

/**
 * The URL that opens a page at its true size in its own tab: the proxy base URL (which already
 * carries the signed view token) plus the page path. Null when the base is not an http(s) URL.
 * The reload parameter is never added, so the tab shows the plain page.
 */
export function viewAtFullSizeUrl(baseUrl: string, path: string): string | null {
  try {
    const parsed = new URL(baseUrl)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  } catch {
    return null
  }
  const base = baseUrl.replace(/\/+$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  return `${base}${p}`
}

/** A cached view token is reused for a new tab only while at least this much of its life is left. */
export const TOKEN_FRESH_MARGIN_MS = 60 * 1000

/** True when a token expiring at `expiresAtMs` still has at least `marginMs` left. Unknown (null) is never fresh. */
export function isTokenFresh(expiresAtMs: number | null, nowMs: number, marginMs: number = TOKEN_FRESH_MARGIN_MS): boolean {
  return expiresAtMs !== null && Number.isFinite(expiresAtMs) && expiresAtMs - nowMs >= marginMs
}
