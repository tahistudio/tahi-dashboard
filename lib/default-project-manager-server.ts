/**
 * lib/default-project-manager-server.ts
 *
 * assignDefaultProjectManager: the one place that writes a project_manager
 * `team_member_access` rule onto a BRAND NEW client, from the studio's default
 * for that engagement type (studio.defaultProjectManagerId.retainer or
 * .project, lib/studio-project-manager.ts). Every surface that creates a
 * client organisation calls this once, right after the organisation row
 * exists:
 *   - POST /api/admin/clients (the New client dialog)
 *   - the ManyRequests importer (lib/import/manyrequests/run.ts)
 *   - POST /api/portal/provision (self-serve onboarding)
 *
 * Deliberately narrow:
 *   - NEVER FAILS CLIENT CREATION. A D1 hiccup, a missing setting, or a
 *     setting naming a team member who no longer exists all degrade to a
 *     silent no-op. Nothing is logged: this is a best-effort default, not a
 *     user-facing action, and a human can always assign a PM by hand
 *     afterwards from the client's Settings tab.
 *   - IDEMPOTENT the way a DEFAULT has to be: if the org already carries a
 *     project_manager rule from ANY source (a manual PUT
 *     /api/admin/clients/{id}/pm assignment, or an earlier call to this same
 *     helper), nothing is written a second time. This is deliberately NOT the
 *     PUT route's behaviour, which replaces the existing rule because a human
 *     chose to; a default must never clobber a real assignment.
 *   - Only ever writes role 'project_manager', scopeType 'specific_clients',
 *     trackType 'all', the same shape PUT .../pm writes, so every reader of
 *     that rule (GET .../pm, the studio lead resolver, the client detail
 *     page) needs no special case for a default-assigned PM versus a manually
 *     assigned one.
 */

import { and, eq, inArray } from 'drizzle-orm'
import { schema } from '@/db/d1'
import {
  defaultProjectManagerSettingKeyFor,
  type ClientEngagementType,
} from '@/lib/studio-project-manager'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export async function assignDefaultProjectManager(
  database: Drizzle,
  orgId: string,
  engagementType: ClientEngagementType,
): Promise<void> {
  if (!orgId) return

  try {
    const key = defaultProjectManagerSettingKeyFor(engagementType)
    const [setting] = await database
      .select({ value: schema.settings.value })
      .from(schema.settings)
      .where(eq(schema.settings.key, key))
      .limit(1)
    const teamMemberId = setting?.value?.trim()
    if (!teamMemberId) return

    // Never a second project_manager rule for this org, no matter who or what
    // wrote the first one.
    const links = await database
      .select({ accessId: schema.teamMemberAccessOrgs.accessId })
      .from(schema.teamMemberAccessOrgs)
      .where(eq(schema.teamMemberAccessOrgs.orgId, orgId))

    if (links.length > 0) {
      const accessIds = links.map((link) => link.accessId)
      const [existingPm] = await database
        .select({ id: schema.teamMemberAccess.id })
        .from(schema.teamMemberAccess)
        .where(and(
          eq(schema.teamMemberAccess.role, 'project_manager'),
          inArray(schema.teamMemberAccess.id, accessIds),
        ))
        .limit(1)
      if (existingPm) return
    }

    // The setting may name a team member who no longer exists; treated
    // exactly like an empty setting, so a stale id never leaves a dangling
    // reference behind.
    const [member] = await database
      .select({ id: schema.teamMembers.id })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.id, teamMemberId))
      .limit(1)
    if (!member) return

    const now = new Date().toISOString()
    const accessId = crypto.randomUUID()
    await database.insert(schema.teamMemberAccess).values({
      id: accessId,
      teamMemberId: member.id,
      role: 'project_manager',
      scopeType: 'specific_clients',
      trackType: 'all',
      createdAt: now,
      updatedAt: now,
    })
    await database.insert(schema.teamMemberAccessOrgs).values({
      accessId,
      orgId,
    })
  } catch {
    // Never fail client creation over a default assignment.
  }
}
