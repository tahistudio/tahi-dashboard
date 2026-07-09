/**
 * lib/permissions.ts - granular permissions resolver (SPECS/granular-permissions.md).
 *
 * Resolves a user to an access LEVEL + a `can(featureKey)` decision, layering:
 *   1. audience (team vs client) from the Clerk org,
 *   2. role grants from #119 (team_member_roles -> roles -> role_permissions),
 *   3. feature_visibility overrides (per team_member / per org / per role),
 * over the FEATURE_TREE manifest.
 *
 * LEVELS (highest to lowest):
 *   super_admin  - every feature, can NEVER be locked out; manages permissions.
 *   admin        - every feature by default; manages permissions; feature_visibility
 *                  deny can hide a feature from them, but they can always unhide it.
 *   team_member  - sees features their role can .view, minus feature_visibility deny.
 *   client       - client-audience features only, ON by default, minus per-org deny.
 *
 * Safe defaults (no lockout): a Tahi-org user with NO role assigned resolves to
 * `admin` (preserves the historical "all Tahi users are admin" behaviour). The
 * MCP service token + a missing team_member row also resolve to admin.
 *
 * The decision core (`decideFeature`) is PURE so it is fully unit-tested.
 */

import { schema } from '@/db/d1'
import { eq, and, isNull, inArray } from 'drizzle-orm'
import {
  FEATURE_TREE,
  getFeatureNode,
  featureAncestry,
  type FeatureAudience,
} from '@/lib/feature-tree'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export type AccessLevel = 'super_admin' | 'admin' | 'team_member' | 'client'
export type Effect = 'allow' | 'deny'

/** Maps a top-level FEATURE_TREE key to the #119 permission `resource` it gates
 *  against (for the team_member role baseline). Keys not listed here are not
 *  gated by the role baseline (only by explicit feature_visibility). */
const FEATURE_RESOURCE: Readonly<Record<string, string>> = {
  requests: 'requests',
  tasks: 'tasks',
  invoices: 'invoices',
  contracts: 'contracts',
  proposals: 'proposals',
  schedules: 'schedules',
  calls: 'calls',
  deals: 'deals',
  leads: 'leads',
  clients: 'organisations',
  calculator: 'calculator',
  sales_analytics: 'sales_analytics',
  time: 'time_entries',
  reports: 'reports',
  financial_reports: 'reports',
  team: 'team',
  settings: 'settings',
  docs: 'docs',
}

export interface ResolvedAccess {
  userId: string | null
  orgId: string | null
  level: AccessLevel
  audience: FeatureAudience
  isSuperAdmin: boolean
  isAdmin: boolean // super_admin OR admin
  /** admin+ may open the permissions builder and toggle features for anyone. */
  canManagePermissions: boolean
  /** team_member: set of resources their role can .view. null = unrestricted (admin+/client). */
  viewableResources: Set<string> | null
  /** Precedence-resolved feature_visibility overrides (most-specific subject wins). */
  overrides: Map<string, Effect>
}

function topAncestor(featureKey: string): string {
  const a = featureAncestry(featureKey)
  return a[a.length - 1] ?? featureKey
}

/** The permission resource a feature gates against, or undefined if ungated. */
export function featureResource(featureKey: string): string | undefined {
  return FEATURE_RESOURCE[topAncestor(featureKey)]
}

// ── pure decision ─────────────────────────────────────────────────────────────

/**
 * Decide whether `access` can see `featureKey`. Pure: no DB, fully testable.
 * Order: unknown key -> allow; wrong audience -> deny; super_admin -> allow;
 * explicit override (most-specific feature/ancestor) -> its effect; else default
 * by level (admin/client allow; team_member by role baseline).
 */
export function decideFeature(access: ResolvedAccess, featureKey: string): boolean {
  const node = getFeatureNode(featureKey)
  if (!node) return true // not a gateable feature
  if (!node.appliesTo.includes(access.audience)) return false
  if (access.isSuperAdmin) return true

  // Explicit overrides: walk leaf-first so a feature's own rule beats an
  // ancestor's, and a denied ancestor cascades to children with no own rule.
  for (const anc of featureAncestry(featureKey)) {
    const effect = access.overrides.get(anc)
    if (effect) return effect === 'allow'
  }

  if (access.level === 'admin' || access.level === 'client') return true

  // team_member: gated by the role's .view baseline for mapped resources.
  const resource = featureResource(featureKey)
  if (!resource) return true
  return access.viewableResources ? access.viewableResources.has(resource) : true
}

