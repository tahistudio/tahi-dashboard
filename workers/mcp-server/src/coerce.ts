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

/** The slice of a tool's JSON Schema the coercion reads. */
export interface ArgSchema {
  properties?: Record<string, unknown>
}

function schemaType(def: unknown): unknown {
  return def && typeof def === 'object' ? (def as { type?: unknown }).type : undefined
}

/**
 * Normalise a tool call's arguments against the tool's own schema, once, at
 * the dispatch boundary. Booleans arrive as "true" or "false", numbers as
 * "12", arrays as one string; every dispatcher downstream still reads the
 * argument the way it always did (=== true, typeof === 'boolean', ?? false),
 * so fixing it here fixes every tool at once. A boolean that cannot be read
 * is removed rather than passed through as a truthy string, which is the
 * failure that made `rotate: "false"` rotate a share token. Other values pass
 * untouched.
 */
export function coerceArgs(schema: ArgSchema | undefined, args: Record<string, unknown>): Record<string, unknown> {
  const props = schema?.properties
  if (!props) return args
  const out: Record<string, unknown> = { ...args }
  for (const [key, def] of Object.entries(props)) {
    if (!(key in out) || out[key] === undefined || out[key] === null) continue
    const type = schemaType(def)
    const value = out[key]
    if (type === 'boolean') {
      const b = coerceBoolean(value)
      if (b === undefined) delete out[key]
      else out[key] = b
    } else if ((type === 'number' || type === 'integer') && typeof value === 'string') {
      const trimmed = value.trim()
      const n = trimmed === '' ? Number.NaN : Number(trimmed)
      if (Number.isFinite(n)) out[key] = n
    } else if (type === 'array' && typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed.startsWith('[')) {
        try {
          const parsed: unknown = JSON.parse(trimmed)
          if (Array.isArray(parsed)) out[key] = parsed
          continue
        } catch {
          // fall through to the split below
        }
      }
      out[key] = trimmed.split(/\r?\n|,/).map(p => p.trim()).filter(Boolean)
    }
  }
  return out
}
