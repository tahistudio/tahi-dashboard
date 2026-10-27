import { QA_VIEWPORTS, type QaScrollMessage, type QaScrollToMessage, type QaViewportKey } from '@/lib/qa/types'

/** Same cap the scanner applies to selectors it sends. */
const SELECTOR_MAX = 1000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFraction(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

/** Validates a qa:scroll message. Returns a cleaned copy or null when any field has the wrong type or range. */
export function parseScrollMessage(data: unknown): QaScrollMessage | null {
  if (!isRecord(data) || data.type !== 'qa:scroll' || data.version !== 1) return null
  const { url, anchor, ratio } = data
  if (typeof url !== 'string' || url.length === 0) return null
  if (!isFraction(ratio)) return null
  if (anchor === null) return { type: 'qa:scroll', version: 1, url, anchor: null, ratio }
  if (!isRecord(anchor)) return null
  const { selector, frac } = anchor
  if (typeof selector !== 'string' || selector.length === 0 || selector.length > SELECTOR_MAX) return null
  if (!isFraction(frac)) return null
  return { type: 'qa:scroll', version: 1, url, anchor: { selector, frac }, ratio }
}

/** The command that makes the other frames follow a reported scroll. */
export function scrollToFor(msg: QaScrollMessage): QaScrollToMessage {
  return { type: 'qa:scroll-to', anchor: msg.anchor, ratio: msg.ratio }
}

/** Frames that should follow a scroll: every visible frame except the sender. */
export function relayTargets(
  visible: ReadonlyArray<QaViewportKey>,
  sender: QaViewportKey,
): QaViewportKey[] {
  return QA_VIEWPORTS.map(v => v.key).filter(k => k !== sender && visible.includes(k))
}

export interface RelayQueue<T> {
  /** Remembers the newest report from a sender; it is relayed on the next frame. */
  push(sender: QaViewportKey, report: T): void
  /** Forgets everything pending and cancels the scheduled frame. */
  clear(): void
}

/**
 * Trailing coalescing: at most one relay per sender per animation frame, and the newest
 * report always wins, so followers end on the last position the user reached.
 */
export function createRelayQueue<T>(
  run: (sender: QaViewportKey, report: T) => void,
  schedule: (cb: () => void) => number,
  cancel: (id: number) => void,
): RelayQueue<T> {
  const pending = new Map<QaViewportKey, T>()
  let frameId: number | null = null
  function flush(): void {
    frameId = null
    const batch = Array.from(pending.entries())
    pending.clear()
    for (const [sender, report] of batch) run(sender, report)
  }
  return {
    push(sender, report) {
      pending.set(sender, report)
      if (frameId === null) frameId = schedule(flush)
    },
    clear() {
      pending.clear()
      if (frameId !== null) cancel(frameId)
      frameId = null
    },
  }
}

/** Synced scrolling only applies to the multi-frame layout with no frame expanded. */
export function syncActive(syncOn: boolean, singleFrame: boolean, expanded: QaViewportKey | null): boolean {
  return syncOn && !singleFrame && expanded === null
}