/** Convenience bound to a resolved access object. */
export function can(access: ResolvedAccess, featureKey: string): boolean {
  return decideFeature(access, featureKey)
}

/** Decide every FEATURE_TREE key for this access - sent to the client so the
 *  sidebar + <Gate> can hide features without re-querying per node. */
export function featureMap(access: ResolvedAccess): Record<string, boolean> {
  const map: Record<string, boolean> = {}
  for (const node of FEATURE_TREE) map[node.key] = decideFeature(access, node.key)
  return map
}

// ── workspace module toggles ────────────────────────────────────────────────
//
// The settings Modules tab (components/tahi/settings/sections/modules.tsx) saves
// a `module_<key>_enabled` row per module ('true' | 'false', default enabled
// when unset). A disabled module hides its mapped FEATURE_TREE nav feature(s)
// for EVERYONE except super-admins (who must keep every feature so they can
// always re-enable a module). Server-side resolution: the layout folds these
// into the feature map it passes to the sidebar; nothing is hidden client-side.

/** Module key (as saved by the Modules tab) -> the FEATURE_TREE keys it gates. */
export const MODULE_FEATURE_MAP: Readonly<Record<string, ReadonlyArray<string>>> = {
  requests: ['requests'],
  messaging: ['messages'],
  billing: ['billing'],
  time_tracking: ['time'],
  reports: ['reports'],
  files: ['files'],
  services: ['services'],
}

/** The settings-store key for a module toggle. Mirrors modules.tsx settingKey(). */
export function moduleSettingKey(moduleKey: string): string {
  return `module_${moduleKey}_enabled`
}

/** Every `module_<key>_enabled` setting key - the exact rows the layout reads. */
export const MODULE_SETTING_KEYS: ReadonlyArray<string> =
  Object.keys(MODULE_FEATURE_MAP).map(moduleSettingKey)

/**
 * Fold workspace module toggles into a resolved feature map. A module whose
 * `module_<key>_enabled` setting is exactly 'false' turns its mapped feature(s)
 * OFF for everyone EXCEPT super-admins. Any other value (including unset) leaves
 * the feature untouched. Pure - the caller supplies the settings map - so it is
 * fully testable and never touches the DB.
 *
 * SCOPE (deliberate): module toggles are a NAV-DECLUTTER control, not a
 * security boundary. They hide a module from the sidebar/mobile nav feature
 * map; deep links and API routes for a disabled module remain reachable.
 * Security-grade denial is the job of roles + feature_visibility +
 * requireFeature, which are enforced server-side per route.
 */
export function applyModuleGates(
  features: Record<string, boolean>,
  settings: Record<string, string | null | undefined>,
  isSuperAdmin: boolean,
): Record<string, boolean> {
  if (isSuperAdmin) return features
  const next = { ...features }
  for (const [moduleKey, featureKeys] of Object.entries(MODULE_FEATURE_MAP)) {
    if (settings[moduleSettingKey(moduleKey)] === 'false') {
      for (const fk of featureKeys) next[fk] = false
    }
  }
  return next
}

// ── DB loader ─────────────────────────────────────────────────────────────────

const SUPER_ADMIN_ROLE = 'super_admin'
const ADMIN_ROLE = 'admin'

/**
 * Resolve a Clerk (userId, orgId) into a full access object. Reads team
 * membership, roles, role permissions, and feature_visibility overrides.
 */
