import { describe, it, expect } from 'vitest'
import { CSV_BOM, csvCell, toCsv } from '../csv'

describe('csvCell', () => {
  it('quotes every field and doubles an inner quote', () => {
    expect(csvCell('Kowtow')).toBe('"Kowtow"')
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""')
    expect(csvCell('Comma, inside')).toBe('"Comma, inside"')
  })

  it('reads null and undefined as an empty field', () => {
    expect(csvCell(null)).toBe('""')
    expect(csvCell(undefined)).toBe('""')
    expect(csvCell('')).toBe('""')
  })

  it('neutralises a leading formula character on a string', () => {
    expect(csvCell('=Sum Studio')).toBe(`"'=Sum Studio"`)
    expect(csvCell('+64 21 000 000')).toBe(`"'+64 21 000 000"`)
    expect(csvCell('@handle')).toBe(`"'@handle"`)
    expect(csvCell('-Leading dash co')).toBe(`"'-Leading dash co"`)
  })

  it('leaves a number alone, negatives included', () => {
    expect(csvCell(4000)).toBe('"4000"')
    expect(csvCell(-250)).toBe('"-250"')
    expect(csvCell(0)).toBe('"0"')
  })

  it('does not touch a formula character anywhere but the front', () => {
    expect(csvCell('Tahi = Studio')).toBe('"Tahi = Studio"')
  })
})

describe('toCsv', () => {
  it('joins fields with commas and rows with CRLF', () => {
    const csv = toCsv([['Name', 'MRR'], ['Kowtow', 4000]])
    expect(csv).toBe('"Name","MRR"\r\n"Kowtow","4000"')
  })

  it('survives a macron without help, and the BOM is what Excel needs', () => {
    expect(toCsv([['Tāmaki']])).toBe('"Tāmaki"')
    expect(CSV_BOM).toBe('﻿')
    expect(CSV_BOM.length).toBe(1)
  })
})
