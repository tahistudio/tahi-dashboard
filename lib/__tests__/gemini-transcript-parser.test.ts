/**
 * Tests for the Gemini transcript doc parser.
 *
 * Gemini's "Notes" docs follow a stable two-section format
 * (# Notes / # Transcript) with predictable subsections. These
 * tests pin the regex behaviour against representative samples so
 * Google's format changes get caught fast.
 */

import { describe, it, expect } from 'vitest'
import { describeUnparsedDoc, parseGeminiTitle, parseGeminiTranscript } from '../gemini-transcript-parser'

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

describe('parseGeminiTranscript, plain-text export', () => {
  // The shape of a text export as of 2026-09: a Quick notes block with its
  // own next steps and survey lines, then the Full notes block, then the
  // transcript behind an emoji heading.
  const plain = [
    '\u270D\uFE0F Quick notes',
    'Please rate the new Quick notes tab by taking a short survey.',
    'Meeting (Bharat Kochar)',
    'Sep 16, 2026',
    'bharat@example.com Liam from Tahi Studio',
    'Meeting covered the booking flow and the season timeline.',
    'Next steps',
    '* Liam to send a proposal.',
    'Want to see more? View the full notes',
    'Tip: You can always access your full notes from the left sidebar.',
    '\uD83D\uDCDD Full notes',
    'Meeting (Bharat Kochar)',
    'Sep 16, 2026',
    'Invited bharat@example.com business@tahi.studio',
    'Meeting records Transcript',
    'Summary',
    'Bharat wants the booking flow rebuilt before the season starts.',
    'Next steps',
    '* [Liam] Send the revised proposal by Friday.',
    '* [Bharat] Share the current booking analytics.',
    'Details',
    '* Booking flow: three screens, one payment step.',
    '\uD83D\uDCD6 Transcript',
    'Meeting (Bharat Kochar) - Transcript',
    '',
    '00:00:00',
    '',
    'Bharat: The booking flow is where we lose people.',
    'Liam: Understood, we can rebuild it in three screens.',
    '',
    'Transcription ended after 00:31:12',
  ].join('\n')

  it('reads the summary, next steps, details and transcript without markdown headings', () => {
    const r = parseGeminiTranscript(plain)
    expect(r.summary).toBe('Bharat wants the booking flow rebuilt before the season starts.')
    expect(r.nextSteps).toEqual(['[Liam] Send the revised proposal by Friday.', '[Bharat] Share the current booking analytics.'])
    expect(r.details).toEqual(['Booking flow: three screens, one payment step.'])
    expect(r.transcript).toContain('Bharat: The booking flow is where we lose people.')
    expect(r.transcript).not.toContain('Summary')
    expect(r.durationFormatted).toBe('00:31:12')
    expect(r.invitedEmails).toEqual(['bharat@example.com', 'business@tahi.studio'])
  })

  it('does not treat the "Meeting records Transcript" line as the divider', () => {
    const r = parseGeminiTranscript(plain)
    expect(r.summary).not.toBeNull()
    expect(r.transcript?.startsWith('Meeting (Bharat Kochar) - Transcript')).toBe(true)
  })

  it('reads the Full notes block, not the Quick notes duplicate', () => {
    const r = parseGeminiTranscript(plain)
    expect(r.nextSteps).not.toContain('Liam to send a proposal.')
    expect(r.summary).not.toContain('Meeting covered')
  })

  it('still reads a doc without a Full notes block from the top', () => {
    const r = parseGeminiTranscript(plain.slice(plain.indexOf('Invited')))
    expect(r.summary).toBe('Bharat wants the booking flow rebuilt before the season starts.')
    expect(r.nextSteps).toHaveLength(2)
  })
})

describe('parseGeminiTranscript, markdown export with bold headings (2026-09)', () => {
  const md = [
    '# **\u270D\uFE0F Quick notes**',
    '',
    'Please rate the new Quick notes tab by taking a short survey.',
    '',
    '## **Elevate x Tahi Studio**',
    '',
    'Campaign launch updates and website spam issues.',
    '',
    '## **Next steps**',
    '',
    '- Liam to send the proposal.',
    '',
    '**Want to see more?** [View the full notes](https://docs.google.com/x)',
    '',
    '# **\uD83D\uDCDD Full notes**',
    '',
    '## **Elevate x Tahi Studio**',
    '',
    'Invited <ella@example.com> [Liam from Tahi Studio](mailto:business@tahi.studio)',
    '',
    'Meeting records [Transcript](https://docs.google.com/y)',
    '',
    '### **Summary**',
    '',
    'The white paper launches next week and the web form spam needs a fix.',
    '',
    '### **Decisions**',
    '',
    '- Keep Pardot for the launch.',
    '',
    '### **Next steps**',
    '',
    '- \\[Liam\\] Add the honeypot to the web form.',
    '- \\[Ella\\] Send the white paper copy.',
    '',
    '### **Details**',
    '',
    '- **Web form spam**: bots are hitting the contact form.',
    '',
    '# **\uD83D\uDCD6 Transcript**',
    '',
    '## **Elevate x Tahi Studio - Transcript**',
    '',
    '### 00:00:00',
    '',
    '**Ella:** the spam started on Monday.',
    '',
    'Transcription ended after 00:44:10',
  ].join('\n')

  it('reads the bold-wrapped headings and starts at Full notes', () => {
    const r = parseGeminiTranscript(md)
    expect(r.summary).toBe('The white paper launches next week and the web form spam needs a fix.')
    expect(r.nextSteps).toEqual(['[Liam] Add the honeypot to the web form.', '[Ella] Send the white paper copy.'])
    expect(r.details).toEqual(['**Web form spam**: bots are hitting the contact form.'])
    expect(r.transcript).toContain('**Ella:** the spam started on Monday.')
    expect(r.transcript?.startsWith('## **Elevate x Tahi Studio - Transcript**')).toBe(true)
    expect(r.durationFormatted).toBe('00:44:10')
    expect(r.invitedEmails).toEqual(['ella@example.com', 'business@tahi.studio'])
  })

  it('ends the summary at the Decisions heading', () => {
    expect(parseGeminiTranscript(md).summary).not.toContain('Pardot')
  })

  it('flattens the timestamp links the markdown export wraps every turn in', () => {
    const linked = md.replace('### 00:00:00', '### [00:00:00](https://docs.google.com/document/d/abc?tab=t.0#heading=h.1)')
    const r = parseGeminiTranscript(linked)
    expect(r.transcript).toContain('### 00:00:00')
    expect(r.transcript).not.toContain('docs.google.com')
  })
})

describe('describeUnparsedDoc', () => {
  it('reports size, heading-looking lines and how the text starts, never the whole doc', () => {
    const doc = ['Meeting notes', '', '## Summary', 'Agreed the homepage scope. '.repeat(40), '# Transcript', 'Tim: hello'].join('\n')
    const out = describeUnparsedDoc(doc)
    expect(out).toContain(doc.length + ' chars')
    expect(out).toContain('Meeting notes | ## Summary | # Transcript')
    expect(out).toContain('Starts: Meeting notes ## Summary')
    expect(out.length).toBeLessThan(doc.length)
  })

  it('says so when the export is empty', () => {
    expect(describeUnparsedDoc('')).toContain('Headings: none')
    expect(describeUnparsedDoc('')).toContain('(empty)')
  })
})
