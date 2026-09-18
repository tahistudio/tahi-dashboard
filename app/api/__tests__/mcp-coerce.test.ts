import { describe, expect, it } from 'vitest'
import { coerceBoolean, coerceSubtasks } from '../../../workers/mcp-server/src/coerce'

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
