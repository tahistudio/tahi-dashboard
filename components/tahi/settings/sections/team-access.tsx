'use client'

/**
 * TeamAccessSection - Settings > Team & access.
 *
 * Thin wrapper over the full pane in settings/team-access/pane.tsx: the
 * Team members / Clients / Roles master-detail with role assignment, data
 * scope, feature overrides, the roles matrix, change history, preview-as,
 * and copy-access. The /permissions page renders the same pane, so there is
 * exactly one permissions surface.
 *
 * Admin-only: the settings shell only mounts this for admins, and every API
 * it calls is gated server-side (requireManagePermissions + the
 * settings.permissions feature).
 */

import { TeamAccessPane } from '@/components/tahi/settings/team-access/pane'

export function TeamAccessSection(_props: { isAdmin?: boolean } = {}) {
  return <TeamAccessPane />
}
