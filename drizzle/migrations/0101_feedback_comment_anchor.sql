-- Migration 0101: feedback_comments gains anchor_selector, anchor_tag,
-- anchor_text, anchor_rect and anchor_context.
--
-- Liam wants to click the feedback ball, then click the element he's
-- talking about, the way Claude Design/Webflow/Figma let you pin a comment
-- to something on screen. These five columns are that pin: a CSS-ish
-- selector path (lib/feedback-anchor.ts#buildSelectorPath, preferring an id,
-- then data-testid/aria-label, then a short tag+nth-of-type path capped at 8
-- segments), the element's tag name, its visible text trimmed to 120 chars,
-- its bounding rect relative to the page plus the page's total scroll
-- height (anchor_rect, JSON: {x, y, width, height, scrollHeight}, all
-- integers), and the nearest ancestor's data-section or aria-label for a bit
-- of human context (anchor_context).
--
-- All five are nullable: a general comment (Escape out of pick mode, or
-- clicking the ball a second time) carries none of them, exactly as before
-- this migration.
--
-- Additive, ALTER TABLE ADD COLUMN. No IF NOT EXISTS on columns (SQLite has
-- no such clause for ADD COLUMN); the runner in
-- app/api/admin/db/migrate/route.ts already swallows "duplicate column
-- name" errors so re-running this migration is safe.
ALTER TABLE feedback_comments ADD COLUMN anchor_selector text;
ALTER TABLE feedback_comments ADD COLUMN anchor_tag text;
ALTER TABLE feedback_comments ADD COLUMN anchor_text text;
ALTER TABLE feedback_comments ADD COLUMN anchor_rect text;
ALTER TABLE feedback_comments ADD COLUMN anchor_context text;
