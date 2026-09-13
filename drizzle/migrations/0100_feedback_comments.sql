-- Migration 0100: feedback_comments, the beta feedback floating comment ball.
--
-- Liam wants a stripped-back beta feedback tool: a draggable floating ball
-- with a comment icon that opens a free-text panel from any screen, for both
-- the Tahi team and clients. There is deliberately no inbox UI yet: rows are
-- written by POST /api/feedback and read back only through GET
-- /api/admin/feedback (admin only) and the MCP tool list_feedback_comments,
-- so this is a one-way capture surface until an inbox is built on top of it.
--
-- org_id is nullable ON PURPOSE: a Tahi team member or admin submitting
-- feedback about their own dashboard has no single client the comment is
-- about, so their rows carry NULL; a client contact's row carries the D1
-- organisations.id resolved server-side from their session (getPortalAuth),
-- never from the request body. user_type records which identity wrote it:
-- 'admin' | 'team_member' for a Tahi org caller (decided by that person's
-- team_members.role), 'contact' for a client.
--
-- context is a JSON blob gathered client-side at send time
-- (lib/feedback-context.ts): the last 20 console errors/warnings, the last
-- 20 failed fetches (method, url, status), the visible headings on the
-- page, and the impersonation state (Client view) when the sender is a Tahi
-- admin previewing a client. Everything else (route, page_title, viewport,
-- breakpoint, theme, user_agent) is its own column so the admin GET can
-- filter and sort on them without parsing JSON.
--
-- No REFERENCES on org_id, matching the rest of this tree's optional org
-- links (e.g. email_suppressions, services): a comment about a client that
-- is later archived or deleted should not vanish or block that deletion.
--
-- Additive, IF NOT EXISTS throughout: safe to re-run.
CREATE TABLE IF NOT EXISTS feedback_comments (
  id text PRIMARY KEY NOT NULL,
  org_id text,
  user_id text NOT NULL,
  user_type text NOT NULL,
  user_email text,
  route text,
  page_title text,
  viewport_width integer,
  viewport_height integer,
  breakpoint text,
  theme text,
  user_agent text,
  body text NOT NULL,
  context text,
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_feedback_comments_org ON feedback_comments(org_id);
CREATE INDEX IF NOT EXISTS idx_feedback_comments_created ON feedback_comments(created_at);
