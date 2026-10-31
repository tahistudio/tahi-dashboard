import {
  QA_VIEWPORTS,
  isQaBrowserKey,
  type QaBrowserKey,
  type QaComment,
  type QaCommentModeChangedMessage,
  type QaCommentStatus,
  type QaElementContext,
  type QaEscapeMessage,
  type QaPickMessage,
  type QaPin,
  type QaPinClickMessage,
  type QaViewportKey,
} from '@/lib/qa/types'
import { parseElementContext } from '@/lib/qa/comments'

/** A comment with its 1-based pin number on the round page. */
export type NumberedComment = QaComment & { n: number }

export type CommentFilter = 'open' | 'resolved' | 'all'

export interface CommentViewportGroup {
  viewport: QaViewportKey
  label: string
  items: NumberedComment[]
}

/**
 * Sorts comments oldest first (created_at, ties by id) and numbers them 1-based.
 * This matches the server's pin numbering so the list and the pins agree.
 */
export function numberComments(comments: QaComment[]): NumberedComment[] {
  const sorted = [...comments].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
    if (a.id !== b.id) return a.id < b.id ? -1 : 1
    return 0
  })
  return sorted.map((comment, index) => ({ ...comment, n: index + 1 }))
}

/** The comments made in one browser. A null browser keeps them all ("All browsers"). */
export function commentsForBrowser(comments: NumberedComment[], browser: QaBrowserKey | null): NumberedComment[] {
  return browser === null ? comments : comments.filter(c => c.browser === browser)
}

/**
 * Pins to draw in one frame. Only comments on that viewport made in the browser being tested
 * (every browser when none is given), in number order.
 */
export function pinsFor(comments: NumberedComment[], viewport: QaViewportKey, browser?: QaBrowserKey): QaPin[] {
  return comments
    .filter(c => c.viewport === viewport && (browser === undefined || c.browser === browser))
    .map(c => ({
      id: c.id,
      n: c.n,
      selector: c.selector,
      ox: c.ox,
      oy: c.oy,
      resolved: c.status === 'resolved',
    }))
}

export function matchesFilter(status: QaCommentStatus, filter: CommentFilter): boolean {
  return filter === 'all' || filter === status
}

/**
 * The filter to show so the selected comment is visible. A selection hidden by the
 * current filter widens it to 'all'; otherwise the filter is left as the user set it.
 */
export function filterForSelection(
  comments: ReadonlyArray<Pick<QaComment, 'id' | 'status'>>,
  selectedId: string | null,
  filter: CommentFilter,
): CommentFilter {
  if (!selectedId) return filter
  const selected = comments.find(c => c.id === selectedId)
  if (!selected) return filter
  return matchesFilter(selected.status, filter) ? filter : 'all'
}

/** Filters by status, then groups by viewport in QA_VIEWPORTS order. Empty groups are dropped. */
export function groupByViewport(comments: NumberedComment[], filter: CommentFilter): CommentViewportGroup[] {
  const groups: CommentViewportGroup[] = []
  for (const vp of QA_VIEWPORTS) {
    const items = comments
      .filter(c => c.viewport === vp.key && matchesFilter(c.status, filter))
      .sort((a, b) => a.n - b.n)
    if (items.length > 0) groups.push({ viewport: vp.key, label: vp.label, items })
  }
  return groups
}

export function countByStatus(comments: QaComment[]): { open: number; resolved: number } {
  let open = 0
  let resolved = 0
  for (const c of comments) {
    if (c.status === 'open') open += 1
    else resolved += 1
  }
  return { open, resolved }
}

/** Tab label, e.g. "Comments (3 open)". */
export function commentsTabLabel(comments: QaComment[]): string {
  return `Comments (${countByStatus(comments).open} open)`
}

/** Collapses whitespace so an element snippet stays on one line. */
export function oneLine(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

/** Open comments first, then resolved; number order inside each band. */
export function openFirst(comments: NumberedComment[]): NumberedComment[] {
  return [...comments].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'open' ? -1 : 1
    return a.n - b.n
  })
}

