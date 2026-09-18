/**
 * lib/call-transcripts.ts
 *
 * The landing strip for call notes, and the matcher that decides which call
 * a set of notes belongs to.
 *
 * Before this file, the Drive sync could only ever place a "Notes by Gemini"
 * doc on a discovery_calls row. Two things were wrong with that:
 *
 *   1. scheduled_calls (client kickoffs and check-ins) had no transcript
 *      columns at all, so the notes from a client call were thrown away.
 *   2. A doc the matcher could not place with confidence was dropped with
 *      nothing left behind, so a human could never rescue it.
 *
 * Both are fixed by scoring BOTH tables in one pass and writing a
 * call_transcripts row either way: linked when a call wins clearly, parked
 * with an unlinkedReason when it does not.
 *
 * THE 20 POINT LEAD RULE IS LOAD BEARING. A wrong match writes another
 * client's conversation onto a call, and everything downstream (the wrap up,
 * and later the task suggestions) inherits that mistake silently. When the
 * top two candidates are within 20 points of each other the notes are parked
 * as 'ambiguous' for a human to attach. Widening the field from one table to
 * two makes ties MORE likely, not less, which is exactly why the rule stays.
 */

import { and, desc, eq, gte, isNull, lte } from 'drizzle-orm'
import { schema } from '@/db/d1'

type DrizzleDB = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** Which table a transcript's call lives in. */
export type CallKind = 'discovery' | 'scheduled'

/** Where a transcript came from. More sources land in later phases. */
export type TranscriptSource = 'gemini_drive' | 'manual'

/** Why a transcript is sitting unlinked. */
export type UnlinkedReason = 'no_match' | 'ambiguous'

/** How a transcript got attached to its call. */
export type MatchedBy = 'gemini_title_time' | 'manual'

/** The window either side of the parsed meeting time a call may sit in. */
export const MATCH_WINDOW_MS = 2 * 60 * 60_000

/** Points the winner must lead the runner-up by before anything is written. */
export const MATCH_LEAD_REQUIRED = 20

export interface CallCandidate {
  kind: CallKind
  id: string
  title: string
  scheduledAt: string
  /** The attendees JSON column, as stored. Shape differs slightly between
   *  the two tables but both carry `name` and `email`. */
  attendees: string
  orgId: string | null
  /** discovery_calls only; always null for a scheduled call. */
  transcript: string | null
  /** discovery_calls only; always null for a scheduled call. */
  transcriptSource: string | null
}

export interface ScoredCall {
  candidate: CallCandidate
  score: number
}

export type CallMatch =
  | { status: 'matched'; candidate: CallCandidate; score: number }
  | { status: 'no_match' }
  | { status: 'ambiguous'; top: ScoredCall; runnerUp: ScoredCall }

export interface MatchInput {
  /** Epoch ms the notes say the meeting happened at. */
  centre: number
  /** The attendee name pulled out of the doc title, if any. */
  attendeeGuess: string | null
}

/**
 * Score every candidate against the parsed notes, highest first.
 *
 * The weights are carried over unchanged from the discovery-only matcher in
 * app/api/admin/integrations/google/sync-drive-transcripts, so a discovery
 * call that matched yesterday scores exactly the same today. Both tables go
 * through this one function: a scheduled call is not handicapped, it simply
 * has to win on the same evidence.
 */
export function scoreCallCandidates(
  candidates: readonly CallCandidate[],
  { centre, attendeeGuess }: MatchInput,
): ScoredCall[] {
  const guess = attendeeGuess?.toLowerCase().trim() ?? ''

  return candidates
    .map((candidate) => {
      let score = 0

      // Time proximity. Closer to the time in the doc title is better.
      const deltaMin = Math.abs(new Date(candidate.scheduledAt).getTime() - centre) / 60_000
      if (deltaMin < 15) score += 30
      else if (deltaMin < 60) score += 15
      else if (deltaMin < 180) score += 5

      if (guess) {
        if (candidate.title.toLowerCase().includes(guess)) score += 40
        try {
          const attendees = JSON.parse(candidate.attendees) as Array<{ name?: string; email?: string }>
          const firstWord = guess.split(' ')[0]
          for (const a of attendees) {
            if (a.name?.toLowerCase().includes(guess)) { score += 30; break }
            if (firstWord && a.email?.toLowerCase().split('@')[0].includes(firstWord)) { score += 15; break }
          }
        } catch {
          // A malformed attendees blob scores nothing rather than throwing
          // the whole sync run away.
        }
      }

      return { candidate, score }
    })
    .sort((a, b) => b.score - a.score)
}

