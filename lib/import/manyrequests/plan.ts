/**
 * lib/import/manyrequests/plan.ts
 *
 * The diff engine and the per-entity plan builders. Every function here is
 * PURE: it takes a snapshot of the relevant D1 rows plus the ManyRequests
 * payload and returns a plan. It cannot write, cannot fetch and cannot mail,
 * which is what makes "dry run writes nothing" a property of the code rather
 * than a promise about a code path.
 *
 * The plan is the reviewable artefact. Everything the apply would do appears
 * in it, including the rows it refuses and the source fields that have no D1
 * column, so the dry run is a complete answer rather than a summary.
 */

import {
  buildFormResponses,
  commentKey,
  externalKey,
  extractRequestBrief,
  invoiceItemKey,
  mapBillingInterval,
  mapInvoiceMoney,
  mapInvoicePaidAt,
  mapInvoiceStatus,
  mapOrgStatus,
  mapPlanType,
  mapRequestPriority,
  mapRequestStatus,
  mapSubscriptionStatus,
  normaliseCurrency,
  normaliseDate,
  normaliseEmail,
  normaliseNumber,
  normaliseTimestamp,
  refId,
  refName,
  resolveCommentAuthor,
  subscriptionKey,
  unescapeHtmlEntities,
  type ClosedRuling,
} from './map'
import type {
  EntityPlan,
  ImportEntity,
  MrBrand,
  MrClient,
  MrInvoice,
  MrOrganization,
  MrRequest,
  MrService,
  MrSubscription,
  PlannedDelete,
  PlannedInsert,
  PlannedUpdate,
  SkippedRow,
} from './types'

// ── the D1 snapshot the planners read ────────────────────────────────────────

export interface SnapshotOrg {
  id: string
  name: string
  status: string | null
  manyrequestsId: string | null
  mrHoursRemaining: number | null
  mrHoursPurchased: number | null
}

export interface SnapshotContact {
  id: string
  orgId: string
  name: string
  email: string
  isPrimary: boolean | null
  portalRole: string | null
  clerkUserId: string | null
  manyrequestsId: string | null
}

export interface SnapshotTeamMember {
  id: string
  name: string
  email: string
  title: string | null
  manyrequestsId: string | null
}

export interface SnapshotRole {
  id: string
  name: string
}

export interface SnapshotTeamMemberRole {
  id: string
  teamMemberId: string
  roleId: string
  endedAt: string | null
}

export interface SnapshotBrand {
  id: string
  orgId: string
  name: string
  manyrequestsId: string | null
}

export interface SnapshotService {
  id: string
  name: string
  manyrequestsId: string | null
  price: number | null
  currency: string | null
  isRecurring: number | null
}

export interface SnapshotSubscription {
  id: string
  orgId: string
  planType: string | null
  status: string | null
  billingInterval: string | null
  manyrequestsId: string | null
  mrServiceName: string | null
  hoursPerPeriod: number | null
  creditsPerPeriod: number | null
  billedContactId: string | null
}

export interface SnapshotRequest {
  id: string
  orgId: string
  title: string
  status: string | null
  priority: string | null
  assigneeId: string | null
  requestNumber: number | null
  dueDate: string | null
  deliveredAt: string | null
  estimatedHours: number | null
  brandId: string | null
  description: string | null
  formResponses: string | null
  submittedById: string | null
  submittedByType: string | null
  manyrequestsId: string | null
}

export interface SnapshotMessage {
  id: string
  manyrequestsId: string | null
}

export interface SnapshotInvoice {
  id: string
  orgId: string
  status: string | null
  currency: string | null
  amountUsd: number | null
  totalUsd: number | null
  taxAmountUsd: number | null
  discountAmountUsd: number | null
  paidAt: string | null
  source: string | null
  manyrequestsId: string | null
}

export interface SnapshotInvoiceItem {
  id: string
  invoiceId: string
  description: string
  quantity: number | null
  unitPriceUsd: number | null
  totalUsd: number | null
  manyrequestsId: string | null
}

export interface ImportSnapshot {
  orgs: SnapshotOrg[]
  contacts: SnapshotContact[]
  teamMembers: SnapshotTeamMember[]
  roles: SnapshotRole[]
  teamMemberRoles: SnapshotTeamMemberRole[]
  brands: SnapshotBrand[]
  services: SnapshotService[]
  subscriptions: SnapshotSubscription[]
  requests: SnapshotRequest[]
  messages: SnapshotMessage[]
  invoices: SnapshotInvoice[]
  invoiceItems: SnapshotInvoiceItem[]
}

/** The source payload a plan builder needs, already fetched. */
export interface ImportSource {
  organizations: MrOrganization[]
  /** Keyed by the ManyRequests organization id. */
  membersByOrg: Record<string, MrClient[]>
  brandsByOrg: Record<string, MrBrand[]>
  subscriptionsByOrg: Record<string, MrSubscription[]>
  services: MrService[]
  requests: MrRequest[]
  invoices: MrInvoice[]
}

export interface PlanOptions {
  /** What a ManyRequests 'Closed' request becomes. Liam's ruling. */
  closedAs: ClosedRuling
  /** ISO cutoff. Source rows created before it are skipped, not imported. */
  since: string | null
  /** Now, injectable so a plan is deterministic under test. */
  now: string
}

export const DEFAULT_PLAN_OPTIONS: PlanOptions = {
  closedAs: 'cancelled',
  since: null,
  now: '1970-01-01T00:00:00.000Z',
}

// ── the diff ─────────────────────────────────────────────────────────────────

function emptyPlan(entity: ImportEntity, table: string): EntityPlan {
  return { entity, table, toInsert: [], toUpdate: [], toDelete: [], unchanged: 0, skipped: [], unmapped: [] }
}

/**
 * Equal enough to leave alone. D1 hands booleans back as booleans through
 * Drizzle's boolean mode but integers through a raw select, and a number that
 * round-trips through JSON can arrive as a string, so all three are compared on
 * their normalised value rather than by identity.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  const left = a === undefined ? null : a
  const right = b === undefined ? null : b
  if (left === null || right === null) return left === right
  if (typeof left === 'boolean' || typeof right === 'boolean') {
    return Boolean(left) === Boolean(right)
  }
  if (typeof left === 'number' || typeof right === 'number') {
    const ln = typeof left === 'number' ? left : Number(left)
    const rn = typeof right === 'number' ? right : Number(right)
    if (Number.isFinite(ln) && Number.isFinite(rn)) return ln === rn
  }
  return String(left) === String(right)
}

/**
 * The fields of `desired` that differ from `existing`. Only the keys listed in
 * `updatable` are ever considered, which is how D1-native truth (a Xero
 * contact id, a hand-set MRR, a health note) is protected on a re-run: it is
 * simply not in the list.
 */
