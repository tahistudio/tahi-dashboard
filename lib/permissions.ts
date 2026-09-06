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
 * DENY BY DEFAULT: a Tahi-org identity with NO active role assigned sees
 * nothing until a role is granted (it resolves to `team_member` with an EMPTY
 * viewable set, which `decideFeature` treats as "holds no grant"). Nothing
 * means nothing: every nav item, every guarded page (`requirePageFeature` /
 * `requirePageAnyGrant`) and every guarded API route (`requireFeature`) refuse
 * them, including features that carry no role resource of their own. Say it
 * that way in any UI copy too - "no role" is no access, never full admin.
 * Two narrow exceptions, both explicit and both evaluated before the deny path:
 *   - the MCP service token (`api-service`), which has no team_member row by
 *     design and must keep full admin for CLAUDE.md rule 14 parity;
 *   - a workspace with zero active role assignments anywhere (a fresh or
 *     unseeded install), where denying would lock the operator out.
 *
 * The decision core (`decideFeature`) is PURE so it is fully unit-tested.
 */

import { schema } from '@/db/d1'
import { eq, and, or, isNull, inArray } from 'drizzle-orm'
import {
  SERVICE_USER_ID,
  hasAnyActiveRoleAssignment,
  resolveTeamMember,
} from '@/lib/team-identity'
import { resolvePortalRole } from '@/lib/portal-access'
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
  affiliates: 'affiliates',
  announcements: 'announcements',
  // The next six have no rows in the seeded permission catalogue (migrate
  // route seed 0041), so no role baseline can grant them: every team_member
  // is denied unless a feature_visibility allow lifts one. Deny by default
  // per audit finding T1.18.
  billing: 'billing',
  capacity: 'capacity',
  content_studio: 'content_studio',
  social: 'social',
  reviews: 'reviews',
  // Cash, MRR, runway and reserves are studio-private: NOT the same resource as
  // the operational `reports`. Seed 0041 grants reports.view to project_manager
  // and to viewer (which takes every .view row), so sharing the resource would
  // hand a first hire the money screens the moment they get either role. Its own
  // unseeded resource means only admin+ (who pass by level) or an explicit
  // feature_visibility allow can see it.
  financial_reports: 'financial_reports',
  time: 'time_entries',
  reports: 'reports',
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
  /**
   * team_member: the set of resources their roles can .view.
   *   null  = unrestricted (admin+ / client).
   *   empty = holds NO grant at all (no active role): deny everything, including
   *           features that carry no resource mapping. See `decideFeature`.
   */
  viewableResources: Set<string> | null
  /** Precedence-resolved feature_visibility overrides (most-specific subject wins). */
  overrides: Map<string, Effect>
  /**
   * CLIENT AUDIENCE ONLY: which seat this person holds at their own org, read
   * from their `contacts` row with the same predicate the portal routes use
   * (`resolvePortalRole`, lib/portal-access.ts). It is the nav's half of the
   * financial gate: /api/portal/invoices 403s a member seat, so the client rail
   * must not offer them the item.
   *
   * null means UNKNOWN, never "member": a team session, a Tahi admin previewing
   * a client portal (no contact row in that org, and the portal routes let
   * impersonation read), or a client whose contact row has not been linked yet.
   * Callers must therefore hide a financial item on `=== 'member'` only, so an
   * unknown seat fails open exactly like the rest of this resolver.
   *
   * Optional on the type (absent reads the same as null) so the many hand-built
   * ResolvedAccess fixtures across the suite keep compiling; `resolvePermissions`
   * always sets it explicitly on both branches.
   */
  portalRole?: 'admin' | 'member' | null
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
 * True when the caller holds NO permission grant at all: a Tahi-org identity
 * with no active role assignment (its `viewableResources` is an empty Set,
 * never null). This is the deny-by-default marker and it means denied
 * EVERYWHERE - every page, every admin route, every ungated feature key - until
 * an admin grants a role or lifts one feature with an explicit
 * feature_visibility allow.
 *
 * null `viewableResources` is the opposite (unrestricted: admin+, client, the
 * MCP service token, or an unseeded workspace) and returns false here.
 *
 * Pure, so page and route guards can share one definition of "roleless".
 */
