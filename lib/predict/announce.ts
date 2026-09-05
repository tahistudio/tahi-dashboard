/**
 * lib/predict/announce.ts
 *
 * The one sentence a screen reader hears when suggestions land.
 *
 * Predictive autofill writes into fields that are usually below the caret: an
 * operator typing a title gets a due date, a priority and an estimate filled
 * several rows down. Sighted operators catch that in peripheral vision. With
 * no live region, a screen reader user gets nothing at all, which is the WCAG
 * 4.1.3 status-message case: a change of state nobody asked for, reported by
 * the software rather than discovered by hand.
 *
 * ONE announcement per batch, never one per field. Three polite regions firing
 * in the same tick queue behind each other and read as a stutter, and the
 * useful information is the list, not the individual arrivals.
 *
 * Pure and framework-free so the wording is testable without a DOM.
 */

import { PREDICTABLE_FIELDS, type PredictableField } from './types'

/**
 * How each field is named out loud. The same words the Suggested chip's Clear
 * button uses, so the announcement and the control agree.
 */
export const FIELD_LABELS: Record<PredictableField, string> = {
  dueDate: 'due date',
  priority: 'priority',
  estimatedHours: 'estimated hours',
  category: 'category',
  size: 'size',
  assigneeId: 'assignee',
}

/** "a, b and c", which is how a person reads a list out loud. */
function listOut(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/**
 * What to put in the polite live region for the batch that just landed.
 *
 * Empty for an empty batch, so a dialog can render the region unconditionally
 * and say nothing until there is something to say. Fields are named in the
 * canonical order rather than the order the model happened to answer in, so
 * two identical batches never read differently.
 */
export function suggestionAnnouncement(fields: readonly PredictableField[]): string {
  const unique = PREDICTABLE_FIELDS.filter(f => fields.includes(f))
  if (unique.length === 0) return ''
  const names = listOut(unique.map(f => FIELD_LABELS[f]))
  const count = unique.length === 1
    ? '1 field'
    : `${unique.length} fields`
  const tail = unique.length === 1
    ? 'It is marked Suggested and can be cleared.'
    : 'Each is marked Suggested and can be cleared.'
  return `Filled ${count} from this client's recent work: ${names}. ${tail}`
}
