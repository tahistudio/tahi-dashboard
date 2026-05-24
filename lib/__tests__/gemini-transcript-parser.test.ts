/**
 * Tests for the Gemini transcript doc parser.
 *
 * Gemini's "Notes" docs follow a stable two-section format
 * (# Notes / # Transcript) with predictable subsections. These
 * tests pin the regex behaviour against representative samples so
 * Google's format changes get caught fast.
 */

import { describe, it, expect } from 'vitest'
import { parseGeminiTitle, parseGeminiTranscript } from '../gemini-transcript-parser'

describe('parseGeminiTitle', () => {
  it('extracts short title and attendee from standard format', () => {
    const r = parseGeminiTitle('Meeting (Tim Lyons) - 2026/05/22 20:41 NZST - Notes by Gemini')
    expect(r.shortTitle).toBe('Meeting (Tim Lyons)')
    expect(r.attendeeGuess).toBe('Tim Lyons')
    expect(r.scheduledAt).toMatch(/^2026-05-22T08:41:00\.000Z$/)  // NZST = +12, so 20:41 NZ = 08:41 UTC
  })

  it('handles multi-word meeting names', () => {
    const r = parseGeminiTitle('Giant x Tahi Weekly - 2026/05/22 07:59 NZST - Notes by Gemini')
    expect(r.shortTitle).toBe('Giant x Tahi Weekly')
    expect(r.attendeeGuess).toBeNull()
    expect(r.scheduledAt).toBeTruthy()
  })

  it('returns nulls for non-matching titles', () => {
    const r = parseGeminiTitle('Random doc name without the format')
    expect(r.shortTitle).toBeNull()
    expect(r.attendeeGuess).toBeNull()
    expect(r.scheduledAt).toBeNull()
  })

  it('handles unknown timezones gracefully (scheduledAt = null)', () => {
    const r = parseGeminiTitle('Meeting (X) - 2026/05/22 10:00 XYZ - Notes by Gemini')
    expect(r.shortTitle).toBe('Meeting (X)')
    expect(r.attendeeGuess).toBe('X')
    expect(r.scheduledAt).toBeNull()
  })
})

describe('parseGeminiTranscript', () => {
  const sample = `# 📝 Notes

May 22, 2026

## Meeting (Tim Lyons)

Invited <tim.lyons00@gmail.com> [Liam from Tahi Studio](mailto:business@tahi.studio)

Attachments [Meeting (Tim Lyons)](https://calendar.google.com/...)

Meeting records [Transcript](https://docs.google.com/...)

### Summary

This is a summary paragraph.

**Topic Heading**
More summary text.

*Rate this Summary:* [Helpful](https://...) or [Not Helpful](https://...)

### Next steps

  - \\[Liam from Tahi Studio\\] Share URLs: Provide all relevant web addresses.
  - \\[Tim Lyons\\] Test URL Tracking: Verify all UTM and session data.
  - \\[Tim Lyons\\] Confirm Tracking Success: Send a message via LinkedIn.

### Details

  - **Internet Connection Issues**: Discussed connectivity ([00:01:08](https://...)).
  - **Elevate Client Updates**: Tim provided an update on Elevate ([00:05:29](https://...)).

# 📝 Transcript

May 22, 2026

## Meeting (Tim Lyons) - Transcript

### 00:01:08

**Liam from Tahi Studio:** to summarize this.

**Tim Lyons:** Afternoon mate.

### 00:04:42

**Tim Lyons:** That's why I've got that.

### Transcription ended after 00:31:47

*This editable transcript was computer generated and might contain errors.*
`

  it('extracts summary minus the rating trailer', () => {
    const r = parseGeminiTranscript(sample)
    expect(r.summary).toBeTruthy()
    expect(r.summary).toContain('This is a summary paragraph.')
    expect(r.summary).toContain('Topic Heading')
    expect(r.summary).not.toContain('Rate this Summary')
  })

  it('extracts next-steps bullets with owner unescaped', () => {
    const r = parseGeminiTranscript(sample)
    expect(r.nextSteps).toHaveLength(3)
    expect(r.nextSteps[0]).toContain('[Liam from Tahi Studio]')
    expect(r.nextSteps[0]).toContain('Share URLs')
    expect(r.nextSteps[1]).toContain('Test URL Tracking')
  })

  it('extracts details bullets', () => {
    const r = parseGeminiTranscript(sample)
    expect(r.details).toHaveLength(2)
    expect(r.details[0]).toContain('Internet Connection Issues')
    expect(r.details[1]).toContain('Elevate Client Updates')
  })

  it('extracts the transcript portion', () => {
    const r = parseGeminiTranscript(sample)
    expect(r.transcript).toBeTruthy()
    expect(r.transcript).toContain('to summarize this.')
    expect(r.transcript).toContain('Transcription ended after')
    expect(r.transcript).not.toContain('This editable transcript was computer generated')
  })

  it('extracts invited emails', () => {
    const r = parseGeminiTranscript(sample)
    expect(r.invitedEmails).toContain('tim.lyons00@gmail.com')
    expect(r.invitedEmails).toContain('business@tahi.studio')
  })

  it('extracts duration', () => {
    const r = parseGeminiTranscript(sample)
    expect(r.durationFormatted).toBe('00:31:47')
  })

  it('handles docs with no transcript half', () => {
    const notesOnly = `# 📝 Notes\n\n## Some meeting\n\n### Summary\n\nShort summary.\n\n### Next steps\n\n  - Do thing.\n`
    const r = parseGeminiTranscript(notesOnly)
    expect(r.summary).toBe('Short summary.')
    expect(r.nextSteps).toEqual(['Do thing.'])
    expect(r.transcript).toBeNull()
  })

  it('returns null fields for empty input', () => {
    const r = parseGeminiTranscript('')
    expect(r.summary).toBeNull()
    expect(r.nextSteps).toEqual([])
    expect(r.transcript).toBeNull()
  })
})