export function diffFields(
  existing: Record<string, unknown>,
  desired: Record<string, unknown>,
  updatable: readonly string[],
): Record<string, unknown> {
  const changes: Record<string, unknown> = {}
  for (const key of updatable) {
    if (!(key in desired)) continue
    if (!sameValue(existing[key], desired[key])) changes[key] = desired[key]
  }
  return changes
}

interface DiffRow {
  manyrequestsId: string
  label: string
  values: Record<string, unknown>
  table?: string
}

/** Fold one source row into a plan: insert, update, or leave alone. */
function foldRow(
  plan: EntityPlan,
  row: DiffRow,
  existing: { id: string; row: Record<string, unknown> } | undefined,
  updatable: readonly string[],
  stampUpdatedAt: string | null,
): void {
  if (!existing) {
    plan.toInsert.push({ manyrequestsId: row.manyrequestsId, label: row.label, values: row.values, table: row.table })
    return
  }
  const changes = diffFields(existing.row, row.values, updatable)
  if (Object.keys(changes).length === 0) {
    plan.unchanged += 1
    return
  }
  if (stampUpdatedAt) changes.updatedAt = stampUpdatedAt
  plan.toUpdate.push({
    id: existing.id,
    manyrequestsId: row.manyrequestsId,
    label: row.label,
    changes,
    table: row.table,
  })
}

function indexByKey<T extends { id: string; manyrequestsId: string | null }>(
  rows: readonly T[],
): Map<string, { id: string; row: Record<string, unknown> }> {
  const map = new Map<string, { id: string; row: Record<string, unknown> }>()
  for (const row of rows) {
    if (row.manyrequestsId) map.set(row.manyrequestsId, { id: row.id, row: row as unknown as Record<string, unknown> })
  }
  return map
}

function beforeCutoff(createdAt: unknown, since: string | null): boolean {
  if (!since) return false
  const iso = normaliseTimestamp(createdAt)
  if (!iso) return false
  return iso < since
}

// ── team ─────────────────────────────────────────────────────────────────────

export interface TeamSeed {
  manyrequestsId: string
  name: string
  /** The tahi.studio address the D1 row is matched on. */
  email: string
  title: string
  /** The `roles.name` this person must hold an active assignment for. */
  roleName: string
  /** When false the import only ever stamps manyrequestsId on this person. */
  correctName: boolean
}

/**
 * The three ManyRequests team members, and exactly what the import may change
 * about each. This list is the whole roster: Liam and Staci are the studio (see
 * the standing rule not to invent team members), Nathan is the contractor whose
 * replies make up most of the recent client-facing activity.
 *
 * Liam is name-frozen: his D1 row is correct, Clerk-linked and the one identity
 * the permission resolver falls back on, so the import only stamps his
 * manyrequestsId. Staci's D1 name is wrong ("Staci Orchard" appears nowhere
 * else) and is corrected to the professional byline. Nathan does not exist in
 * D1 at all and is created.
 *
 * NO INVITE, NO CLERK CALL, NO EMAIL. These are rows. Nathan links his own
 * Clerk identity the first time he signs in.
 */
export const MANYREQUESTS_TEAM: readonly TeamSeed[] = [
  {
    manyrequestsId: '1',
    name: 'Liam Miller',
    email: 'business@tahi.studio',
    title: 'Founder',
    roleName: 'super_admin',
    correctName: false,
  },
  {
    manyrequestsId: '19',
    name: 'Staci Bonnie',
    email: 'staci@tahi.studio',
    title: 'Designer',
    roleName: 'super_admin',
    correctName: true,
  },
  {
    manyrequestsId: '83',
    name: 'Nathan Day',
    email: 'nathan@tahi.studio',
    title: 'Developer',
    // There is no 'dev' role in the roles table. task_handler is the closest
    // seeded role and already reads "Executes assigned work. Own tasks,
    // comment on requests, log time." A dedicated developer role is a
    // permissions-builder change, not an import change.
    roleName: 'task_handler',
    correctName: true,
  },
]

const TEAM_UPDATABLE = ['manyrequestsId', 'name', 'title'] as const
const TEAM_UPDATABLE_ID_ONLY = ['manyrequestsId'] as const

export function planTeam(snapshot: ImportSnapshot, options: PlanOptions): EntityPlan {
  const plan = emptyPlan('team', 'team_members')
  const byKey = indexByKey(snapshot.teamMembers)
  const byEmail = new Map<string, SnapshotTeamMember>()
  for (const member of snapshot.teamMembers) {
    const email = normaliseEmail(member.email)
    if (email) byEmail.set(email, member)
  }
  const roleIdByName = new Map(snapshot.roles.map((role) => [role.name, role.id]))
  const activeRoleKeys = new Set(
    snapshot.teamMemberRoles
      .filter((row) => row.endedAt === null)
      .map((row) => `${row.teamMemberId}::${row.roleId}`),
  )

  for (const seed of MANYREQUESTS_TEAM) {
    const existing = byKey.get(seed.manyrequestsId) ?? null
    const matched = existing
      ? snapshot.teamMembers.find((member) => member.id === existing.id) ?? null
      : byEmail.get(seed.email) ?? null

    const desired: Record<string, unknown> = seed.correctName
      ? { manyrequestsId: seed.manyrequestsId, name: seed.name, title: seed.title }
      : { manyrequestsId: seed.manyrequestsId }

    if (matched) {
      foldRow(
        plan,
        { manyrequestsId: seed.manyrequestsId, label: seed.name, values: desired },
        { id: matched.id, row: matched as unknown as Record<string, unknown> },
        seed.correctName ? TEAM_UPDATABLE : TEAM_UPDATABLE_ID_ONLY,
        options.now,
      )
    } else {
      plan.toInsert.push({
        manyrequestsId: seed.manyrequestsId,
        label: seed.name,
        values: {
          name: seed.name,
          email: seed.email,
          title: seed.title,
          // The `role` column is the legacy admin/member flag. Authority comes
          // from team_member_roles, which is the row planned below.
          role: 'member',
          manyrequestsId: seed.manyrequestsId,
          // NEVER set. A team member links their own Clerk identity on first
          // sign-in (lib/team-link-server.ts); writing one here would be
          // inventing an account.
          clerkUserId: null,
          createdAt: options.now,
          updatedAt: options.now,
        },
      })
    }

    // The role assignment. Without it lib/permissions.ts resolves a new team
    // member to `team_member` with an empty viewable-resource set, which is
    // deny-all: Nathan would be created and locked out in the same breath.
    const roleId = roleIdByName.get(seed.roleName)
    if (!roleId) {
      plan.skipped.push({
        manyrequestsId: seed.manyrequestsId,
        label: `${seed.name} role assignment`,
        reason: `No role named "${seed.roleName}" exists. Seed the roles table (migration 0039) before importing the team.`,
      })
      continue
    }
    if (matched && activeRoleKeys.has(`${matched.id}::${roleId}`)) {
      plan.unchanged += 1
      continue
    }
    plan.toInsert.push({
      manyrequestsId: `mr:team-role:${seed.manyrequestsId}:${seed.roleName}`,
      label: `${seed.name} -> ${seed.roleName}`,
      table: 'team_member_roles',
      values: {
        // The team member id is resolved at apply time: on a first run the
        // person does not exist yet and has no id to point at.
        __teamMemberEmail: seed.email,
        roleId,
        startedAt: options.now,
        endedAt: null,
        createdAt: options.now,
      },
    })
  }

  return plan
}

