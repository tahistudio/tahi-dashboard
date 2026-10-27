/* Migration 0118: Site QA browsers per round.
   A page renders with the engine of the browser it is open in, so a round can cover Chrome,
   Firefox and Safari and every tick, scan and comment records which one it came from.
   Chromium ticks stay in the qa_round_pages.vp_* columns, so older rounds read the same,
   and Firefox and WebKit ticks live in qa_browser_ticks.
   SQLite has no ADD COLUMN IF NOT EXISTS. Re-run safe through the migrate runner's
   duplicate-column catch (as 0117 is): use the runner's '0118' for a re-run.
   Order matters. The new scan index is created before the old one is dropped, so the
   (round_page_id, viewport, browser) uniqueness that scan upserts rely on never lapses.
   Apply BEFORE deploying: db/schema.ts names these columns, so full-row selects read them. */

ALTER TABLE qa_rounds ADD COLUMN browsers text NOT NULL DEFAULT '["chromium"]';

CREATE TABLE IF NOT EXISTS qa_browser_ticks (id text PRIMARY KEY NOT NULL, round_page_id text NOT NULL, browser text NOT NULL, viewport text NOT NULL, ticked integer NOT NULL DEFAULT 0, updated_by text, updated_at text NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS idx_qa_browser_ticks_page_browser_vp ON qa_browser_ticks(round_page_id, browser, viewport);

ALTER TABLE qa_scan_results ADD COLUMN browser text NOT NULL DEFAULT 'chromium';

CREATE UNIQUE INDEX IF NOT EXISTS idx_qa_scan_results_page_vp_browser ON qa_scan_results(round_page_id, viewport, browser);

DROP INDEX IF EXISTS idx_qa_scan_results_page_vp;

ALTER TABLE qa_comments ADD COLUMN browser text NOT NULL DEFAULT 'chromium';
