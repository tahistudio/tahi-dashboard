'use client'

/**
 * useFieldPredictions: the browser half of predictive autofill.
 *
 * It owns three things the dialogs did not have.
 *
 * A TOUCHED SET. Neither dialog tracked which fields the operator had settled,
 * which is why "if empty" barely applied: a category, a priority and a size
 * all carry defaults, so nothing was ever empty. Touched is the real question,
 * and everything that writes a field now says so: the operator on every
 * change, a template on apply, an AI draft on hand-off.
 *
 * ONE PRECEDENCE RULE, in one place. Operator beats template beats AI draft
 * beats prediction, enforced by a single refusal: `applySuggestions` will not
 * write a field that is in `touched`. There is nowhere else a suggestion can
 * enter the form, so there is nowhere else the rule can be forgotten.
 *
 * A LEASH. The call is debounced 700ms behind typing, runs immediately when
 * the category changes (a deliberate click, not a keystroke), never runs while
 * the AI panel is on screen, waits two seconds after a template or a draft
 * fills the form, and aborts the previous call on every new trigger and on
 * close. Nothing fires at all unless the local context gate passes, which is
 * the same rule the route runs before it spends anything.
 *
 * Two more strands on that leash, because a debounce alone only rate-limits a
 * question worth asking twice. An answer that fills NOTHING does not shrink
 * the field list, so an abstaining route was asked the identical question at
 * every pause for as long as somebody kept typing; it now buys a cooldown.
 * And the whole opening is capped, so no trigger bug can spend a studio-wide
 * daily budget on one dialog.
 *
 * INERT FOR CLIENTS. The New Request dialog is one component serving both
 * audiences, so `isAdmin` gates the hook itself rather than the fields it
 * fills: with it false there is no timer, no fetch and no state. A studio
 * median shown to a client reads as an SLA the studio has not agreed to.
 */

import * as React from 'react'
import { apiPath } from '@/lib/api'
import { suggestionAnnouncement } from '@/lib/predict/announce'
import { hasEnoughContext } from '@/lib/predict/context'
import type {
  PredictFieldsResponse,
  PredictSubject,
  PredictableField,
} from '@/lib/predict/types'

/** Long enough that a sentence being typed is one call, not twelve. */
const DEBOUNCE_MS = 700

/** How long a template apply or an AI draft holds the predictor off. */
const SETTLE_MS = 2000

/**
 * How long the predictor stands off after a pass that filled nothing.
 *
 * An empty answer is the normal case, and it does not shrink the field list:
 * `emptyFields` only stops asking about a field that RECEIVED a suggestion. So
 * a route that abstains, which is what a studio below the cohort floor answers
 * all day, was asked the identical question at every 700ms pause for as long
 * as somebody kept typing. Seven D1 statements and a ledger row each time.
 */
const EMPTY_ANSWER_COOLDOWN_MS = 20_000

/**
 * A hard ceiling on calls per opening of the dialog, whatever the typing does.
 *
 * The debounce is the leash and this is the collar: one bug in the trigger,
 * one control that rewrites its own value, and a studio-wide daily budget goes
 * in an afternoon. Nine is far more than a person filling one form can use.
 */
const MAX_RUNS_PER_OPENING = 9

/** A field's current value, in the shapes the two dialogs actually hold. */
export type FieldValue = string | number | null | undefined

