/**
 * lib/call-brief-item.ts
 *
 * Pure formatter for the studio home daily brief's "today's call" row
 * (app/api/admin/overview/brief/route.ts, the urgent section gated on
 * canSeeCalls). Split out so the empty-vs-present copy and the deep link
 * it builds can be unit tested without a fake D1.
 *
 * Before prep_note existed, this row was derived from scope_notes / summary
 * (both post-call fields), which is why Liam could see "no prep note yet"
 * with no way to actually write one. It now reads discoveryCalls.prepNote
 * directly and always links to the field itself, present or not.
 */
import { callPrepFocusTarget } from './call-deep-link'

export interface CallPrepBriefRow {
  tone: 'warn'
  verb: string
  to: string
  text: string
}

const PREVIEW_CHARS = 80

/** First `PREVIEW_CHARS` characters of `note`, with a trailing ellipsis
 *  only when it was actually cut short. */
function previewOf(note: string): string {
  return note.length > PREVIEW_CHARS ? `${note.slice(0, PREVIEW_CHARS)}...` : note
}

/**
 * Build the daily brief row for one of today's calls. `timeLabel` is the
 * already-formatted, zone-aware time string (e.g. "9:30 am") the caller
 * derives once per row; this function only owns the copy + verb + link.
 */
export function formatCallPrepBriefRow(
  call: { id: string; title: string; prepNote: string | null },
  timeLabel: string,
): CallPrepBriefRow {
  const note = call.prepNote?.trim() ?? ''
  const hasPrep = note.length > 0
  return {
    tone: 'warn',
    verb: hasPrep ? 'Edit prep note' : 'Prep note',
    to: callPrepFocusTarget(call.id),
    text: hasPrep
      ? `${call.title} · ${timeLabel}: ${previewOf(note)}`
      : `${call.title} · ${timeLabel}: no prep note yet`,
  }
}
