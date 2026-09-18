-- Migration 0105: call_transcripts, the landing strip for call notes.
--
-- Phase 0 of "call notes to tasks". Liam: "we can keep it with either Gemini
-- Drive or Gmail, it's Gemini transcripts that is happening, so wherever we
-- get it from this obviously get the full transcript as well as the wrap up."
--
-- Until now a "Notes by Gemini" doc could only land on discovery_calls.
-- scheduled_calls (client kickoffs and check-ins) has no transcript columns
-- at all, so the notes from a client call were simply discarded; and a doc the
-- matcher could not place with a 20 point lead was dropped with nothing left
-- behind for a human to rescue. This table fixes both: every parsed doc gets a
-- row, linked when a call wins clearly and parked when it does not.
--
--   call_kind / call_id  'discovery' | 'scheduled' plus that table's id. BOTH
--                        stay NULL while the notes are unplaced, which is a
--                        normal state, not an error: the matcher parks rather
--                        than guesses, because a wrong match writes one
--                        client's conversation onto another client's call.
--   source               'gemini_drive' (the Drive sync) or 'manual'. More
--                        sources (inbox, Slack) land in later phases.
--   external_id          The Drive file id. Unique WITH source, which is what
--                        makes the 30-minute cron idempotent: re-reading the
--                        same doc updates its row rather than filling the
--                        unlinked list with copies.
--   title                The doc title as Drive reports it. Not in the first
--                        sketch of this table, but the "Unlinked call notes"
--                        list on /calls has to be able to name a doc a human
--                        is being asked to place, and external_id is an opaque
--                        Drive id.
--   received_at          The doc's modified time, NOT this row's created_at,
--                        so the list sorts by when the notes were written.
--   hash                 FNV-1a of `text` (lib/call-transcripts.ts), for
--                        change detection on re-sync only. Never a security
--                        boundary.
--   text                 The full transcript prose.
--   summary              The Gemini Summary section on its own.
--   wrap_up              The wrap up as written: summary plus next steps plus
--                        details, the part Liam reads instead of the whole
--                        transcript.
--   matched_by           'gemini_title_time' (the matcher) or 'manual'
--                        (attached by hand from /calls).
--   unlinked_reason      'no_match' | 'ambiguous' while call_id is NULL.
--
-- No REFERENCES on call_id: it is polymorphic across two tables, so a foreign
-- key cannot express it, and notes should outlive a deleted call rather than
-- vanish with it.
--
-- discovery_calls keeps its own transcript / summary / outcome_notes columns
-- and the Drive sync keeps writing them for a discovery match, so nothing
-- reading those today changes behaviour. A scheduled match writes ONLY the
-- transcripts row: scheduled_calls.notes is the prep note (see 0102) and must
-- not be clobbered with a transcript.
--
-- Additive, IF NOT EXISTS throughout: safe to re-run. Apply BEFORE deploying,
-- because the new routes select these columns directly and the Drive sync
-- writes a row for every doc it parses.
CREATE TABLE IF NOT EXISTS call_transcripts (
  id text PRIMARY KEY NOT NULL,
  call_kind text,
  call_id text,
  source text NOT NULL,
  external_id text NOT NULL,
  title text,
  received_at text NOT NULL,
  hash text NOT NULL,
  text text NOT NULL,
  summary text,
  wrap_up text,
  matched_by text,
  unlinked_reason text,
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_call_transcripts_source_external ON call_transcripts(source, external_id);
CREATE INDEX IF NOT EXISTS idx_call_transcripts_call ON call_transcripts(call_kind, call_id);
CREATE INDEX IF NOT EXISTS idx_call_transcripts_received ON call_transcripts(received_at);
