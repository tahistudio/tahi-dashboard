import { describe, it, expect } from 'vitest'
import {
  formatCurrency,
  convertCurrency,
  formatDate,
  truncate,
  capitalise,
  snakeToTitle,
  getInitials,
  cn,
} from '../utils'

// ---------------------------------------------------------------------------
// formatCurrency
// ---------------------------------------------------------------------------
describe('formatCurrency', () => {
  it('formats USD by default', () => {
    const result = formatCurrency(1234.56)
    expect(result).toContain('1,234.56')
  })

  it('formats zero amount', () => {
    const result = formatCurrency(0)
    expect(result).toContain('0')
  })

  it('formats NZD with locale', () => {
    const result = formatCurrency(500, 'NZD', 'en-NZ')
    expect(result).toBeTruthy()
    // Should contain the amount
    expect(result).toContain('500')
  })

  it('formats EUR', () => {
    const result = formatCurrency(99.9, 'EUR', 'de-DE')
    expect(result).toBeTruthy()
  })

  it('omits trailing zeros for whole numbers', () => {
    const result = formatCurrency(100, 'USD')
    // minimumFractionDigits is 0, so whole numbers have no decimals
    expect(result).toContain('100')
    expect(result).not.toContain('.00')
  })

  it('handles negative amounts', () => {
    const result = formatCurrency(-50, 'USD')
    expect(result).toContain('50')
  })

  it('handles very large amounts', () => {
    const result = formatCurrency(1_000_000, 'USD')
    expect(result).toContain('1,000,000')
  })
})

// ---------------------------------------------------------------------------
// convertCurrency
// ---------------------------------------------------------------------------
describe('convertCurrency', () => {
  const rates: Record<string, number> = {
    NZD: 1.65,
    EUR: 0.92,
    GBP: 0.79,
  }

  it('returns USD amount unchanged when target is USD', () => {
    expect(convertCurrency(100, 'USD', rates)).toBe(100)
  })

  it('converts USD to NZD using rate', () => {
    expect(convertCurrency(100, 'NZD', rates)).toBe(165)
  })

  it('converts USD to EUR', () => {
    expect(convertCurrency(100, 'EUR', rates)).toBe(92)
  })

  it('returns USD amount when target currency rate is missing', () => {
    expect(convertCurrency(100, 'JPY', rates)).toBe(100)
  })

  it('handles zero amount', () => {
    expect(convertCurrency(0, 'NZD', rates)).toBe(0)
  })

  it('handles empty rates object', () => {
    expect(convertCurrency(100, 'NZD', {})).toBe(100)
  })

  it('handles negative amounts', () => {
    expect(convertCurrency(-50, 'NZD', rates)).toBe(-82.5)
  })
})

// ---------------------------------------------------------------------------
// formatDate
// ---------------------------------------------------------------------------
describe('formatDate', () => {
  // Use a fixed date string to avoid timezone flakiness
  const testDate = '2024-06-15T12:00:00Z'

  it('formats short date (default)', () => {
    const result = formatDate(testDate)
    expect(result).toBeTruthy()
    // Should contain year
    expect(result).toContain('2024')
  })

  it('formats long date', () => {
    const result = formatDate(testDate, 'long')
    expect(result).toBeTruthy()
    expect(result).toContain('2024')
    // Long format spells month out
    expect(result).toContain('June')
  })

  it('accepts a Date object', () => {
    const result = formatDate(new Date(testDate), 'short')
    expect(result).toBeTruthy()
    expect(result).toContain('2024')
  })

  it('shows relative time for recent dates', () => {
    const now = new Date()
    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString()
    const result = formatDate(fiveMinAgo, 'relative')
    expect(result).toContain('m ago')
  })

  it('shows "just now" for very recent dates', () => {
    const now = new Date()
    const justNow = new Date(now.getTime() - 10 * 1000).toISOString()
    const result = formatDate(justNow, 'relative')
    expect(result).toBe('just now')
  })

  it('shows hours ago for relative dates within a day', () => {
    const now = new Date()
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()
    const result = formatDate(twoHoursAgo, 'relative')
    expect(result).toContain('h ago')
  })

  it('shows days ago for relative dates within a week', () => {
    const now = new Date()
    const threeDaysAgo = new Date(now.getTime() - 3 * 86400 * 1000).toISOString()
    const result = formatDate(threeDaysAgo, 'relative')
    expect(result).toBe('3d ago')
  })

  it('falls through to short format for relative dates older than a week', () => {
    const now = new Date()
    const twoWeeksAgo = new Date(now.getTime() - 14 * 86400 * 1000).toISOString()
    const result = formatDate(twoWeeksAgo, 'relative')
    // Should fall through and return a short-format date string
    expect(result).not.toContain('ago')
    expect(result).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// truncate
// ---------------------------------------------------------------------------
describe('truncate', () => {
  it('returns text unchanged if within limit', () => {
    expect(truncate('hello', 10)).toBe('hello')
  })

  it('truncates text exceeding max length', () => {
    expect(truncate('hello world', 8)).toBe('hello...')
  })

  it('handles exact boundary', () => {
    expect(truncate('hello', 5)).toBe('hello')
  })
})

// ---------------------------------------------------------------------------
// capitalise
// ---------------------------------------------------------------------------
describe('capitalise', () => {
  it('capitalises first letter', () => {
    expect(capitalise('hello')).toBe('Hello')
  })

  it('handles single character', () => {
    expect(capitalise('a')).toBe('A')
  })

  it('handles already capitalised', () => {
    expect(capitalise('Hello')).toBe('Hello')
  })
})

// ---------------------------------------------------------------------------
// snakeToTitle
// ---------------------------------------------------------------------------
describe('snakeToTitle', () => {
  it('converts snake_case to Title Case', () => {
    expect(snakeToTitle('hello_world')).toBe('Hello World')
  })

  it('handles single word', () => {
    expect(snakeToTitle('hello')).toBe('Hello')
  })

  it('handles multiple underscores', () => {
    expect(snakeToTitle('in_progress_now')).toBe('In Progress Now')
  })
})

// ---------------------------------------------------------------------------
// getInitials
// ---------------------------------------------------------------------------
describe('getInitials', () => {
  it('gets initials from two words', () => {
    expect(getInitials('John Doe')).toBe('JD')
  })

  it('gets single initial from one word', () => {
    expect(getInitials('John')).toBe('J')
  })

  it('limits to two initials', () => {
    expect(getInitials('John Michael Doe')).toBe('JM')
  })
})

// ---------------------------------------------------------------------------
// cn (Tailwind class merge)
// ---------------------------------------------------------------------------
describe('cn', () => {
  it('merges classes', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })

  it('handles conditional classes', () => {
    expect(cn('base', false && 'hidden')).toBe('base')
  })

  it('handles undefined', () => {
    expect(cn('base', undefined)).toBe('base')
  })
})