// ── organisations ────────────────────────────────────────────────────────────

/**
 * The only organisation fields the import may write on a row that already
 * exists. Everything absent from this list is D1-native truth the old system
 * never held and must survive the merge untouched: xeroContactId,
 * stripeCustomerId, clerkOrgId, invoiceChannel, paymentTerms, healthStatus,
 * healthNote, internalNotes, tags, accentColour, preferredCurrency,
 * defaultHourlyRate, tracksMode, and the raw-SQL columns Drizzle does not even
 * see (custom_mrr, billing_model, retainer dates).
 *
 * `name` is absent on purpose: D1's names are better ("Telcom Networks Limited
 * trading as Elevate" against ManyRequests' "Elevate").
 */
const ORG_UPDATABLE = ['manyrequestsId', 'mrHoursRemaining', 'mrHoursPurchased', 'status'] as const

/** The hand-made name matches. None of the 15 overlapping orgs match exactly,
 *  so the mapping is stated rather than guessed at by a fuzzy comparison that
 *  could silently attach a client's history to the wrong company. */
export const ORG_NAME_MATCHES: Readonly<Record<string, string>> = {
  '3': 'Glasswall Solutions Ltd',
  '4': 'Greyhive',
  '5': 'Physitrack',
  '6': 'DANTE MEDIA OU',
  '7': 'Telcom Networks Limited trading as Elevate',
  '10': 'BCS Consultancy',
  '17': 'Axis Creative',
  '47': 'Spot Digital',
  '48': 'Stride',
  '49': 'Tahi Studio (internal)',
  '50': 'Racquet Club',
  '52': 'Fluvial',
  '53': 'The Longevity Edit',
  '54': 'Giant Group',
  '55': 'Charles Bilash',
}

/** ManyRequests orgs the import refuses on sight, with the reason. */
export const ORG_SKIP: Readonly<Record<string, string>> = {
  '46': 'Empty self-signup shell (SA Design\'s Organization): zero members, zero requests, zero invoices. Import it only if Liam asks for the shell.',
}

export function planOrganisations(
  source: ImportSource,
  snapshot: ImportSnapshot,
  options: PlanOptions,
): EntityPlan {
  const plan = emptyPlan('organisations', 'organisations')
  plan.unmapped.push(
    'ManyRequests members_count has no D1 column; it is derived from the contacts table instead.',
  )

  const byKey = indexByKey(snapshot.orgs)
  const byName = new Map<string, SnapshotOrg>()
  for (const org of snapshot.orgs) byName.set(org.name.trim().toLowerCase(), org)

  for (const org of source.organizations) {
    const key = externalKey(org.id)
    const label = org.name ?? `organization ${String(org.id)}`
    if (!key) {
      plan.skipped.push({ manyrequestsId: null, label, reason: 'Source row has no id.' })
      continue
    }
    const refuse = ORG_SKIP[key]
    if (refuse) {
      plan.skipped.push({ manyrequestsId: key, label, reason: refuse })
      continue
    }
    if (beforeCutoff(org.created_at, options.since)) {
      plan.skipped.push({ manyrequestsId: key, label, reason: `Created before the since cutoff ${options.since}.` })
      continue
    }

    const balance = org.balance ?? null
    const remaining = normaliseNumber(balance?.hours)
    const purchased = normaliseNumber(balance?.purchased_hours ?? balance?.hours_purchased)
    const sourceStatus = mapOrgStatus(org.subscription_status)

    const existingByKey = byKey.get(key)
    const matchedName = ORG_NAME_MATCHES[key]
    const matched = existingByKey
      ? snapshot.orgs.find((row) => row.id === existingByKey.id) ?? null
      : matchedName
        ? byName.get(matchedName.trim().toLowerCase()) ?? null
        : null

    if (!matched) {
      plan.toInsert.push({
        manyrequestsId: key,
        label,
        values: {
          name: label,
          status: sourceStatus,
          manyrequestsId: key,
          mrHoursRemaining: remaining,
          mrHoursPurchased: purchased,
          // NEVER set: an imported org holds no Clerk workspace, which is what
          // keeps every notification helper unable to resolve a human on it.
          clerkOrgId: null,
          createdAt: normaliseTimestamp(org.created_at) ?? options.now,
          updatedAt: options.now,
        },
      })
      continue
    }

    const desired: Record<string, unknown> = {
      manyrequestsId: key,
      mrHoursRemaining: remaining,
      mrHoursPurchased: purchased,
    }
    // Status is only ever REOPENED, never closed. A D1 row sitting at archived
    // or prospect while ManyRequests still shows a live retainer is the
    // Greyhive case (an active 20h plan and an unpaid GBP 1279.67 invoice); a
    // client D1 already calls active, paused or churned keeps the state a human
    // set, because the old system's subscription flag is not the authority on
    // a relationship this side already tracks.
    if ((matched.status === 'archived' || matched.status === 'prospect') && sourceStatus === 'active') {
      desired.status = sourceStatus
    }

    foldRow(
      plan,
      { manyrequestsId: key, label, values: desired },
      { id: matched.id, row: matched as unknown as Record<string, unknown> },
      ORG_UPDATABLE,
      options.now,
    )
  }

  return plan
}

// ── contacts ─────────────────────────────────────────────────────────────────

const CONTACT_UPDATABLE = ['manyrequestsId', 'name', 'isPrimary', 'portalRole'] as const

/**
 * A real client org carrying a fake contact address. Elevate has 14 Xero
 * invoices and a 1000 MRR against a single contact at andrew@test.com; the
 * import replaces that address with the real ManyRequests member rather than
 * leaving a live client whose only mailbox goes nowhere.
 */
export const CONTACT_EMAIL_REPLACEMENTS: Readonly<Record<string, string>> = {
  'andrew@test.com': 'andrew.stout@elevate.uk',
}

