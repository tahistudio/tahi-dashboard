-- Migration 0039: Granular permissions (RBAC + ABAC foundation)
--
-- Five tables that together give us fine-grained access control:
--
--   roles               — bundles of permissions ('admin', 'task_handler', custom)
--   permissions         — atomic (resource × action) grants
--   role_permissions    — links a role to permissions WITH a scope filter
--                         (all / own / team / specific_orgs / plan_type /
--                         track_type / status)
--   team_member_roles   — a member can hold many roles, optionally
--                         time-bounded via started_at / ended_at
--   field_restrictions  — per-role denial list for sensitive fields
--                         (e.g. salary on team_members)
--
-- Enforcement is a runtime layer: API + UI consult the active
-- member's roles, intersect grants, apply scope filters, redact
-- restricted fields. This migration only ships the SCHEMA — seeding
-- (system roles + permission catalogue) happens via a separate
-- one-shot setup endpoint.
--
-- Numbered 0039 in the inline runner. This migration is strictly
-- additive: no existing tables are altered, no data modified.

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY NOT NULL,
  resource TEXT NOT NULL,
  action TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE(resource, action)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_permissions_resource ON permissions(resource);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS role_permissions (
  id TEXT PRIMARY KEY NOT NULL,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL DEFAULT 'all',
  scope_value TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE(role_id, permission_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_role_permissions_perm ON role_permissions(permission_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS team_member_roles (
  id TEXT PRIMARY KEY NOT NULL,
  team_member_id TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_team_member_roles_member ON team_member_roles(team_member_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_team_member_roles_role ON team_member_roles(role_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_team_member_roles_active ON team_member_roles(ended_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS field_restrictions (
  id TEXT PRIMARY KEY NOT NULL,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  resource TEXT NOT NULL,
  field TEXT NOT NULL,
  action TEXT NOT NULL DEFAULT 'view',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE(role_id, resource, field, action)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_field_restrictions_role ON field_restrictions(role_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_field_restrictions_resource ON field_restrictions(resource);