export async function resolvePermissions(
  drizzle: D1,
  auth: { userId: string | null; orgId: string | null },
): Promise<ResolvedAccess> {
  const tahiOrgId = process.env.NEXT_PUBLIC_TAHI_ORG_ID
  const isTeam = !!(tahiOrgId && auth.orgId === tahiOrgId)
  const audience: FeatureAudience = isTeam ? 'team' : 'client'

  // ── Client ──
  if (!isTeam) {
    const overrides = new Map<string, Effect>()
    if (auth.orgId) {
      // Org-level overrides are the baseline for everyone at this org.
      const orgRows = await drizzle
        .select({ featureKey: schema.featureVisibility.featureKey, effect: schema.featureVisibility.effect })
        .from(schema.featureVisibility)
        .where(and(
          eq(schema.featureVisibility.subjectType, 'organisation'),
          eq(schema.featureVisibility.subjectId, auth.orgId),
        ))
      for (const r of orgRows) overrides.set(r.featureKey, r.effect as Effect)

      // Per-contact overrides refine the org baseline for THIS person, most
      // specific wins (contact beats org, exactly like team_member beats role).
      // Resolved by the caller's Clerk user id within their org. An admin
      // previewing a client (impersonation) has no contact row here, so they
      // see the org baseline, never a specific person's refinements.
      if (auth.userId && auth.userId !== 'api-service') {
        const [contact] = await drizzle
          .select({ id: schema.contacts.id })
          .from(schema.contacts)
          .where(and(
            eq(schema.contacts.orgId, auth.orgId),
            eq(schema.contacts.clerkUserId, auth.userId),
          ))
          .limit(1)
        if (contact) {
          const contactRows = await drizzle
            .select({ featureKey: schema.featureVisibility.featureKey, effect: schema.featureVisibility.effect })
            .from(schema.featureVisibility)
            .where(and(
              eq(schema.featureVisibility.subjectType, 'contact'),
              eq(schema.featureVisibility.subjectId, contact.id),
            ))
          for (const r of contactRows) overrides.set(r.featureKey, r.effect as Effect) // most specific
        }
      }
    }
    return {
      userId: auth.userId, orgId: auth.orgId, level: 'client', audience,
      isSuperAdmin: false, isAdmin: false, canManagePermissions: false,
      viewableResources: null, overrides,
    }
  }

  // ── Team (Tahi org) ──
  // The MCP service token has no team_member row -> full admin.
  let teamMemberId: string | null = null
  let roleNames: string[] = []
  let roleIds: string[] = []

  if (auth.userId && auth.userId !== 'api-service') {
    const [member] = await drizzle
      .select({ id: schema.teamMembers.id })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.clerkUserId, auth.userId))
      .limit(1)
    teamMemberId = member?.id ?? null

    if (teamMemberId) {
      const roleRows = await drizzle
        .select({ roleId: schema.teamMemberRoles.roleId, name: schema.roles.name })
        .from(schema.teamMemberRoles)
        .innerJoin(schema.roles, eq(schema.teamMemberRoles.roleId, schema.roles.id))
        .where(and(
          eq(schema.teamMemberRoles.teamMemberId, teamMemberId),
          isNull(schema.teamMemberRoles.endedAt),
        ))
      roleNames = roleRows.map(r => r.name)
      roleIds = roleRows.map(r => r.roleId)
    }
  }

  // Level from roles. No roles assigned -> admin (no lockout).
  let level: AccessLevel
  if (roleNames.includes(SUPER_ADMIN_ROLE)) level = 'super_admin'
  else if (roleNames.includes(ADMIN_ROLE)) level = 'admin'
  else if (roleNames.length > 0) level = 'team_member'
  else level = 'admin'

  const isSuperAdmin = level === 'super_admin'
  const isAdmin = level === 'super_admin' || level === 'admin'

  // team_member: which resources can they .view?
  let viewableResources: Set<string> | null = null
  if (level === 'team_member' && roleIds.length > 0) {
    const perms = await drizzle
      .select({ resource: schema.permissions.resource })
      .from(schema.rolePermissions)
      .innerJoin(schema.permissions, eq(schema.rolePermissions.permissionId, schema.permissions.id))
      .where(and(
        inArray(schema.rolePermissions.roleId, roleIds),
        eq(schema.permissions.action, 'view'),
      ))
    viewableResources = new Set(perms.map(p => p.resource))
  }

  // Overrides: team_member-specific wins over role-level.
  const overrides = new Map<string, Effect>()
  if (roleIds.length > 0) {
    const roleRows = await drizzle
      .select({ featureKey: schema.featureVisibility.featureKey, effect: schema.featureVisibility.effect })
      .from(schema.featureVisibility)
      .where(and(
        eq(schema.featureVisibility.subjectType, 'role'),
        inArray(schema.featureVisibility.subjectId, roleIds),
      ))
    // A deny from any role wins over an allow from another role.
    for (const r of roleRows) {
      const prev = overrides.get(r.featureKey)
      if (prev === 'deny') continue
      overrides.set(r.featureKey, r.effect as Effect)
    }
  }
  if (teamMemberId) {
    const memberRows = await drizzle
      .select({ featureKey: schema.featureVisibility.featureKey, effect: schema.featureVisibility.effect })
      .from(schema.featureVisibility)
      .where(and(
        eq(schema.featureVisibility.subjectType, 'team_member'),
        eq(schema.featureVisibility.subjectId, teamMemberId),
      ))
    for (const r of memberRows) overrides.set(r.featureKey, r.effect as Effect) // most specific
  }

  return {
    userId: auth.userId, orgId: auth.orgId, level, audience,
    isSuperAdmin, isAdmin, canManagePermissions: isAdmin,
    viewableResources, overrides,
  }
}
