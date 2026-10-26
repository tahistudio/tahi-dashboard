/* Migration 0117: Site QA element context.
   qa_comments.element_context holds the JSON text of a QaElementContext (classes, ancestors, html, box)
   captured at pick time, so another tool can find the element without seeing the screen.
   SQLite has no ADD COLUMN IF NOT EXISTS. Re-run safe through the migrate runner's duplicate-column
   catch (as 0108, 0111 and 0112 are): use the runner's '0117' for a re-run.
   Apply BEFORE deploying: db/schema.ts names the column, so full-row selects of qa_comments read it. */

ALTER TABLE qa_comments ADD COLUMN element_context text;
