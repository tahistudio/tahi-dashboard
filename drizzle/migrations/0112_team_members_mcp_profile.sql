-- Migration 0112: per-person MCP profile on team_members
--
-- team_members.mcp_profile   which Claude connector profile a studio member
--                            gets when they sign in to connect Claude:
--                            'full' | 'designer' | NULL. NULL means no
--                            connector access at all (deny by default).
--
-- Seeded for the two people who use the connector today: Liam gets 'full',
-- Staci gets 'designer'. Everyone else stays NULL until Liam turns it on.
-- The seed UPDATEs only touch rows still NULL, so a profile changed by hand
-- afterwards is never overwritten by a re-run.
--
-- Re-run safe through the runner's duplicate-column catch (as 0108 and 0111
-- are); the UPDATEs are idempotent on their own. A second run of this file
-- through wrangler fails on the ALTER once the column exists, which is
-- harmless: use the runner's '0112' for a re-run.
--
-- Safe to apply AFTER deploy: the column is deliberately NOT in
-- db/schema.ts (like hourly_cost_rate), so no full-row select of team_members
-- names it. lib/mcp-profile-server.ts reads it through raw SQL and treats a
-- missing column as "no profile", which fails closed.

ALTER TABLE team_members ADD COLUMN mcp_profile text;
UPDATE team_members SET mcp_profile = 'full' WHERE lower(email) = 'business@tahi.studio' AND mcp_profile IS NULL;
UPDATE team_members SET mcp_profile = 'designer' WHERE lower(email) = 'staci@tahi.studio' AND mcp_profile IS NULL;