export function planContacts(
  source: ImportSource,
  snapshot: ImportSnapshot,
  options: PlanOptions,
): EntityPlan {
  const plan = emptyPlan('contacts', 'contacts')
  plan.unmapped.push(
    'clerkUserId is deliberately never written. It is the field that makes a notification resolve to a human, so every imported contact stays unlinked and provably unreachable.',
  )

  // Orgs this same run is about to create are already in the snapshot: a dry
  // run projects each entity's plan forward (projectPlan below) so a downstream
  // planner sees the world the apply would build, and an apply re-reads D1
  // between entities so it sees the rows that were actually written.
  const orgIdByKey = new Map<string, string>()
  for (const org of snapshot.orgs) if (org.manyrequestsId) orgIdByKey.set(org.manyrequestsId, org.id)

  const byKey = indexByKey(snapshot.contacts)
  const byEmail = new Map<string, SnapshotContact>()
  for (const contact of snapshot.contacts) {
    const email = normaliseEmail(contact.email)
    if (email && !byEmail.has(email)) byEmail.set(email, contact)
  }

  for (const org of source.organizations) {
    const orgKey = externalKey(org.id)
    if (!orgKey || ORG_SKIP[orgKey]) continue
    const orgId = orgIdByKey.get(orgKey)
    const members = source.membersByOrg[orgKey] ?? []
    const ownerKey = refId(org.owner)

    for (const member of members) {
      const key = externalKey(member.id)
      const rawEmail = normaliseEmail(member.email)
      const email = rawEmail ? CONTACT_EMAIL_REPLACEMENTS[rawEmail] ?? rawEmail : null
      const label = member.name ?? email ?? `client ${String(member.id)}`
      if (!key) {
        plan.skipped.push({ manyrequestsId: null, label, reason: 'Source row has no id.' })
        continue
      }
      if (!orgId) {
        plan.skipped.push({
          manyrequestsId: key,
          label,
          reason: `Its organisation (ManyRequests ${orgKey}) is not in D1 and is not being created. Run the organisations entity first.`,
        })
        continue
      }
      if (!email) {
        plan.skipped.push({ manyrequestsId: key, label, reason: 'No email address on the source row.' })
        continue
      }

      const isOwner = member.is_owner === true || (ownerKey !== null && ownerKey === key)
      const existingByKey = byKey.get(key)
      const matched = existingByKey
        ? snapshot.contacts.find((row) => row.id === existingByKey.id) ?? null
        : byEmail.get(email) ?? null

      const desired: Record<string, unknown> = {
        manyrequestsId: key,
        name: member.name ?? label,
        isPrimary: isOwner,
        portalRole: isOwner ? 'admin' : 'member',
      }

      if (!matched) {
        plan.toInsert.push({
          manyrequestsId: key,
          label,
          values: {
            ...desired,
            orgId,
            email,
            clerkUserId: null,
            createdAt: normaliseTimestamp(member.created_at) ?? options.now,
            updatedAt: options.now,
          },
        })
        continue
      }

      // Adopting a D1 contact never demotes them. A person who is already the
      // portal admin on this side stays one even if ManyRequests does not call
      // them the owner, because portalRole is the client-admin authority and
      // the old system has no equivalent concept of a workspace admin.
      if (matched.portalRole === 'admin') {
        desired.portalRole = 'admin'
        desired.isPrimary = matched.isPrimary ?? isOwner
      }

      foldRow(
        plan,
        { manyrequestsId: key, label, values: desired },
        { id: matched.id, row: matched as unknown as Record<string, unknown> },
        CONTACT_UPDATABLE,
        options.now,
      )
    }
  }

  return plan
}

// ── brands ───────────────────────────────────────────────────────────────────

const BRAND_UPDATABLE = ['manyrequestsId', 'name'] as const

export function planBrands(
  source: ImportSource,
  snapshot: ImportSnapshot,
  options: PlanOptions,
): EntityPlan {
  const plan = emptyPlan('brands', 'brands')
  plan.unmapped.push(
    'organisations.brands (the legacy JSON column) is left untouched. requests.brandId can only point at the brands TABLE, so that is the one representation the import writes.',
  )

  const orgIdByKey = new Map<string, string>()
  for (const org of snapshot.orgs) if (org.manyrequestsId) orgIdByKey.set(org.manyrequestsId, org.id)

  const byKey = indexByKey(snapshot.brands)

  for (const org of source.organizations) {
    const orgKey = externalKey(org.id)
    if (!orgKey || ORG_SKIP[orgKey]) continue
    const orgId = orgIdByKey.get(orgKey)
    for (const brand of source.brandsByOrg[orgKey] ?? []) {
      const key = externalKey(brand.id)
      const label = brand.name ?? `brand ${String(brand.id)}`
      if (!key) {
        plan.skipped.push({ manyrequestsId: null, label, reason: 'Source row has no id.' })
        continue
      }
      if (!orgId) {
        plan.skipped.push({
          manyrequestsId: key,
          label,
          reason: `Its organisation (ManyRequests ${orgKey}) is not in D1 yet. Run the organisations entity first.`,
        })
        continue
      }
      const desired = { manyrequestsId: key, name: brand.name ?? label }
      const existing = byKey.get(key)
      if (!existing) {
        plan.toInsert.push({
          manyrequestsId: key,
          label,
          values: {
            ...desired,
            orgId,
            website: brand.website ?? null,
            logoUrl: brand.logo_url ?? null,
            createdAt: options.now,
            updatedAt: options.now,
          },
        })
        continue
      }
      foldRow(plan, { manyrequestsId: key, label, values: desired }, existing, BRAND_UPDATABLE, options.now)
    }
  }

  return plan
}

// ── services ─────────────────────────────────────────────────────────────────

const SERVICE_UPDATABLE = ['manyrequestsId', 'name', 'description', 'price', 'currency', 'isRecurring'] as const

export function planServices(
  source: ImportSource,
  snapshot: ImportSnapshot,
  options: PlanOptions,
): EntityPlan {
  const plan = emptyPlan('services', 'services')
  plan.unmapped.push(
    'pricing_variations[] has no D1 home. Only the headline price lands; the per-period variations stay in ManyRequests.',
  )

  const byKey = indexByKey(snapshot.services)

  for (const service of source.services) {
    const key = externalKey(service.id)
    const label = service.name ?? `service ${String(service.id)}`
    if (!key) {
      plan.skipped.push({ manyrequestsId: null, label, reason: 'Source row has no id.' })
      continue
    }
    const recurring = (service.type ?? '').trim().toLowerCase() === 'recurring'
    const desired: Record<string, unknown> = {
      manyrequestsId: key,
      name: service.name ?? label,
      description: service.description ?? null,
      // services.price is documented as cents; ManyRequests quotes whole
      // units, so it is scaled once here rather than in every reader.
      price: Math.round((normaliseNumber(service.price) ?? 0) * 100),
      currency: normaliseCurrency(service.currency, 'USD'),
      isRecurring: recurring ? 1 : 0,
    }
    const existing = byKey.get(key)
    if (!existing) {
      plan.toInsert.push({
        manyrequestsId: key,
        label,
        values: {
          ...desired,
          recurringInterval: recurring ? 'month' : null,
          // Only three of the 18 are is_for_sale upstream, and the client
          // catalogue is a separate decision. Everything lands hidden.
          showInCatalog: 0,
          category: recurring ? 'service' : 'addon',
          createdAt: options.now,
          updatedAt: options.now,
        },
      })
      continue
    }
    foldRow(plan, { manyrequestsId: key, label, values: desired }, existing, SERVICE_UPDATABLE, options.now)
  }

  return plan
}

// ── subscriptions ────────────────────────────────────────────────────────────