/**
 * Decide the match, or refuse to. Never returns a winner the caller has to
 * second-guess: 'matched' means it is safe to write.
 */
export function pickCallMatch(
  candidates: readonly CallCandidate[],
  input: MatchInput,
): CallMatch {
  const scored = scoreCallCandidates(candidates, input)
  const top = scored[0]
  if (!top || top.score === 0) return { status: 'no_match' }

  const runnerUp = scored[1]
  if (runnerUp && top.score - runnerUp.score < MATCH_LEAD_REQUIRED) {
    return { status: 'ambiguous', top, runnerUp }
  }

  return { status: 'matched', candidate: top.candidate, score: top.score }
}

/**
 * Load every discovery AND scheduled call inside the window and pick a match
 * across both at once, so the best overall call wins rather than "the best
 * discovery call, and a scheduled call never gets a look in".
 */
export async function findCallMatch(
  database: DrizzleDB,
  { centre, windowMs, attendeeGuess }: MatchInput & { windowMs: number },
): Promise<CallMatch> {
  const windowStart = new Date(centre - windowMs).toISOString()
  const windowEnd = new Date(centre + windowMs).toISOString()

  const discoveryRows = await database
    .select({
      id: schema.discoveryCalls.id,
      title: schema.discoveryCalls.title,
      scheduledAt: schema.discoveryCalls.scheduledAt,
      attendees: schema.discoveryCalls.attendees,
      orgId: schema.discoveryCalls.orgId,
      transcript: schema.discoveryCalls.transcript,
      transcriptSource: schema.discoveryCalls.transcriptSource,
    })
    .from(schema.discoveryCalls)
    .where(and(
      gte(schema.discoveryCalls.scheduledAt, windowStart),
      lte(schema.discoveryCalls.scheduledAt, windowEnd),
    ))

  const scheduledRows = await database
    .select({
      id: schema.scheduledCalls.id,
      title: schema.scheduledCalls.title,
      scheduledAt: schema.scheduledCalls.scheduledAt,
      attendees: schema.scheduledCalls.attendees,
      orgId: schema.scheduledCalls.orgId,
    })
    .from(schema.scheduledCalls)
    .where(and(
      gte(schema.scheduledCalls.scheduledAt, windowStart),
      lte(schema.scheduledCalls.scheduledAt, windowEnd),
    ))

  const candidates: CallCandidate[] = [
    ...discoveryRows.map((r): CallCandidate => ({
      kind: 'discovery',
      id: r.id,
      title: r.title,
      scheduledAt: r.scheduledAt,
      attendees: r.attendees,
      orgId: r.orgId,
      transcript: r.transcript,
      transcriptSource: r.transcriptSource,
    })),
    ...scheduledRows.map((r): CallCandidate => ({
      kind: 'scheduled',
      id: r.id,
      title: r.title,
      scheduledAt: r.scheduledAt,
      attendees: r.attendees,
      orgId: r.orgId,
      transcript: null,
      transcriptSource: null,
    })),
  ]

  return pickCallMatch(candidates, { centre, attendeeGuess })
}

/**
 * A stable, non-cryptographic digest of the transcript body (FNV-1a, 32 bit,
 * hex). Used only to tell "the same doc, unchanged" from "the doc was
 * edited" on a re-sync. Workers has crypto.subtle but it is async and this is
 * called inside a tight per-doc loop, so a sync hash keeps the caller simple.
 * NEVER treat this as a security boundary.
 */
