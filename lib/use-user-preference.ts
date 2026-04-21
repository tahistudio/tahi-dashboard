/**
 * useUserPreference \u2014 drop-in replacement for `useState` that persists
 * the value to localStorage so the user's choice survives a refresh.
 *
 * Keyed by a stable string like `"pipeline.viewMode"` or
 * `"tasks.typeTab"`. The hook is SSR-safe: on the server (and the very
 * first client render) it returns the `defaultValue`, then hydrates to
 * the stored value inside a `useEffect`. That's a one-frame flash by
 * design; for toggles this is imperceptible.
 *
 * Usage:
 *
 *   const [view, setView] = useUserPreference<'kanban' | 'list'>(
 *     'pipeline.viewMode', 'kanban',
 *   )
 *
 *   const [tab, setTab] = useUserPreference('tasks.typeTab', 'all')
 *
 * A `validator` (optional) can gate the stored value: useful when the set
 * of valid values is closed (e.g. a tab enum). If the stored value fails
 * the validator we fall back to the default and quietly clear the stored
 * key.
 *
 * All keys are namespaced under the `tahi-pref:` prefix so they don't
 * collide with anything else in localStorage (currency preference, theme,
 * etc.).
 */

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

const STORAGE_PREFIX = 'tahi-pref:'

function storageKey(key: string): string {
  return `${STORAGE_PREFIX}${key}`
}

function safeRead<T>(key: string, defaultValue: T, validator?: (v: unknown) => v is T): T {
  if (typeof window === 'undefined') return defaultValue
  try {
    const raw = window.localStorage.getItem(storageKey(key))
    if (raw === null) return defaultValue
    const parsed: unknown = JSON.parse(raw)
    if (validator && !validator(parsed)) {
      // Corrupt or out-of-set value \u2014 clear it and fall back.
      try { window.localStorage.removeItem(storageKey(key)) } catch { /* noop */ }
      return defaultValue
    }
    return parsed as T
  } catch {
    return defaultValue
  }
}

function safeWrite<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey(key), JSON.stringify(value))
  } catch {
    // Private-mode / quota errors: skip, preference just won't persist.
  }
}

export interface UseUserPreferenceOptions<T> {
  /** Gate what shapes can be read back from storage. If the stored value
   *  doesn't pass, we fall back to the default AND clear the bad key. */
  validator?: (v: unknown) => v is T
}

export function useUserPreference<T>(
  key: string,
  defaultValue: T,
  options: UseUserPreferenceOptions<T> = {},
): [T, (next: T) => void] {
  const { validator } = options
  // SSR + first-client-render: start with default. We'll upgrade after mount.
  const [value, setValue] = useState<T>(defaultValue)
  // Track whether we've hydrated so we don't re-write the default to storage
  // on the first mount (that would overwrite a valid stored value in the
  // unlikely case of a race).
  const hydrated = useRef(false)

  useEffect(() => {
    const stored = safeRead(key, defaultValue, validator)
    if (stored !== value) setValue(stored)
    hydrated.current = true
    // Intentionally only run on mount. Changing `key` at runtime isn't a
    // supported use case; callers pass a literal string.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const set = useCallback((next: T) => {
    setValue(next)
    safeWrite(key, next)
    hydrated.current = true
  }, [key])

  return [value, set]
}

/** Helper: build a typed validator from a closed list of allowed values.
 *  Useful for tab-style preferences where only a handful of strings are valid. */
export function oneOf<T extends string>(allowed: readonly T[]): (v: unknown) => v is T {
  return (v: unknown): v is T => typeof v === 'string' && (allowed as readonly string[]).includes(v)
}