const SUBSCRIPTION_UPDATABLE = [
  'manyrequestsId',
  'status',
  'billingInterval',
  'planType',
  'mrServiceName',
  'hoursPerPeriod',
  'creditsPerPeriod',
  'billedContactId',
] as const

export function planSubscriptions(
  source: ImportSource,
  snapshot: ImportSnapshot,
  options: PlanOptions,
): EntityPlan {
  const plan = emptyPlan('subscriptions', 'subscriptions')
  plan.unmapped.push(
    'A ManyRequests plan carries no price or currency on the subscription itself; D1 keeps money on organisations.custom_mrr, which the import never touches.',
  )

  const orgIdByKey = new Map<string, string>()
  for (const org of snapshot.orgs) if (org.manyrequestsId) orgIdByKey.set(org.manyrequestsId, org.id)

  const contactIdByName = new Map<string, string>()
  for (const contact of snapshot.contacts) {
    const name = contact.name.trim().toLowerCase()
    if (name && !contactIdByName.has(name)) contactIdByName.set(name, contact.id)
  }

  const byKey = indexByKey(snapshot.subscriptions)

  for (const org of source.organizations) {
    const orgKey = externalKey(org.id)
    if (!orgKey || ORG_SKIP[orgKey]) continue
    const orgId = orgIdByKey.get(orgKey)

    for (const subscription of source.subscriptionsByOrg[orgKey] ?? []) {
      const serviceName = refName(subscription.service)
      const createdAt = normaliseTimestamp(subscription.created_at)
      const key = subscriptionKey(orgKey, serviceName, createdAt)
      const label = `${org.name ?? orgKey}: ${serviceName ?? 'unnamed plan'}`

      if (!orgId) {
        plan.skipped.push({
          manyrequestsId: key,
          label,
          reason: `Its organisation (ManyRequests ${orgKey}) is not in D1 yet. Run the organisations entity first.`,
        })
        continue
      }

      const billedName = refName(subscription.member)
      const billedContactId = billedName ? contactIdByName.get(billedName.trim().toLowerCase()) ?? null : null
      if (billedName && !billedContactId) {
        // Glasswall's live retainer is billed to a soft-deleted ManyRequests
        // client. The plan still imports; the name is kept on the row's label
        // so the fact is visible rather than lost.
        plan.unmapped.push(
          `Subscription "${label}" is billed to "${billedName}", who has no D1 contact (a soft-deleted ManyRequests client). billedContactId stays null.`,
        )
      }

      const desired: Record<string, unknown> = {
        manyrequestsId: key,
        status: mapSubscriptionStatus(subscription.status),
        billingInterval: mapBillingInterval(subscription.billing_period),
        planType: mapPlanType(serviceName),
        mrServiceName: serviceName,
        hoursPerPeriod: normaliseNumber(subscription.hours_per_period),
        creditsPerPeriod: normaliseNumber(subscription.credits_per_period),
        billedContactId,
      }

      const existing = byKey.get(key)
      if (!existing) {
        plan.toInsert.push({
          manyrequestsId: key,
          label,
          values: {
            ...desired,
            orgId,
            currentPeriodStart: createdAt,
            createdAt: createdAt ?? options.now,
            updatedAt: options.now,
          },
        })
        continue
      }
      foldRow(plan, { manyrequestsId: key, label, values: desired }, existing, SUBSCRIPTION_UPDATABLE, options.now)
    }
  }

  return plan
}

// ── requests ─────────────────────────────────────────────────────────────────

const REQUEST_UPDATABLE = [
  'manyrequestsId',
  'title',
  'status',
  'priority',
  'assigneeId',
  'requestNumber',
  'dueDate',
  'deliveredAt',
  'estimatedHours',
  'brandId',
  'description',
  'formResponses',
  'submittedById',
  'submittedByType',
] as const

