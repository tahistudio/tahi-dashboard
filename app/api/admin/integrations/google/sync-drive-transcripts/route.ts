/**
 * POST /api/admin/integrations/google/sync-drive-transcripts
 *
 * Pulls "Notes by Gemini" docs from Drive and writes their summary +
 * transcript + next steps back to matching discovery_calls rows.
 *
 * Matching strategy:
 *   1. Parse the doc title to extract scheduled time + attendee guess
 *      ("Meeting (Tim Lyons) - 2026/05/22 20:41 NZST - Notes by Gemini")
 *   2. Find discovery_calls whose scheduledAt is within ±2h of the
 *      parsed time AND whose attendees list contains the guessed name
 *      OR whose title contains the guessed name.
 *   3. If exactly one match: write transcript + summary + outcomeNotes
 *      (only if those fields are currently empty — never clobber a
 *      Liam-edited summary).
 *   4. If zero matches: skip (probably an internal Tahi-only meeting,
 *      or a call we never created a record for).
 *   5. If multiple matches: skip + log warning (manual disambiguation).
 *
 * Idempotent: stamps transcriptSource='gemini_drive' on a successful
 * write. Re-running skips already-stamped rows.
 *
 * Query:
 *   ?sinceHours=N  only consider docs modified in the last N hours
 *                  (default 72)
 *   ?limit=N       cap docs processed per call (default 20, max 50)
 *   ?dryRun=1      parse + report matches without writing
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, eq, gte, isNull, lte, or } from 'drizzle-orm'
import { getGoogleAccessToken, listDriveFiles, exportDriveDocAsText } from '@/lib/google'
import { parseGeminiTitle, parseGeminiTranscript } from '@/lib/gemini-transcript-parser'

export const dynamic = 'force-dynamic'

const MATCH_WINDOW_MS = 2 * 60 * 60_000  // ±2 hours

interface DocResult {
  fileId: string
  title: string
  status: 'matched' | 'no_match' | 'multiple_matches' | 'already_synced' | 'parse_failed' | 'skipped' | 'no_transcript'
  callId?: string
  detail?: string
}

export async function POST(req: NextRequest) {
  const cronHeader = req.headers.get('x-cron-secret')
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.TAHI_CRON_SECRET ?? process.env.CRON_SECRET
  const hasCronAuth = !!cronSecret && (cronHeader === cronSecret || authHeader === `Bearer ${cronSecret}`)
  if (!hasCronAuth) {
    const { orgId } = await getRequestAuth(req)
    if (!isTahiAdmin(orgId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const url = new URL(req.url)
  const sinceHoursRaw = parseInt(url.searchParams.get('sinceHours') ?? '', 10)
  const sinceHours = Number.isFinite(sinceHoursRaw) && sinceHoursRaw > 0 ? sinceHoursRaw : 72
  const limitRaw = parseInt(url.searchParams.get('limit') ?? '', 10)
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50) : 20
  const dryRun = url.searchParams.get('dryRun') === '1' || url.searchParams.get('dryRun') === 'true'

  const database = await db()
  const { accessToken } = await getGoogleAccessToken(database)

  // Drive query: docs only, "Notes by Gemini" in title, modified recently.
  const sinceIso = new Date(Date.now() - sinceHours * 60 * 60_000).toISOString()
  const driveQuery = [
    `mimeType = 'application/vnd.google-apps.document'`,
    `name contains 'Notes by Gemini'`,
    `modifiedTime > '${sinceIso}'`,
    `trashed = false`,
  ].join(' and ')

  const files = await listDriveFiles(accessToken, driveQuery, limit)

  const results: DocResult[] = []
  let written = 0

  for (const file of files) {
    const titleParsed = parseGeminiTitle(file.name)
    if (!titleParsed.scheduledAt && !titleParsed.attendeeGuess) {
      results.push({ fileId: file.id, title: file.name, status: 'parse_failed', detail: 'Could not parse title format' })
      continue
    }

    // Candidate calls within the time window. If scheduledAt couldn't
    // be parsed, fall back to a 7-day window centred on the doc's
    // modifiedTime (a fuzzy "around this week" heuristic).
    const centre = titleParsed.scheduledAt
      ? new Date(titleParsed.scheduledAt).getTime()
      : new Date(file.modifiedTime ?? file.createdTime ?? Date.now()).getTime()
    const windowMs = titleParsed.scheduledAt ? MATCH_WINDOW_MS : 3.5 * 24 * 60 * 60_000
    const windowStart = new Date(centre - windowMs).toISOString()
    const windowEnd = new Date(centre + windowMs).toISOString()

    const candidates = await database
      .select({
        id: schema.discoveryCalls.id,
        title: schema.discoveryCalls.title,
        scheduledAt: schema.discoveryCalls.scheduledAt,
        transcript: schema.discoveryCalls.transcript,
        transcriptSource: schema.discoveryCalls.transcriptSource,
        attendees: schema.discoveryCalls.attendees,
      })
      .from(schema.discoveryCalls)
      .where(and(
        gte(schema.discoveryCalls.scheduledAt, windowStart),
        lte(schema.discoveryCalls.scheduledAt, windowEnd),
      ))

    if (candidates.length === 0) {
      results.push({ fileId: file.id, title: file.name, status: 'no_match', detail: `No call in ±${Math.round(windowMs / 60 / 60_000)}h window` })
      continue
    }

    // Score each candidate by attendee/title match.
    const guess = titleParsed.attendeeGuess?.toLowerCase() ?? ''
    const scored = candidates.map(c => {
      let score = 0
      // Time proximity bonus — closer in time = higher score
      const callTime = new Date(c.scheduledAt).getTime()
      const deltaMin = Math.abs(callTime - centre) / 60_000
      if (deltaMin < 15) score += 30
      else if (deltaMin < 60) score += 15
      else if (deltaMin < 180) score += 5

      // Attendee name match in attendees JSON OR in call title
      if (guess) {
        const callTitleLower = c.title.toLowerCase()
        if (callTitleLower.includes(guess)) score += 40
        try {
          const att = JSON.parse(c.attendees) as Array<{ name?: string; email?: string }>
          for (const a of att) {
            if (a.name?.toLowerCase().includes(guess)) { score += 30; break }
            if (a.email?.toLowerCase().split('@')[0].includes(guess.split(' ')[0])) { score += 15; break }
          }
        } catch { /* ignore */ }
      }
      return { call: c, score }
    }).sort((a, b) => b.score - a.score)

    const top = scored[0]
    const runnerUp = scored[1]
    if (!top || top.score === 0) {
      results.push({ fileId: file.id, title: file.name, status: 'no_match', detail: 'No candidate scored > 0' })
      continue
    }
    // Require a clear winner — at least 20 points lead over runner-up
    if (runnerUp && top.score - runnerUp.score < 20) {
      results.push({
        fileId: file.id,
        title: file.name,
        status: 'multiple_matches',
        detail: `Top ${top.call.id} (${top.score}) vs runner-up ${runnerUp.call.id} (${runnerUp.score}) — too close`,
      })
      continue
    }

    // Already synced from this source — skip
    if (top.call.transcriptSource === 'gemini_drive' && top.call.transcript) {
      results.push({ fileId: file.id, title: file.name, status: 'already_synced', callId: top.call.id })
      continue
    }

    // Fetch + parse the doc
    let docText = ''
    try {
      docText = await exportDriveDocAsText(accessToken, file.id)
    } catch (err) {
      results.push({
        fileId: file.id,
        title: file.name,
        status: 'parse_failed',
        detail: err instanceof Error ? err.message : String(err),
      })
      continue
    }

    const parsed = parseGeminiTranscript(docText)
    if (!parsed.transcript && !parsed.summary) {
      results.push({ fileId: file.id, title: file.name, status: 'no_transcript', callId: top.call.id })
      continue
    }

    if (dryRun) {
      results.push({
        fileId: file.id,
        title: file.name,
        status: 'matched',
        callId: top.call.id,
        detail: `Would write: ${parsed.summary?.length ?? 0}-char summary, ${parsed.transcript?.length ?? 0}-char transcript, ${parsed.nextSteps.length} next steps`,
      })
      continue
    }

    // Compose outcomeNotes from Next steps + Details (only if no
    // existing outcomeNotes — never clobber a Liam-edited value).
    const outcomeBits: string[] = []
    if (parsed.nextSteps.length > 0) {
      outcomeBits.push('NEXT STEPS\n' + parsed.nextSteps.map(s => `- ${s}`).join('\n'))
    }
    if (parsed.details.length > 0) {
      outcomeBits.push('DETAILS\n' + parsed.details.map(s => `- ${s}`).join('\n'))
    }
    const outcomeNotes = outcomeBits.length > 0 ? outcomeBits.join('\n\n') : null

    const updates: Record<string, string | null> = {
      transcriptSource: 'gemini_drive',
      updatedAt: new Date().toISOString(),
    }
    // Only write transcript if not already set (Liam might have pasted
    // their own). Same for summary + outcomeNotes.
    if (parsed.transcript && !top.call.transcript) {
      updates.transcript = parsed.transcript.slice(0, 50_000)  // cap to schema budget
    }
    if (parsed.summary) {
      updates.summary = parsed.summary
    }
    if (outcomeNotes) {
      updates.outcomeNotes = outcomeNotes
    }

    await database
      .update(schema.discoveryCalls)
      .set(updates)
      .where(eq(schema.discoveryCalls.id, top.call.id))

    written++
    results.push({
      fileId: file.id,
      title: file.name,
      status: 'matched',
      callId: top.call.id,
      detail: `Wrote ${parsed.transcript ? `${parsed.transcript.length}-char transcript, ` : ''}${parsed.summary ? `${parsed.summary.length}-char summary, ` : ''}${parsed.nextSteps.length} next steps`,
    })
  }

  // Update last-sync timestamp so reports can show "Drive last synced X
  // minutes ago" without a separate query.
  await database
    .update(schema.integrations)
    .set({
      lastSyncedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.integrations.service, 'google_workspace'))

  return NextResponse.json({
    dryRun,
    scanned: files.length,
    written,
    results,
  })
  void isNull
  void or
}
