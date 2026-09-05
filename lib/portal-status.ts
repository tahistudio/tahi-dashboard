/**
 * lib/portal-status.ts - the ONE request-status vocabulary a client sees.
 *
 * The portal used to speak two languages one click apart: the client home
 * translated statuses into its own words (Queued / In build / Review) while the
 * requests list and the request detail printed the studio's raw labels
 * (Submitted / In Progress / Client Review). Same request, two names.
 *
 * This module is the single dictionary for the client audience. It keeps the
 * HOUSE words (so a client and the studio say the same thing on a call) and
 * adds a plain-English gloss per status for the places that have room for one
 * (the badge title, a spine step, a board column caption).
 *
 * Colour is NOT redefined here: every tone resolves through
 * REQUEST_STATUS_CONFIG, which is token-based and carries verified dark-mode
 * overrides, so a portal badge and a studio badge for the same status are the
 * same colour in both themes.
 *
 * Usage:
 *   import { portalStatusMeta, portalStatusLabel } from '@/lib/portal-status'
 *   const meta = portalStatusMeta(request.status)   // label + gloss + colours
 */

import { REQUEST_STATUS_CONFIG, type StatusStyle } from '@/lib/status-config'

/** Chip tone used by the `.ov-chip` grammar on the client home. */
export type PortalChipTone = 'brand' | 'info' | 'warn' | 'muted' | 'rose'

export interface PortalStatusMeta extends StatusStyle {
  /** The stored status slug. */
  key: string
  /** What the client is told, in the studio's own words. */
  label: string
  /** One plain line saying what that word means for them. */
  gloss: string
  /** `.ov-chip` tone for the client home rows. */
  chip: PortalChipTone
}

interface PortalWords {
  label: string
  gloss: string
  chip: PortalChipTone
}

/**
 * The words. Labels are sentence case (the client reads prose, not a database
 * enum) but they are the SAME words the studio uses, deliberately: nobody has
 * to translate "In build" into "In progress" on a call.
 */
const PORTAL_WORDS: Record<string, PortalWords> = {
  draft: { label: 'Draft', gloss: 'Not sent to us yet', chip: 'muted' },
  submitted: { label: 'Submitted', gloss: 'In your queue', chip: 'muted' },
  in_review: { label: 'In review', gloss: 'We are scoping it', chip: 'warn' },
  in_progress: { label: 'In progress', gloss: 'Building now', chip: 'info' },
  client_review: { label: 'Client review', gloss: 'With you to approve', chip: 'warn' },
  on_hold: { label: 'On hold', gloss: 'Paused, off the tracks for now', chip: 'muted' },
  delivered: { label: 'Delivered', gloss: 'Done', chip: 'brand' },
  completed: { label: 'Completed', gloss: 'Signed off and closed', chip: 'brand' },
  cancelled: { label: 'Cancelled', gloss: 'Closed, not built', chip: 'rose' },
  archived: { label: 'Archived', gloss: 'Filed away', chip: 'muted' },
}

/** The five steps a request actually walks, in order. */
export const PORTAL_PIPELINE: readonly string[] = [
  'submitted',
  'in_review',
  'in_progress',
  'client_review',
  'delivered',
]

/** Statuses that are still live work from the client's point of view. */
export const PORTAL_OPEN_STATUSES: readonly string[] = [
  'submitted',
  'in_review',
  'in_progress',
  'client_review',
  'on_hold',
]

const FALLBACK_STYLE: StatusStyle = REQUEST_STATUS_CONFIG.submitted

/**
 * Everything the client UI needs to render one status: the word, the gloss and
 * the four colour tokens. Unknown slugs degrade to a de-underscored label on
 * the neutral submitted tokens rather than throwing or rendering nothing.
 */
export function portalStatusMeta(status: string | null | undefined): PortalStatusMeta {
  const key = (status ?? '').trim()
  const words = PORTAL_WORDS[key]
  const style = REQUEST_STATUS_CONFIG[key] ?? FALLBACK_STYLE
  if (!words) {
    return {
      key,
      label: key ? key.replace(/_/g, ' ') : 'Unknown',
      gloss: '',
      chip: 'muted',
      dot: style.dot,
      bg: style.bg,
      text: style.text,
      border: style.border,
    }
  }
  return {
    key,
    label: words.label,
    gloss: words.gloss,
    chip: words.chip,
    dot: style.dot,
    bg: style.bg,
    text: style.text,
    border: style.border,
  }
}

/** Just the word. */
export function portalStatusLabel(status: string | null | undefined): string {
  return portalStatusMeta(status).label
}

/** Just the plain-English line (empty string when a status has no gloss). */
export function portalStatusGloss(status: string | null | undefined): string {
  return portalStatusMeta(status).gloss
}

/**
 * "Client review - with you to approve". The one string for a title attribute
 * or an aria-label, so the gloss reaches a screen reader even where the visual
 * chip has no room for it.
 */
export function portalStatusTitle(status: string | null | undefined): string {
  const meta = portalStatusMeta(status)
  return meta.gloss ? `${meta.label}. ${meta.gloss}.` : meta.label
}

/**
 * Deterministic pipeline position (0..1) from the stored status. Used only to
 * draw a track meter: it visualises where a request sits on the pipeline, it is
 * not a tracked percentage of work done, and the caption beside it always says
 * the status word rather than a number.
 */
const STAGE_FRACTION: Record<string, number> = {
  draft: 0,
  submitted: 0.12,
  in_review: 0.3,
  on_hold: 0.45,
  in_progress: 0.62,
  client_review: 0.88,
  delivered: 1,
  completed: 1,
}

export function portalStageFraction(status: string | null | undefined): number {
  return STAGE_FRACTION[(status ?? '').trim()] ?? 0.2
}