export function planRequests(
  source: ImportSource,
  snapshot: ImportSnapshot,
  options: PlanOptions,
): EntityPlan {
  const plan = emptyPlan('requests', 'requests')
  plan.unmapped.push(
    'ManyRequests attachments are not imported. The file URLs are bearer links and each one needs an R2 fetch-and-reupload, which is a separate slice.',
  )
  plan.unmapped.push(
    'A request rating and tracked_hours have no requests column. tracked_hours belongs in time_entries; both are preserved in formResponses._manyrequests.',
  )
  plan.unmapped.push(
    'D1 supports ONE assignee. The first ManyRequests assignee lands on assigneeId; any others are recorded in formResponses._manyrequests.unassignedExtraAssignees.',
  )
  plan.unmapped.push(
    'requestNumber is carried across verbatim and the 90 pre-numbering rows keep their null. requests.request_number is not unique, so an imported number can coincide with one a D1 request already displays; check the requests list for a repeated number after the first apply.',
  )

  const orgIdByKey = new Map<string, string>()
  const orgIdByName = new Map<string, string>()
  for (const org of snapshot.orgs) {
    if (org.manyrequestsId) orgIdByKey.set(org.manyrequestsId, org.id)
    orgIdByName.set(org.name.trim().toLowerCase(), org.id)
  }

  const brandIdByKey = new Map<string, string>()
  for (const brand of snapshot.brands) if (brand.manyrequestsId) brandIdByKey.set(brand.manyrequestsId, brand.id)

  const teamIdByName = new Map<string, string>()
  for (const member of snapshot.teamMembers) teamIdByName.set(member.name.trim().toLowerCase(), member.id)
  // The roster mapping is the reliable one: a ManyRequests assignee is a NAME,
  // and the three names are known. Resolving via the seed's tahi.studio address
  // is what the brief means by "assignee to team member by email".
  const teamIdByEmail = new Map<string, string>()
  for (const member of snapshot.teamMembers) {
    const email = normaliseEmail(member.email)
    if (email) teamIdByEmail.set(email, member.id)
  }
  for (const seed of MANYREQUESTS_TEAM) {
    const byEmail = teamIdByEmail.get(seed.email)
    if (byEmail) teamIdByName.set(seed.name.trim().toLowerCase(), byEmail)
  }

  const contactIdByKey = new Map<string, string>()
  const contactIdByOrgAndName = new Map<string, string>()
  for (const contact of snapshot.contacts) {
    if (contact.manyrequestsId) contactIdByKey.set(contact.manyrequestsId, contact.id)
    const name = contact.name.trim().toLowerCase()
    if (name) contactIdByOrgAndName.set(`${contact.orgId}::${name}`, contact.id)
  }

  const byKey = indexByKey(snapshot.requests)
  /** The 11 hand-typed Stride rows are matched on (org, title) so the import
   *  ADOPTS them (stamps manyrequestsId) instead of doubling the board. */
  const byOrgAndTitle = new Map<string, SnapshotRequest>()
  for (const request of snapshot.requests) {
    if (request.manyrequestsId) continue
    byOrgAndTitle.set(`${request.orgId}::${request.title.trim().toLowerCase()}`, request)
  }

  for (const request of source.requests) {
    const key = externalKey(request.id)
    const label = request.title ?? `request ${String(request.id)}`
    if (!key) {
      plan.skipped.push({ manyrequestsId: null, label, reason: 'Source row has no id.' })
      continue
    }
    if (beforeCutoff(request.created_at, options.since)) {
      plan.skipped.push({ manyrequestsId: key, label, reason: `Created before the since cutoff ${options.since}.` })
      continue
    }

    const orgKey = refId(request.organization)
    const orgName = refName(request.organization)
    const orgId =
      (orgKey ? orgIdByKey.get(orgKey) : undefined) ??
      (orgName ? orgIdByName.get(orgName.trim().toLowerCase()) : undefined) ??
      null
    if (!orgId) {
      plan.skipped.push({
        manyrequestsId: key,
        label,
        reason: `Could not resolve its organisation (${orgName ?? orgKey ?? 'unknown'}) to a D1 row. Run the organisations entity first.`,
      })
      continue
    }

    const mapped = mapRequestStatus(request.status, options.closedAs)
    if (mapped.needsRuling) {
      plan.unmapped.push(
        `Request ${request.number ?? key} "${label}": ${mapped.note ?? 'status needs a ruling'} -> ${mapped.status}.`,
      )
    }

    const assigneeNames = (Array.isArray(request.assignees) ? request.assignees : [])
      .map((entry) => refName(entry))
      .filter((entry): entry is string => Boolean(entry))
    const assigneeId = assigneeNames.length > 0
      ? teamIdByName.get(assigneeNames[0].trim().toLowerCase()) ?? null
      : null
    const extraAssignees = assigneeNames.slice(1)
    if (assigneeNames.length > 0 && !assigneeId) {
      plan.unmapped.push(
        `Request ${request.number ?? key}: assignee "${assigneeNames[0]}" does not match a D1 team member. Left unassigned rather than guessed.`,
      )
    }

    const clientKey = refId(request.client)
    const clientName = refName(request.client)
    const submittedById =
      (clientKey ? contactIdByKey.get(clientKey) : undefined) ??
      (clientName ? contactIdByOrgAndName.get(`${orgId}::${clientName.trim().toLowerCase()}`) : undefined) ??
      null

    const brandKey = refId(request.brand)
    const brandId = brandKey ? brandIdByKey.get(brandKey) ?? null : null

    const desired: Record<string, unknown> = {
      manyrequestsId: key,
      title: label,
      status: mapped.status,
      priority: mapRequestPriority(request.priority),
      assigneeId,
      // Never renumbered: the 90 pre-numbering rows keep their null.
      requestNumber: typeof request.number === 'number' ? request.number : null,
      dueDate: normaliseDate(request.due_date),
      deliveredAt: mapped.delivered
        ? normaliseTimestamp(request.updated_at) ?? normaliseTimestamp(request.created_at)
        : null,
      estimatedHours: normaliseNumber(request.hours?.time_estimate_hours),
      brandId,
      description: extractRequestBrief(request),
      formResponses: buildFormResponses(request, {
        statusNote: mapped.note,
        serviceName: refName(request.service),
        extraAssignees,
      }),
      submittedById,
      submittedByType: submittedById ? 'contact' : null,
    }

    const existingByKey = byKey.get(key)
    const adopted = existingByKey
      ? snapshot.requests.find((row) => row.id === existingByKey.id) ?? null
      : byOrgAndTitle.get(`${orgId}::${label.trim().toLowerCase()}`) ?? null

    if (!adopted) {
      plan.toInsert.push({
        manyrequestsId: key,
        label,
        values: {
          ...desired,
          orgId,
          type: 'small_task',
          size: 'small',
          // An imported request is a real client request, not a studio-created
          // one, so isInternal stays false and the portal shows it.
          isInternal: false,
          createdAt: normaliseTimestamp(request.created_at) ?? options.now,
          updatedAt: options.now,
        },
      })
      continue
    }

    foldRow(
      plan,
      { manyrequestsId: key, label, values: desired },
      { id: adopted.id, row: adopted as unknown as Record<string, unknown> },
      REQUEST_UPDATABLE,
      options.now,
    )
  }

  return plan
}

// ── messages ─────────────────────────────────────────────────────────────────

/**
 * Comments become message rows written DIRECTLY.
 *
 * Never through POST /api/admin/requests/[id]/messages (which attaches
 * threadReplyEmailPlan and mails the client on every post) and never through
 * the portal equivalent (which mails the studio). Importing the comment history
 * of 329 requests through either door would be thousands of emails to real
 * clients.
 *
 * conversationId stays null: lib/messages-store.ts reads a request thread by
 * request_id alone, so an imported message is in the thread without a
 * conversations row, and minting one per request would race the lazy resolver.
 */
export function planMessages(
  source: ImportSource,
  snapshot: ImportSnapshot,
  options: PlanOptions,
): EntityPlan {
  const plan = emptyPlan('messages', 'messages')
  plan.unmapped.push(
    'Only the 10 most recent comments come back per request. Any request whose comments_total exceeds what arrived is reported below and needs a second pass through the activity endpoint.',
  )

  const requestByKey = new Map<string, SnapshotRequest>()
  for (const request of snapshot.requests) {
    if (request.manyrequestsId) requestByKey.set(request.manyrequestsId, request)
  }

  const teamIdByName = new Map<string, string>()
  for (const member of snapshot.teamMembers) teamIdByName.set(member.name.trim().toLowerCase(), member.id)

  const contactIdByOrgAndName = new Map<string, string>()
  const contactIdByName = new Map<string, string>()
  for (const contact of snapshot.contacts) {
    const name = contact.name.trim().toLowerCase()
    if (!name) continue
    contactIdByOrgAndName.set(`${contact.orgId}::${name}`, contact.id)
    if (!contactIdByName.has(name)) contactIdByName.set(name, contact.id)
  }

  const existingKeys = new Set(
    snapshot.messages.map((message) => message.manyrequestsId).filter((key): key is string => Boolean(key)),
  )

  for (const request of source.requests) {
    const requestKey = externalKey(request.id)
    if (!requestKey) continue
    const comments = Array.isArray(request.comments) ? request.comments : []
    if (comments.length === 0) continue

    const target = requestByKey.get(requestKey)
    if (!target) {
      plan.skipped.push({
        manyrequestsId: requestKey,
        label: request.title ?? requestKey,
        reason: `${comments.length} comment(s) skipped: the request itself is not in D1 yet. Run the requests entity first.`,
      })
      continue
    }

    const total = typeof request.comments_total === 'number' ? request.comments_total : comments.length
    if (total > comments.length) {
      plan.unmapped.push(
        `Request ${request.number ?? requestKey} has ${total} comments but only ${comments.length} were returned. The remainder needs the activity endpoint.`,
      )
    }

    for (const comment of comments) {
      const key = commentKey(requestKey, comment)
      const authorName = refName(comment.author)
      const label = `${request.title ?? requestKey}: ${authorName ?? 'unknown author'}`
      if (!key) {
        plan.skipped.push({
          manyrequestsId: null,
          label,
          reason: 'Comment has no timestamp or no author, so it has no stable key and cannot be imported idempotently.',
        })
        continue
      }
      if (existingKeys.has(key)) {
        plan.unchanged += 1
        continue
      }
      const body = typeof comment.content === 'string' ? unescapeHtmlEntities(comment.content) : ''
      if (!body.trim()) {
        plan.skipped.push({ manyrequestsId: key, label, reason: 'Empty comment body.' })
        continue
      }
      const author = resolveCommentAuthor(
        authorName,
        { teamIdByName, contactIdByOrgAndName, contactIdByName },
        target.orgId,
      )
      if (!author) {
        // Never guessed. A comment attributed to the wrong side is the worst
        // failure this import has: a studio note shown as a client's words, or
        // a client's words shown as the studio's.
        plan.skipped.push({
          manyrequestsId: key,
          label,
          reason: `Author "${authorName ?? 'unknown'}" resolves to neither a team member nor a contact at this client. Import the team and contacts entities first.`,
        })
        continue
      }
      plan.toInsert.push({
        manyrequestsId: key,
        label,
        values: {
          requestId: target.id,
          orgId: target.orgId,
          conversationId: null,
          authorId: author.authorId,
          authorType: author.authorType,
          body,
          isInternal: comment.is_internal === true,
          manyrequestsId: key,
          createdAt: normaliseTimestamp(comment.created_at) ?? options.now,
          updatedAt: options.now,
        },
      })
      existingKeys.add(key)
    }
  }

  return plan
}