export interface UseFieldPredictionsOptions {
  /** The dialog is open. False resets everything. */
  open: boolean
  /** False makes the hook completely inert: no timer, no fetch, no state. */
  isAdmin: boolean
  /** True while the AI panel is on screen. Keeps state, fires nothing. */
  paused?: boolean
  subject: PredictSubject
  title: string
  /** Plain text. The caller strips its own markup. */
  description?: string
  orgId?: string | null
  level?: string | null
  category?: string | null
  parentRequestId?: string | null
  /**
   * The fields this dialog will accept a suggestion for at all.
   *
   * Read through a ref at fire time, so a caller may hand a different list on
   * every render (a field whose control is not on screen for this client
   * belongs out of it) at no cost.
   */
  fields: readonly PredictableField[]
  /** Current values, read at fire time so a filled field is never asked for. */
  values: Partial<Record<PredictableField, FieldValue>>
  /**
   * The value each control OPENS on, in the same vocabulary as `values`.
   *
   * `values` reports a control still sitting on its default as null, because
   * an unanswered field is what a prediction is for. That makes the default
   * invisible here, and a model answering with the default itself would tint a
   * control that never moved, put a Suggested chip on it and offer to clear a
   * value nobody set. Naming the defaults lets that suggestion be dropped.
   */
  defaults?: Partial<Record<PredictableField, string | number>>
  /** Writes one suggested value into the form. Only ever called untouched. */
  apply: (field: PredictableField, value: string | number) => void
  /** Puts one field back to its empty state. */
  clear: (field: PredictableField) => void
}

export interface FieldPredictions {
  /** True while this field is showing a suggestion the operator has not touched. */
  isSuggested: (field: PredictableField) => boolean
  /** The one sentence under a suggested field. */
  reasonFor: (field: PredictableField) => string | undefined
  /** Any suggestion still on screen. Drives the "Clear suggestions" link. */
  hasAny: boolean
  /**
   * One sentence for a polite live region, or '' when there is nothing to say.
   *
   * Suggestions land in fields that are usually below the caret while somebody
   * is still typing a title, so without this a screen reader user is given no
   * signal at all that three controls just changed. One announcement per
   * batch, never one per field: three regions firing in the same tick read as
   * a stutter and the useful information is the list.
   */
  announcement: string
  /** The operator edited this field. Removes the suggestion, blocks re-filling. */
  markTouched: (field: PredictableField) => void
  /** A template or an AI draft wrote these. Same precedence effect, and it
   *  holds the predictor off for a moment so the two do not race. */
  markWritten: (fields: readonly PredictableField[]) => void
  /** Clear one suggestion. The field goes back to empty and stays untouched by
   *  the predictor: a value someone deliberately cleared is a decision. */
  clearField: (field: PredictableField) => void
  /** Clear every suggestion still showing. */
  clearAll: () => void
  /** Forget every decision without clearing a field. "Save + another" reuses
   *  the open dialog for a second item, which is a new item's worth of
   *  decisions, not a continuation of the last one's. */
  reset: () => void
}

function isEmptyValue(value: FieldValue): boolean {
  return value === null || value === undefined || value === ''
}

