/**
 * Parser for Google "Notes by Gemini" meeting docs.
 *
 * The doc format (as of 2026-05) has a clear two-section structure:
 *
 *   # 📝 Notes
 *   [meeting date]
 *   ## [meeting title]
 *   Invited [emails]
 *   Attachments [calendar link]
 *   Meeting records [Transcript link]
 *
 *   ### Summary
 *   [2-3 paragraph summary, sometimes with **Bold Headings**]
 *
 *   ### Next steps
 *     - [name] Action: description.
 *     - [name] Action: description.
 *
 *   ### Details
 *     - **Topic Name**: Detail body with [timestamp](link). More text.
 *     - **Topic Name**: ...
 *
 *   # 📝 Transcript
 *   ## [meeting title] - Transcript
 *   ### [HH:MM:SS]
 *   **Speaker:** spoken text
 *   **Speaker:** spoken text
 *   ### [HH:MM:SS]
 *   ...
 *
 * The parser is conservative — it returns whatever it can find and
 * falls back to null for any section that doesn't match expected
 * structure. Callers should treat all fields as optional.
 */

export interface GeminiTranscriptParsed {
  /** Free-text 2-3 paragraph summary from the Summary section. */
  summary: string | null
  /** Action items as `[owner] action` strings. */
  nextSteps: string[]
  /** Numbered topic list from the Details section, each as `**Topic**: body`. */
  details: string[]
  /** The full transcript prose (speaker turns with timestamps). */
  transcript: string | null
  /** Email addresses parsed from "Invited" line. */
  invitedEmails: string[]
  /** Total transcript duration if "Transcription ended after HH:MM:SS" present. */
  durationFormatted: string | null
}

/** Title format from Drive: "[Meeting type] ([attendee name]) -
 *  YYYY/MM/DD HH:MM TZ - Notes by Gemini". Extract the meeting date,
 *  attendee guess, and short title. */
export interface GeminiTitleParsed {
  shortTitle: string | null    // e.g. "Meeting (Tim Lyons)" — the bit before the date
  attendeeGuess: string | null // e.g. "Tim Lyons" — pulled from parens
  scheduledAt: string | null   // ISO timestamp (best-effort)
}

export function parseGeminiTitle(title: string): GeminiTitleParsed {
  // Pattern: "<short> - YYYY/MM/DD HH:MM <TZ> - Notes by Gemini"
  const m = title.match(/^(.*?)\s+-\s+(\d{4}\/\d{2}\/\d{2})\s+(\d{1,2}:\d{2})\s+([A-Z]+)\s+-\s+Notes by Gemini\s*$/i)
  if (!m) {
    return { shortTitle: null, attendeeGuess: null, scheduledAt: null }
  }
  const shortTitle = m[1].trim()
  const date = m[2]
  const time = m[3]
  const tz = m[4]

  const attendeeMatch = shortTitle.match(/\(([^)]+)\)/)
  const attendeeGuess = attendeeMatch ? attendeeMatch[1].trim() : null

  // Best-effort ISO conversion. Gemini uses local timezones we don't
  // always know how to parse (NZST, NZDT, BST, EST, PST etc). We try a
  // small whitelist of common ones; otherwise we drop the TZ and treat
  // as the system timezone, which is wrong by up to 13h. Callers should
  // match on title fuzz first and use this only as a tiebreaker.
  const TZ_OFFSETS: Record<string, string> = {
    NZST: '+12:00', NZDT: '+13:00',
    AEST: '+10:00', AEDT: '+11:00',
    BST: '+01:00', GMT: '+00:00', UTC: '+00:00',
    PST: '-08:00', PDT: '-07:00',
    EST: '-05:00', EDT: '-04:00',
  }
  const offset = TZ_OFFSETS[tz] ?? null
  let scheduledAt: string | null = null
  if (offset) {
    // 2026/05/22 → 2026-05-22, HH:MM → HH:MM:00
    const isoBase = `${date.replace(/\//g, '-')}T${time.padStart(5, '0')}:00`
    const d = new Date(`${isoBase}${offset}`)
    if (!isNaN(d.getTime())) scheduledAt = d.toISOString()
  }

  return { shortTitle, attendeeGuess, scheduledAt }
}

const TRANSCRIPT_DIVIDER = /\n#\s*[^\n]*Transcript\*?\s*\n/i
const NOTES_HEADER = /^#\s*[^\n]*Notes[^\n]*$/im

export function parseGeminiTranscript(rawText: string): GeminiTranscriptParsed {
  // Split notes vs transcript halves. The transcript divider includes
  // an emoji char and the literal word "Transcript" on its own line.
  const parts = rawText.split(TRANSCRIPT_DIVIDER)
  const notesPart = parts[0] ?? ''
  const transcriptPart = parts.slice(1).join('\n') || null

  return {
    summary: extractSection(notesPart, 'Summary'),
    nextSteps: extractBulletList(notesPart, 'Next steps'),
    details: extractBulletList(notesPart, 'Details'),
    transcript: cleanTranscript(transcriptPart),
    invitedEmails: extractInvitedEmails(notesPart),
    durationFormatted: extractDuration(transcriptPart ?? ''),
  }
}

/** Extract everything under "### {label}" up to the next ### or # header. */
function extractSection(text: string, label: string): string | null {
  const escaped = label.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
  const re = new RegExp(`###\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n###\\s|\\n##\\s|\\n#\\s|$)`, 'i')
  const m = text.match(re)
  if (!m) return null
  // Drop the "Rate this Summary" / survey trailers Gemini adds.
  const cleaned = m[1]
    .replace(/\*?Rate this Summary:[\s\S]*/i, '')
    .replace(/\*You should review[\s\S]*/i, '')
    .trim()
  return cleaned || null
}

function extractBulletList(text: string, label: string): string[] {
  const section = extractSection(text, label)
  if (!section) return []
  const lines = section.split('\n')
  const items: string[] = []
  for (const line of lines) {
    // Gemini bullets are like "  - \[Owner\] Action: text"
    const m = line.match(/^\s*-\s+(.+)$/)
    if (m) {
      // Unescape backslashed brackets that markdown adds
      const cleaned = m[1]
        .replace(/\\\[/g, '[')
        .replace(/\\\]/g, ']')
        .trim()
      if (cleaned) items.push(cleaned)
    }
  }
  return items
}

function extractInvitedEmails(text: string): string[] {
  const m = text.match(/^Invited\s+(.+)$/m)
  if (!m) return []
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
  return Array.from(new Set(m[1].match(emailRegex) ?? []))
}

function extractDuration(transcriptText: string): string | null {
  const m = transcriptText.match(/Transcription ended after\s+(\d{2}:\d{2}:\d{2})/i)
  return m ? m[1] : null
}

/** Strip the survey trailer + heading clutter from the transcript half. */
function cleanTranscript(raw: string | null): string | null {
  if (!raw) return null
  // Drop the "*This editable transcript was computer generated..." trailer
  const trailerRe = /\*This editable transcript was computer generated[\s\S]*$/i
  const cleaned = raw.replace(trailerRe, '').trim()
  return cleaned || null
}
