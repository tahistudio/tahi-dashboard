/**
 * POST /api/admin/integrations/google/sync-drive-transcripts
 *
 * Pulls "Notes by Gemini" docs from Drive, files each one as a
 * call_transcripts row, and (for a discovery match) keeps writing the
 * summary + transcript + next steps back onto the discovery_calls row
 * exactly as it always did.
 *
 * WHAT CHANGED IN PHASE 0. The matcher now scores discovery_calls AND
 * scheduled_calls together, so the notes from a client kickoff or check-in
 * stop being thrown away, and EVERY parsed doc leaves a row behind:
 * linked when a call wins by the required lead, parked with an
 * unlinked_reason ('no_match' | 'ambiguous') when it does not, so a human
 * can attach it from /calls instead of the notes disappearing. A scheduled
 * match writes the transcripts row ONLY: scheduled_calls has no transcript
 * column and its `notes` column is the prep note (migration 0102), which a
 * transcript must not clobber.
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
import { requireFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { getGoogleAccessToken, listDriveFiles, exportDriveDocAsText } from '@/lib/google'
import { parseGeminiTitle, parseGeminiTranscript } from '@/lib/gemini-transcript-parser'
import { logCronRun } from '@/lib/cron-runs'
import { MATCH_WINDOW_MS, findCallMatch, findFiledTranscript, parseCallKind, upsertTranscript } from '@/lib/call-transcripts'

export const dynamic = 'force-dynamic'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

interface DocResult {
  fileId: string
  title: string
  status: 'matched' | 'no_match' | 'multiple_matches' | 'already_synced' | 'already_filed' | 'parse_failed' | 'skipped' | 'no_transcript'
  callKind?: 'discovery' | 'scheduled'
  callId?: string
  /** The call_transcripts row written for this doc, linked or parked. */
  transcriptId?: string
  detail?: string
}

