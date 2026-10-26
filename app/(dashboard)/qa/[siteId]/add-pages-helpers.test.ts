import { describe, expect, it } from 'vitest'
import {
  PAGE_PATH_LIMIT,
  countNonEmptyLines,
  isHttpsUrl,
  isPathListWithinLimit,
  parseMaxPages,
  parsePathList,
} from './add-pages-helpers'

describe('parsePathList', () => {
  it('trims, drops blanks and removes duplicates keeping the first occurrence', () => {
    const text = '  /about \n\n/services\r\n/about\n   \n/contact'
    expect(parsePathList(text)).toEqual(['/about', '/services', '/contact'])
  })

  it('keeps full URLs as typed', () => {
    expect(parsePathList('https://www.example.com/a\n/b')).toEqual(['https://www.example.com/a', '/b'])
  })

  it('returns an empty list for blank input', () => {
    expect(parsePathList('  \n\n ')).toEqual([])
  })
})

describe('countNonEmptyLines', () => {
  it('counts non-empty lines after trimming', () => {
    expect(countNonEmptyLines('/a\n\n  \n/b\n/a')).toBe(3)
  })
})

describe('isPathListWithinLimit', () => {
  it('accepts 1 to the limit and rejects 0 or over the limit', () => {
    expect(isPathListWithinLimit([])).toBe(false)
    expect(isPathListWithinLimit(['/a'])).toBe(true)
    expect(isPathListWithinLimit(Array.from({ length: PAGE_PATH_LIMIT }, (_, i) => `/p${i}`))).toBe(true)
    expect(isPathListWithinLimit(Array.from({ length: PAGE_PATH_LIMIT + 1 }, (_, i) => `/p${i}`))).toBe(false)
  })
})

describe('parseMaxPages', () => {
  it('accepts whole numbers from 1 to 150', () => {
    expect(parseMaxPages('1')).toBe(1)
    expect(parseMaxPages(' 100 ')).toBe(100)
    expect(parseMaxPages('150')).toBe(150)
  })

  it('rejects zero, over 150, decimals, negatives and text', () => {
    expect(parseMaxPages('0')).toBeNull()
    expect(parseMaxPages('151')).toBeNull()
    expect(parseMaxPages('2.5')).toBeNull()
    expect(parseMaxPages('-3')).toBeNull()
    expect(parseMaxPages('abc')).toBeNull()
    expect(parseMaxPages('')).toBeNull()
  })
})

describe('isHttpsUrl', () => {
  it('accepts absolute https URLs only', () => {
    expect(isHttpsUrl('https://www.example.com/sitemap.xml')).toBe(true)
    expect(isHttpsUrl('http://www.example.com/sitemap.xml')).toBe(false)
    expect(isHttpsUrl('/sitemap.xml')).toBe(false)
    expect(isHttpsUrl('not a url')).toBe(false)
  })
})
