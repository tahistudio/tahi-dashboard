import { QA_VIEWPORTS, type QaViewportKey } from '@/lib/qa/types'
import type { QaScanState } from './qa-types'

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

/**
 * The device the single frame shows before the user picks one. The narrow dashboard layout in
 * Inspect starts on Mobile P (375 wide, the phone a 375px dashboard is held on); everything else
 * starts on Desktop.
 */
export function defaultSingleFrameDevice(narrowLayout: boolean, mode: QaViewMode): QaViewportKey {
  return narrowLayout && mode === 'inspect' ? 'mobile_p' : 'desktop'
}

/**
 * True when something (comment mode, an open comment card) is tied to a viewport whose frame is not
 * mounted: exactly one frame is shown and it is a different one. With all five frames mounted
 * nothing is orphaned, and with nothing in progress (null) there is nothing to clear.
 */
export function viewportOrphaned(singleFrame: boolean, tied: QaViewportKey | null, shown: QaViewportKey): boolean {
  return singleFrame && tied !== null && tied !== shown
}

/** True when every viewport has a stored scan for the page, so the "scan the others" hint can go. */
export function allViewportsScanned(states: Readonly<Partial<Record<QaViewportKey, QaScanState>>>): boolean {
  return QA_VIEWPORTS.every(v => states[v.key] === 'scanned')
}

/**
 * Whether the "Inspect scans only this device" hint shows. A read-only strip (closed round, or a
 * browser that is not part of the round) stores no scans, so the hint would mislead; and it goes
 * once every viewport already has a stored scan.
 */
export function showInspectScanNote(readOnly: boolean, states: Readonly<Partial<Record<QaViewportKey, QaScanState>>>): boolean {
  return !readOnly && !allViewportsScanned(states)
}

export const INSPECT_SCAN_NOTE = 'Inspect scans the device you are viewing. Switch device, or use Overview, to scan the others.'

/** The one short-code map for viewport names: frame label bars and the device switchers use it. */
export const VIEWPORT_SHORT_LABEL: Partial<Record<QaViewportKey, string>> = { xl: 'XL', desktop: 'Desk', tablet: 'Tab', mobile_l: 'ML', mobile_p: 'MP' }

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
    if (availableWidthPx > 0 && availableWidthPx < DEVICE_SHORT_LABEL_BELOW_PX) return { value: v.key, label: VIEWPORT_SHORT_LABEL[v.key] ?? v.shortLabel, title }
    if (availableWidthPx >= DEVICE_WIDTH_LABEL_FROM_PX) return { value: v.key, label: `${v.label} ${v.width}`, title }
    return { value: v.key, label: v.label, title }
  })
}

/** Width of the Inspect box's 1px border on both sides together. The box is the viewport width plus this. */
export const INSPECT_BORDER_PX = 2

/**
 * True when the Inspect box (the viewport width plus its border) is wider than the room it sits
 * in, so it scrolls sideways. Counting the border means a 1 to 2px overflow still shows the hint.
 */
export function inspectOverflows(viewportWidthPx: number, availableWidthPx: number): boolean {
  return availableWidthPx > 0 && viewportWidthPx + INSPECT_BORDER_PX > availableWidthPx
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

/** Frames narrower than this (the tablet and phone frames) open in a sized window; wider ones in a normal tab. */
export const SIZED_WINDOW_BELOW_PX = 1024
/**
 * Extra width so the page's layout width roughly equals the device width. This is an approximation:
 * window.open sizes the content area of a popup including its scrollbar, and a classic scrollbar
 * takes about 15px of it (overlay scrollbars take none, and browsers or the OS may clamp the size).
 */
export const POPUP_SCROLLBAR_ALLOWANCE_PX = 16

export type ViewAtFullSizeKind = 'tab' | 'window'

/** Whether "View at 100%" for a frame of this width opens a normal tab or a window sized to the device. */
export function viewAtFullSizeKind(viewportWidthPx: number): ViewAtFullSizeKind {
  return viewportWidthPx < SIZED_WINDOW_BELOW_PX ? 'window' : 'tab'
}

/**
 * Accessible name and tooltip for a frame's View at 100% button. The name starts with the visible
 * label ("View at 100%"). A tab takes the browser window's width, so the tooltip says so.
 */
export function viewAtFullSizeHint(label: string, viewportWidthPx: number): { aria: string; title: string } {
  if (viewAtFullSizeKind(viewportWidthPx) === 'tab') {
    return {
      aria: `View at 100% for ${label}, opens in a new tab at your window width`,
      title: 'View this page at 100% in a new tab (uses your window width)',
    }
  }
  return {
    aria: `View at 100% for ${label}, opens in a new window ${viewportWidthPx} pixels wide`,
    title: `View ${label} (${viewportWidthPx}px) at 100% in a new window`,
  }
}

/**
 * The window.open features string. A tab needs only the opener guards. A device window adds
 * `popup` and the content size: width plus the scrollbar allowance, and the device height. The
 * browser or OS may clamp the size (a minimum window width, or the screen height), and the popup
 * chrome (address bar) sits outside the content area. noopener and noreferrer are always present.
 */
export function viewAtFullSizeFeatures(viewport: { width: number; height: number }): string {
  if (viewAtFullSizeKind(viewport.width) === 'tab') return 'noopener,noreferrer'
  return `popup,width=${viewport.width + POPUP_SCROLLBAR_ALLOWANCE_PX},height=${viewport.height},noopener,noreferrer`
}

/** A cached view token is reused for a new tab only while at least this much of its life is left. */
export const TOKEN_FRESH_MARGIN_MS = 60 * 1000

/** True when a token expiring at `expiresAtMs` still has at least `marginMs` left. Unknown (null) is never fresh. */
export function isTokenFresh(expiresAtMs: number | null, nowMs: number, marginMs: number = TOKEN_FRESH_MARGIN_MS): boolean {
  return expiresAtMs !== null && Number.isFinite(expiresAtMs) && expiresAtMs - nowMs >= marginMs
}