export function hashTranscript(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

export interface UpsertTranscriptInput {
  source: TranscriptSource
  /** The Drive file id for 'gemini_drive'. Unique within a source. */
  externalId: string
  text: string
  title?: string | null
  receivedAt?: string | null
  summary?: string | null
  wrapUp?: string | null
  callKind?: CallKind | null
  callId?: string | null
  matchedBy?: MatchedBy | null
  unlinkedReason?: UnlinkedReason | null
}

export interface UpsertTranscriptResult {
  id: string
  /** False when an existing row for (source, externalId) was updated. */
  created: boolean
}

/**
 * Write a transcript, keyed on (source, externalId).
 *
 * The cron re-reads the same Drive docs every 30 minutes, so this has to be
 * idempotent at the row level or the unlinked list would fill with copies of
 * the same notes. A second pass updates the body and, if the notes have since
 * been placed, the link; it never un-links a row a human already attached,
 * because an existing callId is only overwritten when the caller supplies a
 * new one.
 */
export async function upsertTranscript(
  database: DrizzleDB,
  input: UpsertTranscriptInput,
): Promise<UpsertTranscriptResult> {
  const [existing] = await database
    .select({ id: schema.callTranscripts.id, callId: schema.callTranscripts.callId })
    .from(schema.callTranscripts)
    .where(and(
      eq(schema.callTranscripts.source, input.source),
      eq(schema.callTranscripts.externalId, input.externalId),
    ))
    .limit(1)

  const receivedAt = input.receivedAt ?? new Date().toISOString()
  const body = {
    title: input.title ?? null,
    receivedAt,
    hash: hashTranscript(input.text),
    text: input.text,
    summary: input.summary ?? null,
    wrapUp: input.wrapUp ?? null,
  }

  if (existing) {
    const updates: Record<string, unknown> = { ...body }
    // Only a caller with a link to offer touches the link columns. A re-sync
    // that now finds no match must not strip a link a human made by hand.
    if (input.callId) {
      updates.callKind = input.callKind ?? null
      updates.callId = input.callId
      updates.matchedBy = input.matchedBy ?? null
      updates.unlinkedReason = null
    } else if (!existing.callId) {
      updates.unlinkedReason = input.unlinkedReason ?? null
    }
    await database
      .update(schema.callTranscripts)
      .set(updates)
      .where(eq(schema.callTranscripts.id, existing.id))
    return { id: existing.id, created: false }
  }

  const id = crypto.randomUUID()
  await database.insert(schema.callTranscripts).values({
    id,
    source: input.source,
    externalId: input.externalId,
    callKind: input.callId ? (input.callKind ?? null) : null,
    callId: input.callId ?? null,
    matchedBy: input.callId ? (input.matchedBy ?? null) : null,
    unlinkedReason: input.callId ? null : (input.unlinkedReason ?? null),
    createdAt: new Date().toISOString(),
    ...body,
  })
  return { id, created: true }
}

/** Attach a parked transcript to a call. Clears the unlinked reason. */
export async function linkTranscript(
  database: DrizzleDB,
  id: string,
  callKind: CallKind,
  callId: string,
  matchedBy: MatchedBy = 'manual',
): Promise<void> {
  await database
    .update(schema.callTranscripts)
    .set({ callKind, callId, matchedBy, unlinkedReason: null })
    .where(eq(schema.callTranscripts.id, id))
}

export interface CallTranscriptRow {
  id: string
  callKind: string | null
  callId: string | null
  source: string
  externalId: string
  title: string | null
  receivedAt: string
  summary: string | null
  unlinkedReason: string | null
  matchedBy: string | null
  text: string
}

/** Every transcript still waiting for a human to place it, newest first. */
export async function listUnlinked(
  database: DrizzleDB,
  limit = 20,
): Promise<CallTranscriptRow[]> {
  return database
    .select({
      id: schema.callTranscripts.id,
      callKind: schema.callTranscripts.callKind,
      callId: schema.callTranscripts.callId,
      source: schema.callTranscripts.source,
      externalId: schema.callTranscripts.externalId,
      title: schema.callTranscripts.title,
      receivedAt: schema.callTranscripts.receivedAt,
      summary: schema.callTranscripts.summary,
      unlinkedReason: schema.callTranscripts.unlinkedReason,
      matchedBy: schema.callTranscripts.matchedBy,
      text: schema.callTranscripts.text,
    })
    .from(schema.callTranscripts)
    .where(isNull(schema.callTranscripts.callId))
    .orderBy(desc(schema.callTranscripts.receivedAt))
    .limit(limit)
}

/**
 * Locate a call by kind and id and report the org it belongs to, so a route
 * can run the same access check it would run on the call itself.
 *
 * `found: false` means no such call. `found: true` with a null orgId is a
 * legitimate state for a discovery call: a pre-client conversation with a
 * lead has no organisation yet.
 */
export async function resolveCallOrgId(
  database: DrizzleDB,
  callKind: CallKind,
  callId: string,
): Promise<{ found: boolean; orgId: string | null }> {
  if (callKind === 'discovery') {
    const [row] = await database
      .select({ orgId: schema.discoveryCalls.orgId })
      .from(schema.discoveryCalls)
      .where(eq(schema.discoveryCalls.id, callId))
      .limit(1)
    return row ? { found: true, orgId: row.orgId } : { found: false, orgId: null }
  }

  const [row] = await database
    .select({ orgId: schema.scheduledCalls.orgId })
    .from(schema.scheduledCalls)
    .where(eq(schema.scheduledCalls.id, callId))
    .limit(1)
  return row ? { found: true, orgId: row.orgId } : { found: false, orgId: null }
}

/** Narrow an untrusted value to a call kind. */
export function parseCallKind(value: unknown): CallKind | null {
  return value === 'discovery' || value === 'scheduled' ? value : null
}