export function holdsNoGrant(access: Pick<ResolvedAccess, 'viewableResources'>): boolean {
  return access.viewableResources !== null && access.viewableResources.size === 0
}

/**
 * Decide whether `access` can see `featureKey`. Pure: no DB, fully testable.
 * Order: unknown key -> allow unless the caller holds no grant; wrong audience
 * -> deny; super_admin -> allow; explicit override (most-specific
 * feature/ancestor) -> its effect; no grant -> deny; else default by level
 * (admin/client allow; team_member by role baseline).
 */
export function decideFeature(access: ResolvedAccess, featureKey: string): boolean {
  // An EMPTY viewable set means the caller holds no grant at all (a Tahi-org
  // identity with no active role). Deny by default: not the ungated features
  // (overview, messages, content_studio...), not unknown keys either. Only an
  // explicit feature_visibility allow below can lift a single feature, because
  // that is a deliberate grant rather than a default.
  const noGrant = holdsNoGrant(access)

  const node = getFeatureNode(featureKey)
  if (!node) return !noGrant // not a gateable feature
  if (!node.appliesTo.includes(access.audience)) return false
  if (access.isSuperAdmin) return true

  // Explicit overrides: walk leaf-first so a feature's own rule beats an
  // ancestor's, and a denied ancestor cascades to children with no own rule.
  for (const anc of featureAncestry(featureKey)) {
    const effect = access.overrides.get(anc)
    if (effect) return effect === 'allow'
  }

  if (noGrant) return false
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
 * Resolve whatever org id a caller carries into the D1 `organisations.id` that
 * feature_visibility rows and `contacts.orgId` are keyed on.
 *
 * Two shapes reach the resolver and both must land on the same rows:
 *   - the D1 uuid, from `getPortalAuth` (portal API routes), and
 *   - the raw Clerk org id, from `getServerAuth` (dashboard layout, page guards).
 * One query matching either column covers both; an exact `id` hit wins so an
 * org whose D1 pk happens to equal another org's `clerkOrgId` cannot shadow it.
 * Returns `null` when no org matches, which leaves the caller on the client
 * default (allow) exactly as before this lookup existed.
 */
async function resolveClientOrgId(drizzle: D1, orgId: string): Promise<string | null> {
  const rows = await drizzle
    .select({ id: schema.organisations.id, clerkOrgId: schema.organisations.clerkOrgId })
    .from(schema.organisations)
    .where(or(
      eq(schema.organisations.id, orgId),
      eq(schema.organisations.clerkOrgId, orgId),
    ))
    .limit(2)
  const exact = rows.find(r => r.id === orgId)
  if (exact) return exact.id
  return rows[0]?.id ?? null
}

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
    // Stays null unless we actually read this person's contact row below, so an
    // unresolvable org / an unlinked seat / an impersonating admin reads as
    // UNKNOWN rather than as a member. See ResolvedAccess.portalRole.
    let portalRole: 'admin' | 'member' | null = null
    // The caller's org arrives in one of TWO shapes and both must land on the
    // same rows: portal API routes pass the resolved D1 `organisations.id`
    // (getPortalAuth already looked it up), while the dashboard layout and the
    // page guards pass the RAW CLERK org id (getServerAuth). feature_visibility
    // subject ids and contacts.orgId are keyed on the D1 id only, so resolve it
    // here, once, for both queries below. Without this an org provisioned the
    // modern way (uuid pk + clerkOrgId link) matched nothing on the page path:
    // the nav and the page failed open while the API 403'd, which is a dead
    // surface instead of a hidden one.
    const orgId = auth.orgId ? await resolveClientOrgId(drizzle, auth.orgId) : null
    if (orgId) {
      // Org-level overrides are the baseline for everyone at this org.
      const orgRows = await drizzle
        .select({ featureKey: schema.featureVisibility.featureKey, effect: schema.featureVisibility.effect })
        .from(schema.featureVisibility)
        .where(and(
          eq(schema.featureVisibility.subjectType, 'organisation'),
          eq(schema.featureVisibility.subjectId, orgId),
        ))
      for (const r of orgRows) overrides.set(r.featureKey, r.effect as Effect)

      // Per-contact overrides refine the org baseline for THIS person, most
      // specific wins (contact beats org, exactly like team_member beats role).
      // Resolved by the caller's Clerk user id within their org. An admin
      // previewing a client (impersonation) has no contact row here, so they
      // see the org baseline, never a specific person's refinements.
      //
      // The same row also carries the seat (portalRole / isPrimary), so the
      // financial gate the portal routes apply costs no extra read here.
      if (auth.userId && auth.userId !== SERVICE_USER_ID) {
        const [contact] = await drizzle
          .select({
            id: schema.contacts.id,
            portalRole: schema.contacts.portalRole,
            isPrimary: schema.contacts.isPrimary,
          })
          .from(schema.contacts)
          .where(and(
            eq(schema.contacts.orgId, orgId),
            eq(schema.contacts.clerkUserId, auth.userId),
          ))
          .limit(1)
        if (contact) {
          portalRole = resolvePortalRole(contact)
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
      viewableResources: null, overrides, portalRole,
    }
  }

  // ── Team (Tahi org) ──
  // The MCP service token has no team_member row and is skipped here; it is
  // granted admin explicitly at the level decision below.
  let teamMemberId: string | null = null
  let roleNames: string[] = []
  let roleIds: string[] = []

  if (auth.userId && auth.userId !== SERVICE_USER_ID) {
    const member = await resolveTeamMember(drizzle, auth.userId)
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

  // Level from roles. DENY BY DEFAULT: no active role assignment -> no access.
  // The two exceptions are explicit and evaluated here, never as a fallthrough:
  //   - the MCP service token, which is verified by TAHI_API_TOKEN in
  //     getRequestAuth and intentionally has no team_member row;
  //   - a workspace with no active role assignment ANYWHERE, which means the
  //     roles have not been seeded (fresh install / new environment) rather
  //     than that this person was left unroled. One guarded query, reached only
  //     on the roleless path, so a seeded workspace never pays for it.
  let level: AccessLevel
  if (roleNames.includes(SUPER_ADMIN_ROLE)) level = 'super_admin'
  else if (roleNames.includes(ADMIN_ROLE)) level = 'admin'
  else if (roleNames.length > 0) level = 'team_member'
  else if (auth.userId === SERVICE_USER_ID) level = 'admin'
  else level = (await hasAnyActiveRoleAssignment(drizzle)) ? 'team_member' : 'admin'

  const isSuperAdmin = level === 'super_admin'
  const isAdmin = level === 'super_admin' || level === 'admin'

  // team_member: which resources can they .view? An empty set is the deny-all
  // marker (no role, or roles that grant no .view at all), so this must stay
  // an empty Set and never fall back to null (null = unrestricted).
  let viewableResources: Set<string> | null = null
  if (level === 'team_member') {
    viewableResources = new Set<string>()
    if (roleIds.length > 0) {
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
    // A team identity holds no portal seat: the client rail never renders for
    // them except while previewing, where UNKNOWN is the correct answer.
    viewableResources, overrides, portalRole: null,
  }
}

// ── client (portal) feature check ────────────────────────────────────────────

/**
 * Can this CLIENT see `featureKey`? The single client-side feature_visibility
 * check, so a deny set in the permissions builder is enforced on the data and
 * not only hidden in the nav (audit item T1.18).
 *
 * `orgId` may be EITHER the D1 organisation id (what `getPortalAuth` returns) or
 * the raw Clerk org id (what `getServerAuth` returns): `resolvePermissions`
 * normalises it to the D1 id, which is the `subject_id` the builder writes for
 * an `organisation` row. Per-contact rows refine the org baseline and are
 * resolved inside `resolvePermissions` from the caller's Clerk user id.
 *
 * Client features are ON by default: this returns false only when a row (org or
 * contact) explicitly denies the feature or one of its ancestors, or when the
 * key is not a client-audience feature at all.
 *
 * The route wrapper `requirePortalFeature` (lib/require-feature.ts) adds the
 * 403 plus the studio-side short-circuits; portal routes call that, not this.
 */
export async function clientCanSeeFeature(
  drizzle: D1,
  auth: { userId: string | null; orgId: string | null },
  featureKey: string,
): Promise<boolean> {
  const access = await resolvePermissions(drizzle, auth)
  return decideFeature(access, featureKey)
}
