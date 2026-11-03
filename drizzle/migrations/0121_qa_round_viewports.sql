/* Migration 0121: Site QA viewport set per round.
   qa_rounds.viewports holds the JSON list of viewport keys a round covers (lib/qa/viewports.ts).
   NULL means a round made before the viewport set: it keeps the five legacy viewports, and its
   Chromium ticks stay in the qa_round_pages.vp_* columns. Every other tick lives in qa_browser_ticks.
   Nullable with no default on purpose, so rows written by older code read as legacy.
   SQLite has no ADD COLUMN IF NOT EXISTS. Re-run safe through the migrate runner's duplicate
   column catch (as 0117 and 0118 are): use the runner's '0121' for a re-run.
   Apply BEFORE deploying: db/schema.ts names the column, so full-row selects read it. */

ALTER TABLE qa_rounds ADD COLUMN viewports text;