// ── invoices ─────────────────────────────────────────────────────────────────

const INVOICE_UPDATABLE = [
  'manyrequestsId',
  'status',
  'currency',
  'amountUsd',
  'totalUsd',
  'taxAmountUsd',
  'discountAmountUsd',
  'paidAt',
  'source',
] as const

const INVOICE_ITEM_UPDATABLE = ['manyrequestsId', 'description', 'quantity', 'unitPriceUsd', 'totalUsd'] as const

/**
 * A HISTORICAL LEDGER IMPORT, not a billing action.
 *
 * 19 of the 20 source invoices are already paid and settled on the old system.
 * They land as paid with a paidAt, no Stripe id, no Xero id and
 * reconciliationStatus 'historic' so the two reconcilers leave them alone. No
 * Stripe or Xero object is created, no invoice email is sent, and sentAt stays
 * null so nothing enters the chase flow by accident.
 *
 * The one exception is the live receivable, Greyhive INV-2025000024
 * (GBP 1279.67, pending since 2025-12-27). It lands as `sent`, which does put
 * it in invoice aging: that is deliberate and it is called out in the runbook,
 * because the alternative is quietly hiding a real unpaid bill.
 */
export function planInvoices(
  source: ImportSource,
  snapshot: ImportSnapshot,
  options: PlanOptions,
): EntityPlan {
  const plan = emptyPlan('invoices', 'invoices')
  plan.unmapped.push(
    'ManyRequests exposes no due_date and no per-line tax on the invoice shape. dueDate stays null and taxes land at the invoice level only.',
  )
  plan.unmapped.push(
    'payment_url is not imported. It is a bearer URL anyone holding it can open, and the D1 pay-link columns are rail-specific (Stripe / Xero).',
  )

  const orgIdByKey = new Map<string, string>()
  const orgIdByName = new Map<string, string>()
  for (const org of snapshot.orgs) {
    if (org.manyrequestsId) orgIdByKey.set(org.manyrequestsId, org.id)
    orgIdByName.set(org.name.trim().toLowerCase(), org.id)
  }

  const byKey = indexByKey(snapshot.invoices)
  const itemsByInvoiceId = new Map<string, SnapshotInvoiceItem[]>()
  for (const item of snapshot.invoiceItems) {
    const list = itemsByInvoiceId.get(item.invoiceId) ?? []
    list.push(item)
    itemsByInvoiceId.set(item.invoiceId, list)
  }

  for (const invoice of source.invoices) {
    const key = typeof invoice.number === 'string' ? invoice.number.trim() : ''
    const label = key || 'unnumbered invoice'
    if (!key) {
      plan.skipped.push({ manyrequestsId: null, label, reason: 'Source row has no invoice number, which is its identifier.' })
      continue
    }
    if (beforeCutoff(invoice.created_at, options.since)) {
      plan.skipped.push({ manyrequestsId: key, label, reason: `Created before the since cutoff ${options.since}.` })
      continue
    }

    const orgKey = refId(invoice.organization)
    const orgName = refName(invoice.organization)
    // NEVER matched on organisation name alone: three D1 organisations are
    // literally NAMED after ManyRequests invoice numbers from an earlier bad
    // Stripe import, and one of those names is also a live Fluvial invoice.
    const orgId =
      (orgKey ? orgIdByKey.get(orgKey) : undefined) ??
      (orgName ? orgIdByName.get(orgName.trim().toLowerCase()) : undefined) ??
      null
    if (!orgId) {
      plan.skipped.push({
        manyrequestsId: key,
        label,
        reason: `Could not resolve its organisation (${orgName ?? orgKey ?? 'unknown'}) to a D1 row. Run the organisations entity first.`,
      })
      continue
    }

    const status = mapInvoiceStatus(invoice.status)
    const money = mapInvoiceMoney(invoice)
    const desired: Record<string, unknown> = {
      manyrequestsId: key,
      status,
      currency: money.currency,
      amountUsd: money.amountUsd,
      totalUsd: money.totalUsd,
      taxAmountUsd: money.taxAmountUsd,
      discountAmountUsd: money.discountAmountUsd,
      paidAt: mapInvoicePaidAt(invoice, status),
      source: 'manyrequests',
    }

    const existing = byKey.get(key)
    let invoiceId: string | null = existing?.id ?? null

    if (!existing) {
      invoiceId = null
      plan.toInsert.push({
        manyrequestsId: key,
        label,
        values: {
          ...desired,
          orgId,
          // Historic: neither reconciler should try to match a row that never
          // touched Stripe or Xero.
          reconciliationStatus: 'historic',
          stripeInvoiceId: null,
          xeroInvoiceId: null,
          // Never stamped. sentAt is what puts an invoice in the chase flow.
          sentAt: null,
          notes: `Imported from ManyRequests ${key}.`,
          createdAt: normaliseTimestamp(invoice.created_at) ?? options.now,
          updatedAt: options.now,
        },
      })
    } else {
      foldRow(plan, { manyrequestsId: key, label, values: desired }, existing, INVOICE_UPDATABLE, options.now)
    }

    // Line items. Positional keys, reconciled against the parent: a line that
    // disappears upstream is removed so the ledger row keeps adding up.
    const lines = Array.isArray(invoice.line_items) ? invoice.line_items : []
    const existingItems = invoiceId ? itemsByInvoiceId.get(invoiceId) ?? [] : []
    const existingItemByKey = new Map<string, SnapshotInvoiceItem>()
    for (const item of existingItems) if (item.manyrequestsId) existingItemByKey.set(item.manyrequestsId, item)
    const seenItemKeys = new Set<string>()

    lines.forEach((line, index) => {
      const itemKey = invoiceItemKey(key, index)
      seenItemKeys.add(itemKey)
      const quantity = normaliseNumber(line.quantity) ?? 1
      const unitPrice = normaliseNumber(line.unit_price) ?? 0
      const itemValues: Record<string, unknown> = {
        manyrequestsId: itemKey,
        description: line.name ?? 'Line item',
        quantity,
        unitPriceUsd: unitPrice,
        totalUsd: normaliseNumber(line.subtotal) ?? quantity * unitPrice,
      }
      const existingItem = existingItemByKey.get(itemKey)
      if (!existingItem) {
        plan.toInsert.push({
          manyrequestsId: itemKey,
          label: `${label} line ${index + 1}`,
          table: 'invoice_items',
          values: {
            ...itemValues,
            // Resolved at apply time: on a first run the parent invoice does
            // not exist yet and has no id to point at.
            __invoiceManyrequestsId: key,
          },
        })
        return
      }
      foldRow(
        plan,
        { manyrequestsId: itemKey, label: `${label} line ${index + 1}`, values: itemValues, table: 'invoice_items' },
        { id: existingItem.id, row: existingItem as unknown as Record<string, unknown> },
        INVOICE_ITEM_UPDATABLE,
        null,
      )
    })

    for (const item of existingItems) {
      if (!item.manyrequestsId) continue
      if (seenItemKeys.has(item.manyrequestsId)) continue
      const orphan: PlannedDelete = {
        id: item.id,
        manyrequestsId: item.manyrequestsId,
        label: `${label}: ${item.description}`,
        table: 'invoice_items',
      }
      plan.toDelete.push(orphan)
    }
  }

  return plan
}

