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
 * INERT FOR CLIENTS. The New Request dialog is one component serving both
 * audiences, so `isAdmin` gates the hook itself rather than the fields it
 * fills: with it false there is no timer, no fetch and no state. A studio
 * median shown to a client reads as an SLA the studio has not agreed to.
 */

import * as React from 'react'
import { apiPath } from '@/lib/api'
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
  /** The fields this dialog will accept a suggestion for at all. */
  fields: readonly PredictableField[]
  /** Current values, read at fire time so a filled field is never asked for. */
  values: Partial<Record<PredictableField, FieldValue>>
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
    fields, values, apply, clear,
  } = options

  const [suggested, setSuggested] = React.useState<Partial<Record<PredictableField, string>>>({})
  const suggestedRef = React.useRef(suggested)
  const touchedRef = React.useRef<Set<PredictableField>>(new Set())
  const valuesRef = React.useRef(values)
  const applyRef = React.useRef(apply)
  const clearRef = React.useRef(clear)
  const fieldsRef = React.useRef(fields)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = React.useRef<AbortController | null>(null)
  const settleUntilRef = React.useRef(0)
  const lastCategoryRef = React.useRef<string | null | undefined>(category)

  // Refs rather than effect deps: a value changing because the predictor just
  // wrote it must not schedule another prediction.
  valuesRef.current = values
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
        applyRef.current(field, suggestion.value)
        landed[field] = suggestion.reason
      }
      if (Object.keys(landed).length > 0) {
        setSuggested(prev => ({ ...prev, ...landed }))
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
    const categoryChanged = lastCategoryRef.current !== category
    lastCategoryRef.current = category
    if (paused) return

    const settleDelay = Math.max(0, settleUntilRef.current - Date.now())
    const delay = Math.max(categoryChanged ? 0 : DEBOUNCE_MS, settleDelay)

    cancelInFlight()
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
    setSuggested(prev => (Object.keys(prev).length === 0 ? prev : {}))
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
    clearRef.current(field)
    markTouched(field)
  }, [markTouched])

  // The writes happen outside the updater on purpose: React may run an updater
  // twice, and clearing a field twice is harmless but marking it touched twice
  // hides a real bug the day the body does something that is not idempotent.
  const clearAll = React.useCallback(() => {
    for (const key of Object.keys(suggestedRef.current) as PredictableField[]) {
      clearRef.current(key)
      touchedRef.current.add(key)
    }
    setSuggested({})
  }, [])

  const reset = React.useCallback(() => {
    cancelInFlight()
    touchedRef.current = new Set()
    settleUntilRef.current = 0
    setSuggested({})
  }, [cancelInFlight])

  return {
    isSuggested: (field) => field in suggested,
    reasonFor: (field) => suggested[field],
    hasAny: Object.keys(suggested).length > 0,
    markTouched,
    markWritten,
    clearField,
    clearAll,
    reset,
  }
}
