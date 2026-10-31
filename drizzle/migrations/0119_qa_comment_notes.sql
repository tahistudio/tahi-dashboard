/* Migration 0119: Site QA comment notes.
   qa_comment_notes is a thread of notes under one qa_comments row, oldest first.
   Additive only and re-run safe (IF NOT EXISTS on the table and the index).
   The comment delete route removes a comment's notes with it.
   Apply BEFORE deploying: db/schema.ts names the table and the comment routes read it. */

CREATE TABLE IF NOT EXISTS qa_comment_notes (id text PRIMARY KEY NOT NULL, comment_id text NOT NULL, body text NOT NULL, author_id text, author_name text, source text NOT NULL DEFAULT 'dashboard', created_at text NOT NULL);
CREATE INDEX IF NOT EXISTS idx_qa_comment_notes_comment ON qa_comment_notes(comment_id);