// ── assembly ─────────────────────────────────────────────────────────────────

export type PlanBuilder = (source: ImportSource, snapshot: ImportSnapshot, options: PlanOptions) => EntityPlan

/**
 * The id a projected row carries in a dry run. It is deliberately not a UUID:
 * if one ever escaped into a write it would be obvious in the row and the
 * apply refuses it outright (upsert.ts resolvePlaceholders).
 */
export const PENDING_ID_PREFIX = '__pending:'

export function pendingId(table: string, manyrequestsId: string): string {
  return `${PENDING_ID_PREFIX}${table}:${manyrequestsId}`
}

/**
 * Fold a plan forward into the snapshot, so the NEXT entity plans against the
 * world this one would create. Dry run only.
 *
 * Without it a dry run against a database that has never been imported reports
 * "could not resolve its organisation" for all 329 requests, which is true of
 * the first entity in isolation and useless as a preview of the whole run. An
 * apply never uses this: it re-reads D1 between entities, so it plans against
 * what was actually written rather than what was predicted.
 */
export function projectPlan(snapshot: ImportSnapshot, plan: EntityPlan): ImportSnapshot {
  const next: ImportSnapshot = {
    orgs: [...snapshot.orgs],
    contacts: [...snapshot.contacts],
    teamMembers: [...snapshot.teamMembers],
    roles: snapshot.roles,
    teamMemberRoles: [...snapshot.teamMemberRoles],
    brands: [...snapshot.brands],
    services: [...snapshot.services],
    subscriptions: [...snapshot.subscriptions],
    requests: [...snapshot.requests],
    messages: [...snapshot.messages],
    invoices: [...snapshot.invoices],
    invoiceItems: [...snapshot.invoiceItems],
  }

  for (const row of plan.toInsert) {
    const table = row.table ?? plan.table
    const id = pendingId(table, row.manyrequestsId)
    const values = { ...row.values, id } as Record<string, unknown>
    // Resolve the two apply-time placeholders against the projected world, so
    // a re-planned dry run sees the same links the apply would create and
    // reports them as unchanged rather than as a second insert.
    if (typeof values.__teamMemberEmail === 'string') {
      const email = values.__teamMemberEmail.trim().toLowerCase()
      const member = next.teamMembers.find((candidate) => candidate.email.trim().toLowerCase() === email)
      if (member) values.teamMemberId = member.id
      delete values.__teamMemberEmail
    }
    if (typeof values.__invoiceManyrequestsId === 'string') {
      const invoiceKey = values.__invoiceManyrequestsId
      const invoice = next.invoices.find((candidate) => candidate.manyrequestsId === invoiceKey)
      if (invoice) values.invoiceId = invoice.id
      delete values.__invoiceManyrequestsId
    }
    switch (table) {
      case 'organisations': next.orgs.push(values as unknown as SnapshotOrg); break
      case 'contacts': next.contacts.push(values as unknown as SnapshotContact); break
      case 'team_members': next.teamMembers.push(values as unknown as SnapshotTeamMember); break
      case 'team_member_roles': next.teamMemberRoles.push(values as unknown as SnapshotTeamMemberRole); break
      case 'brands': next.brands.push(values as unknown as SnapshotBrand); break
      case 'services': next.services.push(values as unknown as SnapshotService); break
      case 'subscriptions': next.subscriptions.push(values as unknown as SnapshotSubscription); break
      case 'requests': next.requests.push(values as unknown as SnapshotRequest); break
      case 'messages': next.messages.push(values as unknown as SnapshotMessage); break
      case 'invoices': next.invoices.push(values as unknown as SnapshotInvoice); break
      case 'invoice_items': next.invoiceItems.push(values as unknown as SnapshotInvoiceItem); break
      default: break
    }
  }

  for (const row of plan.toUpdate) {
    const table = row.table ?? plan.table
    const lists: Record<string, Array<{ id: string }>> = {
      organisations: next.orgs,
      contacts: next.contacts,
      team_members: next.teamMembers,
      brands: next.brands,
      services: next.services,
      subscriptions: next.subscriptions,
      requests: next.requests,
      messages: next.messages,
      invoices: next.invoices,
      invoice_items: next.invoiceItems,
    }
    const list = lists[table]
    if (!list) continue
    const index = list.findIndex((candidate) => candidate.id === row.id)
    if (index === -1) continue
    list[index] = { ...list[index], ...row.changes } as { id: string }
  }

  return next
}

export const PLAN_BUILDERS: Readonly<Record<ImportEntity, PlanBuilder>> = {
  team: (_source, snapshot, options) => planTeam(snapshot, options),
  organisations: planOrganisations,
  contacts: planContacts,
  brands: planBrands,
  services: planServices,
  subscriptions: planSubscriptions,
  requests: planRequests,
  messages: planMessages,
  invoices: planInvoices,
}

export type { PlannedInsert, PlannedUpdate, PlannedDelete, SkippedRow }