/* ------------------------------------------------------------------ */
/* Frame messages (frame to dashboard). Pure guards, no DOM access.     */
/* ------------------------------------------------------------------ */

const SELECTOR_MAX = 1000
const TAG_MAX = 40
const TEXT_MAX = 120
const ID_MAX = 200

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFraction(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

/**
 * Validates a qa:pick message. Returns a cleaned copy (text trimmed and capped)
 * or null when any field has the wrong type or range.
 */
export function parsePickMessage(data: unknown): QaPickMessage | null {
  if (!isRecord(data) || data.type !== 'qa:pick' || data.version !== 1) return null
  const { url, selector, ox, oy, tag, text } = data
  if (typeof url !== 'string' || url.length === 0) return null
  if (typeof selector !== 'string' || selector.length === 0 || selector.length > SELECTOR_MAX) return null
  if (!isFraction(ox) || !isFraction(oy)) return null
  if (typeof tag !== 'string' || tag.length === 0 || tag.length > TAG_MAX) return null
  if (typeof text !== 'string') return null
  const pick: QaPickMessage = { type: 'qa:pick', version: 1, url, selector, ox, oy, tag: tag.toLowerCase(), text: oneLine(text).slice(0, TEXT_MAX) }
  const context = parsePickContext(data.context)
  if (context) pick.context = context
  return pick
}

/**
 * The optional element context of a pick. A context that is not an object with a
 * class list and a box is dropped, and the rest is clamped by the same parser the
 * API uses. A bad context never rejects the pick.
 */
function parsePickContext(raw: unknown): QaElementContext | undefined {
  if (!isRecord(raw) || !Array.isArray(raw.classes) || !isRecord(raw.box)) return undefined
  return parseElementContext(raw) ?? undefined
}

/** Validates a qa:pin-click message. */
export function parsePinClickMessage(data: unknown): QaPinClickMessage | null {
  if (!isRecord(data) || data.type !== 'qa:pin-click' || data.version !== 1) return null
  const { id } = data
  if (typeof id !== 'string' || id.length === 0 || id.length > ID_MAX) return null
  return { type: 'qa:pin-click', version: 1, id }
}

/** Validates a qa:comment-mode-changed message. */
export function parseModeChangedMessage(data: unknown): QaCommentModeChangedMessage | null {
  if (!isRecord(data) || data.type !== 'qa:comment-mode-changed' || data.version !== 1) return null
  if (typeof data.on !== 'boolean') return null
  return { type: 'qa:comment-mode-changed', version: 1, on: data.on }
}

/** Validates a qa:escape message (Esc pressed inside a frame while comment mode was off). */
export function parseEscapeMessage(data: unknown): QaEscapeMessage | null {
  if (!isRecord(data) || data.type !== 'qa:escape' || data.version !== 1) return null
  return { type: 'qa:escape', version: 1 }
}

/**
 * The viewport whose frame sent a message, found by comparing windows. A viewport
 * claimed inside the message is never trusted.
 */
export function viewportForSource(
  frames: Partial<Record<QaViewportKey, { contentWindow: unknown } | null | undefined>>,
  source: unknown,
): QaViewportKey | null {
  if (source === null || source === undefined) return null
  for (const v of QA_VIEWPORTS) {
    const frame = frames[v.key]
    if (frame && frame.contentWindow === source) return v.key
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Composer placement                                                    */
/* ------------------------------------------------------------------ */

export interface RectLike { left: number; top: number; width: number; height: number }

export const COMPOSER_WIDTH_PX = 352
export const COMPOSER_HEIGHT_PX = 336
const COMPOSER_MARGIN_PX = 8

/**
 * Fixed-position top left for the composer card, anchored to a frame and kept fully
 * inside the window. The card is centred over the frame when it fits, otherwise pinned
 * to the window edge (a 375px window leaves the card the full width less the margins).
 */
export function composerPlacement(frame: RectLike, windowWidth: number, windowHeight: number): { left: number; top: number; width: number } {
  const width = Math.min(COMPOSER_WIDTH_PX, Math.max(0, windowWidth - COMPOSER_MARGIN_PX * 2))
  const maxLeft = Math.max(COMPOSER_MARGIN_PX, windowWidth - width - COMPOSER_MARGIN_PX)
  const maxTop = Math.max(COMPOSER_MARGIN_PX, windowHeight - COMPOSER_HEIGHT_PX - COMPOSER_MARGIN_PX)
  const left = Math.min(maxLeft, Math.max(COMPOSER_MARGIN_PX, frame.left + frame.width / 2 - width / 2))
  const top = Math.min(maxTop, Math.max(COMPOSER_MARGIN_PX, frame.top + COMPOSER_MARGIN_PX))
  return { left, top, width }
}

/* ------------------------------------------------------------------ */
/* Create request from a comment                                         */
/* ------------------------------------------------------------------ */

export const REQUEST_TITLE_MAX = 120
/** The create-request route rejects a description longer than this. */
export const REQUEST_DESCRIPTION_MAX = 4000

/** First line of the comment, capped at 120 characters. */
export function commentRequestTitle(body: string): string {
  const first = body.split(/\r?\n/).find(line => line.trim().length > 0) ?? ''
  const clean = first.trim()
  return clean.length > REQUEST_TITLE_MAX ? clean.slice(0, REQUEST_TITLE_MAX).trimEnd() : clean
}

/** Title and description for the create-request dialog, built from a comment. */
export function commentRequestPrefill(
  comment: Pick<QaComment, 'body' | 'elementTag' | 'elementText'>,
  viewportLabel: string,
  pagePath: string,
): { title: string; description: string } {
  const snippet = oneLine(comment.elementText)
  const element = `<${comment.elementTag ?? 'element'}>${snippet ? ` ${snippet}` : ''}`
  const details = [
    '',
    `Viewport: ${viewportLabel}`,
    `Element: ${element}`,
    `Page: ${pagePath}`,
  ].join('\n')
  // The whole description must fit the create-request cap, so only the comment text gives way.
  const room = Math.max(0, REQUEST_DESCRIPTION_MAX - details.length - 1)
  const trimmed = comment.body.trim()
  const body = trimmed.length > room ? `${trimmed.slice(0, Math.max(0, room - 1)).trimEnd()}\u2026` : trimmed
  const description = `${body}\n${details}`.slice(0, REQUEST_DESCRIPTION_MAX)
  return { title: commentRequestTitle(comment.body), description }
}

/** True when the composer holds typed text that a new pick or Esc must not discard. */
export function composerHasDraft(text: string | null | undefined): boolean {
  return (text ?? '').trim().length > 0
}

/**
 * What a new element pick does. With no composer it opens one, with an empty
 * composer it replaces it, and with typed text it is ignored so the text survives.
 */
export function pickAction(composerOpen: boolean, draft: string | null | undefined): 'open' | 'replace' | 'ignore' {
  if (!composerOpen) return 'open'
  return composerHasDraft(draft) ? 'ignore' : 'replace'
}

// Comment view (which pins to draw). View state only: nothing here
// touches a comment, and pin numbers stay the server n.

export const COMMENT_VIEW_STORAGE_KEY = 'tahi-qa-comment-view'

export interface CommentView {
  /** Master switch: false hides every pin. */
  show: boolean
  /** Which statuses get a pin. The default draws both, as before. */
  status: CommentFilter
  /** Browsers whose comments get a pin. null is the browser being tested, as before. */
  browsers: QaBrowserKey[] | null
  /** Viewports whose frames get no pins. Empty draws pins in every frame. */
  hiddenViewports: QaViewportKey[]
}

export const DEFAULT_COMMENT_VIEW: CommentView = { show: true, status: 'all', browsers: null, hiddenViewports: [] }

const VIEWPORT_KEYS: readonly string[] = QA_VIEWPORTS.map(v => v.key)

/** Reads a stored view. Anything missing or unreadable falls back to the default for that field. */
export function parseCommentView(raw: string | null | undefined): CommentView {
  if (!raw) return DEFAULT_COMMENT_VIEW
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return DEFAULT_COMMENT_VIEW
  }
  if (!isRecord(data)) return DEFAULT_COMMENT_VIEW
  const status: CommentFilter = data.status === 'open' || data.status === 'resolved' || data.status === 'all'
    ? data.status
    : DEFAULT_COMMENT_VIEW.status
  const browsers = Array.isArray(data.browsers)
    ? data.browsers.filter((b): b is QaBrowserKey => isQaBrowserKey(b))
    : null
  const hiddenViewports = Array.isArray(data.hiddenViewports)
    ? data.hiddenViewports.filter((v): v is QaViewportKey => typeof v === 'string' && VIEWPORT_KEYS.includes(v))
    : []
  return {
    show: data.show !== false,
    status,
    browsers: browsers && browsers.length > 0 ? browsers : null,
    hiddenViewports,
  }
}

export function isDefaultCommentView(view: CommentView): boolean {
  return view.show && view.status === 'all' && view.browsers === null && view.hiddenViewports.length === 0
}

/** The browsers a view draws pins for: its own list, else the browser being tested. */
export function viewBrowsers(view: CommentView, activeBrowser: QaBrowserKey): QaBrowserKey[] {
  return view.browsers ?? [activeBrowser]
}

/**
 * Whether a comment gets a pin. A comment the user has selected stays visible whatever the
 * filters say, so picking or focusing one never makes it vanish. Only the master switch hides it.
 */
export function commentVisible(
  comment: Pick<QaComment, 'id' | 'status' | 'browser' | 'viewport'>,
  view: CommentView,
  activeBrowser: QaBrowserKey,
  keepId: string | null,
): boolean {
  if (!view.show) return false
  if (keepId !== null && comment.id === keepId) return true
  if (!matchesFilter(comment.status, view.status)) return false
  if (!viewBrowsers(view, activeBrowser).includes(comment.browser)) return false
  return !view.hiddenViewports.includes(comment.viewport)
}

/** Pins for one frame, from comments that already carry their server pin number. */
export function pinsForView(
  comments: NumberedComment[],
  viewport: QaViewportKey,
  view: CommentView,
  activeBrowser: QaBrowserKey,
  keepId: string | null,
): QaPin[] {
  return pinsFor(
    comments.filter(c => commentVisible(c, view, activeBrowser, keepId)),
    viewport,
  )
}

/** "Showing X of Y": comments that get a pin out of every comment on the page. */
export function commentViewCount(
  comments: readonly Pick<QaComment, 'id' | 'status' | 'browser' | 'viewport'>[],
  view: CommentView,
  activeBrowser: QaBrowserKey,
  keepId: string | null,
): { shown: number; total: number } {
  let shown = 0
  for (const c of comments) if (commentVisible(c, view, activeBrowser, keepId)) shown += 1
  return { shown, total: comments.length }
}

/** Adds or removes one browser from the view. Emptying the list goes back to the browser being tested. */
export function toggleViewBrowser(view: CommentView, browser: QaBrowserKey, activeBrowser: QaBrowserKey): CommentView {
  const current = viewBrowsers(view, activeBrowser)
  const next = current.includes(browser) ? current.filter(b => b !== browser) : [...current, browser]
  return { ...view, browsers: next.length > 0 ? next : null }
}

/** Shows or hides the pins of one viewport. */
export function toggleViewViewport(view: CommentView, viewport: QaViewportKey): CommentView {
  const hidden = view.hiddenViewports.includes(viewport)
    ? view.hiddenViewports.filter(v => v !== viewport)
    : [...view.hiddenViewports, viewport]
  return { ...view, hiddenViewports: hidden }
}

// Refresh versus local writes. Every local write (an edit, an added or removed note, a new comment)
// bumps a sequence number; a load remembers the number it started at and is dropped if it moved,
// so a slow response can never overwrite a newer local change.

/** True when a local write happened after the load started, so its response is out of date. */
export function isStaleLoad(startedAtSeq: number, currentSeq: number): boolean {
  return startedAtSeq !== currentSeq
}

/** A loaded list with the optimistic version of every comment whose write is still in flight. */
export function mergeLoadedComments(loaded: readonly QaComment[], inFlight: ReadonlyMap<string, QaComment>): QaComment[] {
  return loaded.map(c => inFlight.get(c.id) ?? c)
}