export function useFieldPredictions(options: UseFieldPredictionsOptions): FieldPredictions {
  const {
    open, isAdmin, paused = false,
    subject, title, description, orgId, level, category, parentRequestId,
    fields, values, defaults, apply, clear,
  } = options

  const [suggested, setSuggested] = React.useState<Partial<Record<PredictableField, string>>>({})
  const [announcement, setAnnouncement] = React.useState('')
  const suggestedRef = React.useRef(suggested)
  const touchedRef = React.useRef<Set<PredictableField>>(new Set())
  const valuesRef = React.useRef(values)
  const defaultsRef = React.useRef(defaults)
  const applyRef = React.useRef(apply)
  const clearRef = React.useRef(clear)
  const fieldsRef = React.useRef(fields)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = React.useRef<AbortController | null>(null)
  const settleUntilRef = React.useRef(0)
  const cooldownUntilRef = React.useRef(0)
  const runsRef = React.useRef(0)
  const clearedCategoryRef = React.useRef(false)
  const lastCategoryRef = React.useRef<string | null | undefined>(category)

  // Refs rather than effect deps: a value changing because the predictor just
  // wrote it must not schedule another prediction.
  valuesRef.current = values
  defaultsRef.current = defaults
  applyRef.current = apply
  clearRef.current = clear
  fieldsRef.current = fields
  suggestedRef.current = suggested

  const cancelInFlight = React.useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  /**
   * The fields worth asking about: offered by this dialog, untouched, still
   * empty, and not already carrying a suggestion.
   *
   * That last clause is what stops the loop. A suggested category re-triggers
   * the effect immediately, because a category change is a click rather than a
   * keystroke; without it, a model that suggested the value the field already
   * held would be asked the same question forever. One suggestion per field
   * per opening, and clearing one marks it touched, so there is no way back
   * round.
   */
  const emptyFields = React.useCallback((): PredictableField[] => {
    return fieldsRef.current.filter(f =>
      !touchedRef.current.has(f) &&
      !(f in suggestedRef.current) &&
      isEmptyValue(valuesRef.current[f]),
    )
  }, [])

  const run = React.useCallback(async () => {
    const empty = emptyFields()
    if (empty.length === 0) return
    if (!hasEnoughContext({ subject, title, orgId, level })) return
    if (runsRef.current >= MAX_RUNS_PER_OPENING) return
    if (Date.now() < cooldownUntilRef.current) return
    runsRef.current += 1

    const controller = new AbortController()
    abortRef.current = controller

    // Everything the operator has settled, told to the route as well, so the
    // precedence rule holds on both sides rather than only here. A field
    // someone deliberately CLEARED is settled too, and travels as `true`:
    // sending its empty value would read as unanswered at the far end.
    const filled: Record<string, unknown> = {}
    for (const field of fieldsRef.current) {
      const value = valuesRef.current[field]
      if (touchedRef.current.has(field) || !isEmptyValue(value)) {
        filled[field] = isEmptyValue(value) ? true : value
      }
    }

    try {
      const res = await fetch(apiPath('/api/admin/ai/predict-fields'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          subject,
          title,
          description: description ?? '',
          orgId: orgId ?? null,
          level: level ?? null,
          category: category ?? null,
          parentRequestId: parentRequestId ?? null,
          filled,
          empty,
          todayIso: new Date().toISOString().slice(0, 10),
        }),
      })
      if (!res.ok) return
      const data = await res.json() as PredictFieldsResponse
      if (controller.signal.aborted) return

      const landed: Partial<Record<PredictableField, string>> = {}
      for (const [key, suggestion] of Object.entries(data.suggestions ?? {})) {
        const field = key as PredictableField
        // THE precedence rule. Everything else in this file is plumbing.
        if (touchedRef.current.has(field)) continue
        if (!isEmptyValue(valuesRef.current[field])) continue
        if (!suggestion) continue
        // A suggestion equal to what the control already reads is not a
        // suggestion. Filing it would tint a field nobody moved, put a chip on
        // it and offer a Clear that changes nothing. The field is known empty
        // by the line above, so what it "already reads" is its default.
        const openedOn = defaultsRef.current?.[field]
        if (openedOn !== undefined && String(openedOn) === String(suggestion.value)) continue
        applyRef.current(field, suggestion.value)
        landed[field] = suggestion.reason
      }
      const landedFields = Object.keys(landed) as PredictableField[]
      if (landedFields.length > 0) {
        setSuggested(prev => ({ ...prev, ...landed }))
        setAnnouncement(suggestionAnnouncement(landedFields))
      } else {
        // Nothing landed, and the question will not have changed by the next
        // keystroke pause. Stand off rather than paying for the same answer.
        cooldownUntilRef.current = Date.now() + EMPTY_ANSWER_COOLDOWN_MS
      }
    } catch {
      // An aborted or failed prediction is a non-event. The form is already
      // usable, and a toast about a guess nobody asked for is noise.
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }, [emptyFields, subject, title, description, orgId, level, category, parentRequestId])

  // The trigger. Category is a click, so it re-runs at once; everything else is
  // typing, so it waits out the debounce. A settle window from a template or a
  // draft pushes the whole thing back rather than dropping it, or a draft would
  // be the one moment the form never gets a suggestion.
  React.useEffect(() => {
    if (!open || !isAdmin) return
    let categoryChanged = lastCategoryRef.current !== category
    lastCategoryRef.current = category
    // A category the operator CLEARED changed for a reason that is not a new
    // question. Without this, dismissing one suggestion bought an immediate,
    // undebounced pass asking about the fields the model just declined.
    if (categoryChanged && clearedCategoryRef.current) categoryChanged = false
    if (categoryChanged) clearedCategoryRef.current = false

    // Above the pause, not below it. An in-flight call issued a moment before
    // the AI panel opened used to keep running and land its values in a form
    // the operator can no longer see.
    cancelInFlight()
    if (paused) return

    const settleDelay = Math.max(0, settleUntilRef.current - Date.now())
    const cooldownDelay = Math.max(0, cooldownUntilRef.current - Date.now())
    const delay = Math.max(categoryChanged ? 0 : DEBOUNCE_MS, settleDelay, cooldownDelay)

    timerRef.current = setTimeout(() => {
      timerRef.current = null
      void run()
    }, delay)

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [open, isAdmin, paused, category, run, cancelInFlight])

  // Closing drops everything, including the touched set: the next opening is a
  // new item, and inheriting the last one's decisions would be a bug nobody
  // could see.
  React.useEffect(() => {
    if (open && isAdmin) return
    cancelInFlight()
    touchedRef.current = new Set()
    settleUntilRef.current = 0
    cooldownUntilRef.current = 0
    runsRef.current = 0
    clearedCategoryRef.current = false
    setSuggested(prev => (Object.keys(prev).length === 0 ? prev : {}))
    setAnnouncement(prev => (prev === '' ? prev : ''))
  }, [open, isAdmin, cancelInFlight])

  // Unmounting is the one exit the two effects above do not cover: a dialog
  // torn down mid-flight would leave a fetch running against nothing.
  React.useEffect(() => cancelInFlight, [cancelInFlight])

  const forget = React.useCallback((field: PredictableField) => {
    setSuggested(prev => {
      if (!(field in prev)) return prev
      const next = { ...prev }
      delete next[field]
      return next
    })
  }, [])

  const markTouched = React.useCallback((field: PredictableField) => {
    touchedRef.current.add(field)
    forget(field)
  }, [forget])

  const markWritten = React.useCallback((written: readonly PredictableField[]) => {
    for (const field of written) touchedRef.current.add(field)
    settleUntilRef.current = Date.now() + SETTLE_MS
    setSuggested(prev => {
      const next = { ...prev }
      let changed = false
      for (const field of written) {
        if (field in next) { delete next[field]; changed = true }
      }
      return changed ? next : prev
    })
  }, [])

  const clearField = React.useCallback((field: PredictableField) => {
    // Clearing the category puts it back on its default, which is a change to
    // the value this hook watches. Flagged so the trigger reads it as the
    // decision it is rather than as a fresh click worth an immediate re-run.
    if (field === 'category') clearedCategoryRef.current = true
    clearRef.current(field)
    markTouched(field)
    setAnnouncement('')
  }, [markTouched])

  // The writes happen outside the updater on purpose: React may run an updater
  // twice, and clearing a field twice is harmless but marking it touched twice
  // hides a real bug the day the body does something that is not idempotent.
  const clearAll = React.useCallback(() => {
    for (const key of Object.keys(suggestedRef.current) as PredictableField[]) {
      if (key === 'category') clearedCategoryRef.current = true
      clearRef.current(key)
      touchedRef.current.add(key)
    }
    setSuggested({})
    setAnnouncement('')
  }, [])

  const reset = React.useCallback(() => {
    cancelInFlight()
    touchedRef.current = new Set()
    settleUntilRef.current = 0
    cooldownUntilRef.current = 0
    runsRef.current = 0
    clearedCategoryRef.current = false
    setSuggested({})
    setAnnouncement('')
  }, [cancelInFlight])

  return {
    isSuggested: (field) => field in suggested,
    reasonFor: (field) => suggested[field],
    hasAny: Object.keys(suggested).length > 0,
    announcement,
    markTouched,
    markWritten,
    clearField,
    clearAll,
    reset,
  }
}
