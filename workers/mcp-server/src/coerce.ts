/**
 * Argument coercion for MCP tool calls.
 *
 * Connectors do not all send JSON Schema types faithfully: a boolean arrives
 * as the string "true", a list of subtask titles arrives as one newline
 * separated string, or as objects with a title. The dashboard routes are
 * strict on purpose (a PATCH with a non boolean isCompleted is a 400), so the
 * worker normalises here, once, before proxying.
 */

/** true, false, or undefined when the value cannot be read as a boolean. */
export function coerceBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (value === 1) return true
    if (value === 0) return false
    return undefined
  }
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase()
    if (v === 'true' || v === 'yes' || v === '1' || v === 'on') return true
    if (v === 'false' || v === 'no' || v === '0' || v === 'off') return false
  }
  return undefined
}

/**
 * Subtask titles from whatever shape the caller sent: an array of strings, an
 * array of objects carrying a title, or a single string split on newlines or
 * commas. Empty titles are dropped. Returns undefined when nothing usable was
 * passed so the caller can leave the key off the request body.
 */
export function coerceSubtasks(value: unknown): string[] | undefined {
  const titles: string[] = []
  const push = (t: unknown) => {
    if (typeof t === 'string') {
      const trimmed = t.trim()
      if (trimmed) titles.push(trimmed)
    } else if (t && typeof t === 'object' && typeof (t as { title?: unknown }).title === 'string') {
      const trimmed = ((t as { title: string }).title).trim()
      if (trimmed) titles.push(trimmed)
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) push(item)
  } else if (typeof value === 'string') {
    for (const part of value.split(/\r?\n|,/)) push(part)
  } else if (value && typeof value === 'object') {
    push(value)
  }
  return titles.length ? titles : undefined
}