export async function POST(req: NextRequest) {
  const t0 = Date.now()
  const cronHeader = req.headers.get('x-cron-secret')
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.TAHI_CRON_SECRET ?? process.env.CRON_SECRET
  const hasCronAuth = !!cronSecret && (cronHeader === cronSecret || authHeader === `Bearer ${cronSecret}`)
  if (!hasCronAuth) {
    const { userId, orgId } = await getRequestAuth(req)
    if (!isTahiAdmin(orgId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const denied = await requireFeature({ userId, orgId }, 'settings.integrations')
    if (denied) return denied
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
  // `filed` counts call_transcripts rows written (matched or parked);
  // `parked` counts the subset still waiting for a human to attach them.
  let filed = 0
  let parked = 0
  // `unchanged` counts docs already filed on an earlier pass that Drive has
  // not modified since: nothing exported, nothing written.
  let unchanged = 0

  for (const file of files) {
    const titleParsed = parseGeminiTitle(file.name)
    if (!titleParsed.scheduledAt && !titleParsed.attendeeGuess) {
      results.push({ fileId: file.id, title: file.name, status: 'parse_failed', detail: 'Could not parse title format' })
      continue
    }

    // Candidate window. If scheduledAt couldn't be parsed, fall back to a
    // 7-day window centred on the doc's modifiedTime (a fuzzy "around this
    // week" heuristic).
    const centre = titleParsed.scheduledAt
      ? new Date(titleParsed.scheduledAt).getTime()
      : new Date(file.modifiedTime ?? file.createdTime ?? Date.now()).getTime()
    const windowMs = titleParsed.scheduledAt ? MATCH_WINDOW_MS : 3.5 * 24 * 60 * 60_000

    // One pass over BOTH call tables. The 20 point lead rule lives in
    // lib/call-transcripts.ts and is unchanged: a near-tie is parked, never
    // guessed, which matters more now the field is twice as wide.
    const match = await findCallMatch(database as unknown as D1, {
      centre,
      windowMs,
      attendeeGuess: titleParsed.attendeeGuess,
    })

    // A row already filed for this doc on an earlier pass, matched or
    // parked. Unless Drive says the doc changed since, there is nothing to
    // export. This is what stops a parked doc costing a Drive export every
    // 30 minutes until someone attaches it.
    const filedRow = await findFiledTranscript(database as unknown as D1, 'gemini_drive', file.id)
    const docModifiedAt = file.modifiedTime ?? file.createdTime ?? null
    if (filedRow && (!docModifiedAt || docModifiedAt <= filedRow.receivedAt)) {
      unchanged++
      results.push({
        fileId: file.id,
        title: file.name,
        status: 'already_filed',
        callKind: parseCallKind(filedRow.callKind) ?? undefined,
        callId: filedRow.callId ?? undefined,
        transcriptId: filedRow.id,
        detail: filedRow.callId
          ? 'Filed on an earlier pass and unchanged since'
          : 'Parked on an earlier pass, waiting to be attached',
      })
      continue
    }

    // Synced onto its discovery call before the transcripts table existed.
    // The discovery columns are left exactly as they are (Liam may have
    // edited them); the only thing still owed is the transcripts row, so the
    // doc is exported once more to backfill it and never again after that.
    const alreadySynced =
      match.status === 'matched'
      && match.candidate.kind === 'discovery'
      && match.candidate.transcriptSource === 'gemini_drive'
      && !!match.candidate.transcript

    // The body is fetched on EVERY remaining path, matched or not. Parked
    // notes with no text would be nothing a human could act on, which is the
    // whole point of parking them.
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
      results.push({ fileId: file.id, title: file.name, status: 'no_transcript' })
      continue
    }

    // Compose outcomeNotes from Next steps + Details (only written to a
    // discovery call when it has none, never clobbering a Liam-edited value).
    const outcomeBits: string[] = []
    if (parsed.nextSteps.length > 0) {
      outcomeBits.push('NEXT STEPS\n' + parsed.nextSteps.map(s => `- ${s}`).join('\n'))
    }
    if (parsed.details.length > 0) {
      outcomeBits.push('DETAILS\n' + parsed.details.map(s => `- ${s}`).join('\n'))
    }
    const outcomeNotes = outcomeBits.length > 0 ? outcomeBits.join('\n\n') : null

    // The wrap up as written: the Summary section plus next steps plus
    // details. This is the part Liam reads instead of the whole transcript.
    const wrapUpBits: string[] = []
    if (parsed.summary) wrapUpBits.push('SUMMARY\n' + parsed.summary)
    if (outcomeNotes) wrapUpBits.push(outcomeNotes)
    const wrapUp = wrapUpBits.length > 0 ? wrapUpBits.join('\n\n') : null

    const matchedCall = match.status === 'matched' ? match.candidate : null
    const unlinkedReason = match.status === 'ambiguous'
      ? 'ambiguous' as const
      : match.status === 'no_match' ? 'no_match' as const : null

    if (dryRun) {
      results.push({
        fileId: file.id,
        title: file.name,
        status: alreadySynced ? 'already_synced' : matchedCall ? 'matched' : (unlinkedReason === 'ambiguous' ? 'multiple_matches' : 'no_match'),
        callKind: matchedCall?.kind,
        callId: matchedCall?.id,
        detail: `${alreadySynced ? 'Would backfill the transcripts row only' : 'Would file'}: ${parsed.summary?.length ?? 0}-char summary, ${parsed.transcript?.length ?? 0}-char transcript, ${parsed.nextSteps.length} next steps`,
      })
      continue
    }

    const { id: transcriptId } = await upsertTranscript(database as unknown as D1, {
      source: 'gemini_drive',
      externalId: file.id,
      title: file.name,
      receivedAt: file.modifiedTime ?? file.createdTime ?? new Date().toISOString(),
      text: parsed.transcript ?? '',
      summary: parsed.summary,
      wrapUp,
      callKind: matchedCall?.kind ?? null,
      callId: matchedCall?.id ?? null,
      matchedBy: matchedCall ? 'gemini_title_time' : null,
      unlinkedReason,
    })
    filed++

    if (!matchedCall) {
      parked++
      results.push({
        fileId: file.id,
        title: file.name,
        status: unlinkedReason === 'ambiguous' ? 'multiple_matches' : 'no_match',
        transcriptId,
        detail: match.status === 'ambiguous'
          ? `Top ${match.top.candidate.kind}/${match.top.candidate.id} (${match.top.score}) vs runner-up ${match.runnerUp.candidate.kind}/${match.runnerUp.candidate.id} (${match.runnerUp.score}), too close. Parked for manual attach.`
          : 'No candidate call scored. Parked for manual attach.',
      })
      continue
    }

    if (alreadySynced) {
      results.push({
        fileId: file.id,
        title: file.name,
        status: 'already_synced',
        callKind: 'discovery',
        callId: matchedCall.id,
        transcriptId,
        detail: filedRow
          ? 'Doc changed since it was filed: transcripts row refreshed, discovery call left as it was'
          : 'Backfilled the transcripts row; discovery call left as it was',
      })
      continue
    }

    // A scheduled call has no transcript column, and its `notes` column is
    // the prep note (migration 0102). The transcripts row IS the write.
    if (matchedCall.kind === 'scheduled') {
      results.push({
        fileId: file.id,
        title: file.name,
        status: 'matched',
        callKind: 'scheduled',
        callId: matchedCall.id,
        transcriptId,
        detail: 'Filed against the scheduled call; scheduled_calls columns left untouched',
      })
      continue
    }

    // Discovery: the mirror onto discovery_calls, byte for byte what this
    // route did before the transcripts table existed.
    const updates: Record<string, string | null> = {
      transcriptSource: 'gemini_drive',
      updatedAt: new Date().toISOString(),
    }
    if (parsed.transcript && !matchedCall.transcript) {
      updates.transcript = parsed.transcript.slice(0, 250_000)  // matches the discovery-calls PATCH cap
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
      .where(eq(schema.discoveryCalls.id, matchedCall.id))

    written++
    results.push({
      fileId: file.id,
      title: file.name,
      status: 'matched',
      callKind: 'discovery',
      callId: matchedCall.id,
      transcriptId,
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

  const summary = {
    dryRun,
    scanned: files.length,
    written,
    filed,
    parked,
    unchanged,
    results,
  }
  await logCronRun(database as unknown as Parameters<typeof logCronRun>[0], 'sync-drive-transcripts', 'success', Date.now() - t0, summary, null)
  return NextResponse.json(summary)
}
