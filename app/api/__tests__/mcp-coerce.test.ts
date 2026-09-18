import { describe, expect, it } from 'vitest'
import { coerceArgs, coerceBoolean, coerceSubtasks } from '../../../workers/mcp-server/src/coerce'

describe('coerceBoolean (MCP argument coercion)', () => {
  it('passes real booleans through', () => {
    expect(coerceBoolean(true)).toBe(true)
    expect(coerceBoolean(false)).toBe(false)
  })

  it('reads the strings connectors send', () => {
    expect(coerceBoolean('true')).toBe(true)
    expect(coerceBoolean('TRUE')).toBe(true)
    expect(coerceBoolean(' yes ')).toBe(true)
    expect(coerceBoolean('1')).toBe(true)
    expect(coerceBoolean('false')).toBe(false)
    expect(coerceBoolean('no')).toBe(false)
    expect(coerceBoolean('0')).toBe(false)
  })

  it('reads 1 and 0', () => {
    expect(coerceBoolean(1)).toBe(true)
    expect(coerceBoolean(0)).toBe(false)
  })

  it('refuses anything else', () => {
    expect(coerceBoolean(undefined)).toBeUndefined()
    expect(coerceBoolean(null)).toBeUndefined()
    expect(coerceBoolean('maybe')).toBeUndefined()
    expect(coerceBoolean(2)).toBeUndefined()
    expect(coerceBoolean({})).toBeUndefined()
  })
})

describe('coerceSubtasks (MCP argument coercion)', () => {
  it('keeps an array of strings, trimmed, without empties', () => {
    expect(coerceSubtasks([' Draft copy ', '', 'Review'])).toEqual(['Draft copy', 'Review'])
  })

  it('accepts objects carrying a title', () => {
    expect(coerceSubtasks([{ title: 'One' }, { title: ' Two ' }, { name: 'ignored' }])).toEqual(['One', 'Two'])
  })

  it('splits a single string on newlines or commas', () => {
    expect(coerceSubtasks('One\nTwo, Three\r\n')).toEqual(['One', 'Two', 'Three'])
  })

  it('returns undefined when nothing usable was sent', () => {
    expect(coerceSubtasks(undefined)).toBeUndefined()
    expect(coerceSubtasks([])).toBeUndefined()
    expect(coerceSubtasks('')).toBeUndefined()
    expect(coerceSubtasks(42)).toBeUndefined()
  })
})

describe('coerceArgs (schema-driven, at the dispatch boundary)', () => {
  const schema = {
    properties: {
      rotate: { type: 'boolean' },
      dryRun: { type: 'boolean' },
      limit: { type: 'number' },
      hours: { type: 'number' },
      subtasks: { type: 'array', items: { type: 'string' } },
      title: { type: 'string' },
    },
  }

  it('turns stringy booleans into real ones, both ways', () => {
    const out = coerceArgs(schema, { rotate: 'false', dryRun: 'true', title: 'x' })
    expect(out.rotate).toBe(false)
    expect(out.dryRun).toBe(true)
    expect(out.title).toBe('x')
  })

  it('drops a boolean it cannot read instead of passing a truthy string', () => {
    const out = coerceArgs(schema, { rotate: 'maybe' })
    expect('rotate' in out).toBe(false)
  })

  it('turns numeric strings into numbers and leaves the rest', () => {
    const out = coerceArgs(schema, { limit: '12', hours: '1.5', title: '7' })
    expect(out.limit).toBe(12)
    expect(out.hours).toBe(1.5)
    expect(out.title).toBe('7')
  })

  it('turns a string array argument into a list, JSON or separated', () => {
    expect(coerceArgs(schema, { subtasks: '["One","Two"]' }).subtasks).toEqual(['One', 'Two'])
    expect(coerceArgs(schema, { subtasks: 'One\nTwo, Three' }).subtasks).toEqual(['One', 'Two', 'Three'])
  })

  it('leaves real values and unknown keys alone, and never mutates the input', () => {
    const input = { rotate: true, limit: 3, subtasks: ['a'], extra: 'kept' }
    const out = coerceArgs(schema, input)
    expect(out).toEqual(input)
    expect(out).not.toBe(input)
    expect(coerceArgs(undefined, input)).toBe(input)
  })
})
